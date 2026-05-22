'use client'

import { useState, useRef, useEffect, memo } from 'react';
import { StopCircleIcon, MicrophoneIcon, PaperAirplaneIcon } from '@heroicons/react/24/solid';
import { useSentioAsrStore, useChatRecordStore } from '@/lib/store/sentio';
import { Input, Button, Spinner, addToast, Tooltip } from '@heroui/react';
import { CHAT_ROLE, IFER_TYPE } from '@/lib/protocol';
import { api_asr_infer_file } from '@/lib/api/server';
import { createASRWebsocketClient, WS_RECV_ACTION_TYPE, WS_SEND_ACTION_TYPE } from '@/lib/api/websocket';
import { useTranslations } from 'next-intl';
import { convertToMp3, convertFloat32ArrayToMp3, AudioRecoder } from '@/lib/utils/audio';
import Recorder from 'js-audio-recorder';
import { useMicVAD } from "@ricky0123/vad-react"
import { useChatWithAgent, useAudioTimer } from '../../hooks/chat';
import { getSrcPath } from '@/lib/path';
import clsx from 'clsx';
import { Live2dManager } from '@/lib/live2d/live2dManager';

let micRecoder: Recorder | null = null;
const NATIVE_SPEECH_SILENCE_MS = 900;
const NATIVE_SPEECH_START_TIMEOUT_MS = 450;
const NATIVE_SPEECH_STALE_RESTART_MS = 12000;
const NATIVE_SPEECH_STALE_RESTART_COOLDOWN_MS = 5000;
const STREAM_FINAL_STALE_MS = 5000;
const STREAM_BARGE_IN_RMS_THRESHOLD = 0.05;
const STREAM_BARGE_IN_MIN_FRAMES = 3;
const STREAM_STALE_RESULT_IGNORE_MS = 400;
const STREAM_ACTIVITY_RMS_THRESHOLD = 0.02;
const STREAM_FINAL_SILENCE_MS = 900;
const STREAM_FINALIZING_TIMEOUT_MS = 1800;
const STREAM_PARTIAL_COMMIT_MAX_MS = 3000;
const STREAM_PARTIAL_STABLE_COMMIT_MS = 900;
const ASSISTANT_ECHO_TTL_MS = 5000;
const ASSISTANT_ECHO_SIMILARITY_THRESHOLD = 0.84;
const ASSISTANT_SHORT_ECHO_GRACE_MS = 80;
const ASSISTANT_SHORT_ECHO_MAX_LENGTH = 3;

const normalizeEchoText = (text: string) => {
    return text
        .toLowerCase()
        .replace(/[\s，。！？、,.!?~～：:；;“”"'‘’()\[\]{}<>《》]/g, "");
}

const longestCommonSubsequenceLength = (left: string, right: string) => {
    if (!left || !right) {
        return 0;
    }
    const previous = new Array(right.length + 1).fill(0);
    const current = new Array(right.length + 1).fill(0);
    for (let i = 1; i <= left.length; i++) {
        for (let j = 1; j <= right.length; j++) {
            current[j] = left[i - 1] === right[j - 1]
                ? previous[j - 1] + 1
                : Math.max(previous[j], current[j - 1]);
        }
        for (let j = 0; j <= right.length; j++) {
            previous[j] = current[j];
            current[j] = 0;
        }
    }
    return previous[right.length];
}

const isLikelyEchoText = (input: string, source: string) => {
    const normalizedInput = normalizeEchoText(input);
    const normalizedSource = normalizeEchoText(source);
    if (normalizedInput.length < 4 || normalizedSource.length < 4) {
        return false;
    }
    if (normalizedInput.length >= 6 && normalizedSource.includes(normalizedInput)) {
        return true;
    }
    const lcsLength = longestCommonSubsequenceLength(normalizedInput, normalizedSource);
    return lcsLength / Math.max(normalizedInput.length, 1) >= ASSISTANT_ECHO_SIMILARITY_THRESHOLD;
}

const isLikelyShortEchoText = (input: string, source: string) => {
    const normalizedInput = normalizeEchoText(input);
    const normalizedSource = normalizeEchoText(source);
    if (!normalizedInput || !normalizedSource) {
        return false;
    }
    if (normalizedInput.length > ASSISTANT_SHORT_ECHO_MAX_LENGTH) {
        return false;
    }
    return normalizedSource.includes(normalizedInput);
}

const useTtsPlaybackGuard = () => {
    const [blocked, setBlocked] = useState(false);
    const blockedRef = useRef(false);

    useEffect(() => {
        const manager = Live2dManager.getInstance();
        const syncBlockedState = (nextBlocked: boolean = manager.isPlaybackBlocked()) => {
            blockedRef.current = nextBlocked;
            setBlocked((prev) => prev === nextBlocked ? prev : nextBlocked);
        };
        const handleTtsState = (event: Event) => {
            const detail = (event as CustomEvent<{ blocked?: boolean }>).detail;
            syncBlockedState(!!detail?.blocked);
        };

        syncBlockedState();
        document.addEventListener('sentio:tts-state', handleTtsState as EventListener);
        const timer = window.setInterval(() => syncBlockedState(), 180);
        return () => {
            document.removeEventListener('sentio:tts-state', handleTtsState as EventListener);
            window.clearInterval(timer);
        };
    }, []);

    return { blocked, blockedRef };
}


export const ChatInput = memo(({ 
    postProcess
}: {
    postProcess?: (conversation_id: string, message_id: string, think: string, content: string) => void
   
}) => {
    const t = useTranslations('Products.sentio');
    const [message, setMessage] = useState("");
    const [startMicRecord, setStartMicRecord] = useState(false);
    const [startAsrConvert, setStartAsrConvert] = useState(false);
    const [voiceModeActive, setVoiceModeActive] = useState(false);
    const [voiceHint, setVoiceHint] = useState("Voice ready");
    const { blocked: ttsBlocked, blockedRef: ttsBlockedRef } = useTtsPlaybackGuard();
    const { enable: enableASR, engine: asrEngine, infer_type: asrInferType, settings: asrSettings, preferBrowserCloud, handsFreeMode } = useSentioAsrStore();
    const { chat, abort, chatting } = useChatWithAgent();
    const { startAudioTimer, stopAudioTimer } = useAudioTimer();
    const streamAudioRecoderRef = useRef<AudioRecoder | null>(null);
    const streamAsrWsClientRef = useRef<ReturnType<typeof createASRWebsocketClient> | null>(null);
    const streamEngineReadyRef = useRef(false);
    const latestStreamSessionIdRef = useRef(0);
    const latestFileAsrRequestIdRef = useRef(0);
    const nativeRecognitionRef = useRef<any>(null);
    const nativeFinalTranscriptRef = useRef("");
    const nativeDisplayTranscriptRef = useRef("");
    const nativeSilenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeListeningWatchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nativeLastActivityAtRef = useRef(0);
    const nativeLastStaleRestartAtRef = useRef(0);
    const nativeRecognitionStartedRef = useRef(false);
    const nativeShouldSendRef = useRef(false);
    const nativeFallbackToStreamRef = useRef(false);
    const nativeTranscriptDraftActiveRef = useRef(false);
    const nativeSubmittedRef = useRef(false);
    const nativeRestartPendingRef = useRef(false);
    const startMicRecordRef = useRef(false);
    const startAsrConvertRef = useRef(false);
    const autoVoiceStartedRef = useRef(false);
    const handsFreeRunningRef = useRef(false);
    const handsFreeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const openingGreetingActiveRef = useRef(true);
    const openingGreetingFallbackTimerRef = useRef<number | null>(null);
    const micPermissionReadyRef = useRef(false);
    const assistantSpeechTextsRef = useRef<Array<{ text: string; at: number }>>([]);
    const assistantShortEchoGraceUntilRef = useRef(0);
    const streamLastFinalTextRef = useRef("");
    const streamLastFinalAtRef = useRef(0);
    const streamBargeInFrameCountRef = useRef(0);
    const streamStaleResultIgnoreUntilRef = useRef(0);
    const continuousStreamActiveRef = useRef(false);
    const streamSentenceActiveRef = useRef(false);
    const streamLastSpeechAtRef = useRef(0);
    const streamFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamFinalizingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamFinalizingRef = useRef(false);
    const streamTranscriptDraftActiveRef = useRef(false);
    const streamConnectingRef = useRef(false);
    const streamLatestTranscriptRef = useRef("");
    const streamLastTranscriptAtRef = useRef(0);
    const streamUtteranceStartedAtRef = useRef(0);
    const streamSubmittedCurrentUtteranceRef = useRef(false);

    const shouldUseRealtimeVoice = () => {
        return shouldPreferNativeSpeech();
    }

    const shouldPreferNativeSpeech = () => {
        return !!getNativeSpeechRecognitionCtor();
    }

    const setMicRecordState = (nextState: boolean) => {
        startMicRecordRef.current = nextState;
        setStartMicRecord(nextState);
    }

    const setAsrConvertState = (nextState: boolean) => {
        startAsrConvertRef.current = nextState;
        setStartAsrConvert(nextState);
    }

    const isNativeVoiceBusy = () => {
        return !!nativeRecognitionRef.current || startMicRecordRef.current || startAsrConvertRef.current;
    }

    const rememberAssistantSpeechText = (text: string, at: number = Date.now()) => {
        const normalizedText = text.trim();
        if (!normalizedText) {
            return;
        }
        assistantSpeechTextsRef.current = [
            ...assistantSpeechTextsRef.current.filter((item) => at - item.at < ASSISTANT_ECHO_TTL_MS),
            { text: normalizedText, at }
        ].slice(-12);
    }

    const isAssistantEchoTranscript = (text: string) => {
        const now = Date.now();
        assistantSpeechTextsRef.current = assistantSpeechTextsRef.current.filter((item) => now - item.at < ASSISTANT_ECHO_TTL_MS);
        const inPlaybackEchoWindow = ttsBlockedRef.current || now < assistantShortEchoGraceUntilRef.current;
        return assistantSpeechTextsRef.current.some((item) => {
            if (isLikelyEchoText(text, item.text)) {
                return true;
            }
            return inPlaybackEchoWindow && isLikelyShortEchoText(text, item.text);
        });
    }

    const discardNativeTranscriptDraft = () => {
        nativeFinalTranscriptRef.current = "";
        nativeDisplayTranscriptRef.current = "";
        clearNativeSilenceTimer();
        clearNativeTranscriptDraft();
        setMessage("");
    }

    const updateNativeTranscriptDraft = (text: string) => {
        const nextText = text.trim();
        if (!nextText) {
            return;
        }
        const draftRecord = { role: CHAT_ROLE.HUMAN, think: "", content: nextText };
        const lastRecord = useChatRecordStore.getState().getLastRecord();
        if (nativeTranscriptDraftActiveRef.current && lastRecord?.role === CHAT_ROLE.HUMAN) {
            useChatRecordStore.getState().updateLastRecord(draftRecord);
            return;
        }
        useChatRecordStore.getState().addChatRecord(draftRecord);
        nativeTranscriptDraftActiveRef.current = true;
    }

    const clearNativeTranscriptDraft = () => {
        if (!nativeTranscriptDraftActiveRef.current) {
            return;
        }
        const store = useChatRecordStore.getState();
        if (store.getLastRecord()?.role === CHAT_ROLE.HUMAN) {
            store.deleteLastRecord();
        }
        nativeTranscriptDraftActiveRef.current = false;
    }

    const commitNativeTranscriptDraft = (text: string) => {
        const finalText = text.trim();
        if (!finalText) {
            clearNativeTranscriptDraft();
            return;
        }
        updateNativeTranscriptDraft(finalText);
        nativeTranscriptDraftActiveRef.current = false;
    }

    const clearStreamFinalizeTimer = () => {
        if (streamFinalizeTimerRef.current) {
            clearTimeout(streamFinalizeTimerRef.current);
            streamFinalizeTimerRef.current = null;
        }
    }

    const clearStreamFinalizingTimer = () => {
        if (streamFinalizingTimerRef.current) {
            clearTimeout(streamFinalizingTimerRef.current);
            streamFinalizingTimerRef.current = null;
        }
    }

    const updateStreamTranscriptDraft = (text: string) => {
        const nextText = text.trim();
        if (!nextText) {
            return;
        }

        const draftRecord = { role: CHAT_ROLE.HUMAN, think: "", content: nextText };
        const store = useChatRecordStore.getState();
        const lastRecord = store.getLastRecord();
        if (streamTranscriptDraftActiveRef.current && lastRecord?.role === CHAT_ROLE.HUMAN) {
            store.updateLastRecord(draftRecord);
            return;
        }

        store.addChatRecord(draftRecord);
        streamTranscriptDraftActiveRef.current = true;
    }

    const clearStreamTranscriptDraft = () => {
        if (!streamTranscriptDraftActiveRef.current) {
            return;
        }
        const store = useChatRecordStore.getState();
        if (store.getLastRecord()?.role === CHAT_ROLE.HUMAN) {
            store.deleteLastRecord();
        }
        streamTranscriptDraftActiveRef.current = false;
    }

    const commitStreamTranscriptDraft = (text: string) => {
        const finalText = text.trim();
        if (!finalText) {
            clearStreamTranscriptDraft();
            return;
        }
        updateStreamTranscriptDraft(finalText);
        streamTranscriptDraftActiveRef.current = false;
    }

    const cleanupStreamSession = () => {
        latestStreamSessionIdRef.current += 1;
        streamConnectingRef.current = false;
        streamEngineReadyRef.current = false;
        clearStreamFinalizeTimer();
        clearStreamFinalizingTimer();
        streamSentenceActiveRef.current = false;
        streamLastSpeechAtRef.current = 0;
        streamFinalizingRef.current = false;
        streamLatestTranscriptRef.current = "";
        streamLastTranscriptAtRef.current = 0;
        streamUtteranceStartedAtRef.current = 0;
        streamSubmittedCurrentUtteranceRef.current = false;
        clearStreamTranscriptDraft();
        streamAudioRecoderRef.current?.stop();
        streamAudioRecoderRef.current = null;
        streamAsrWsClientRef.current?.disconnect();
        streamAsrWsClientRef.current = null;
    }

    const clearNativeSilenceTimer = () => {
        if (nativeSilenceTimerRef.current) {
            clearTimeout(nativeSilenceTimerRef.current);
            nativeSilenceTimerRef.current = null;
        }
    }

    const clearHandsFreeRestartTimer = () => {
        if (handsFreeRestartTimerRef.current) {
            clearTimeout(handsFreeRestartTimerRef.current);
            handsFreeRestartTimerRef.current = null;
        }
    }

    const scheduleNativeRestart = (delayMs: number = 0) => {
        if (!handsFreeRunningRef.current || !shouldPreferNativeSpeech()) {
            return;
        }
        setVoiceModeActive(true);
        if (ttsBlockedRef.current) {
            nativeRestartPendingRef.current = true;
            return;
        }
        if (isNativeVoiceBusy()) {
            nativeRestartPendingRef.current = true;
            return;
        }

        clearHandsFreeRestartTimer();
        if (delayMs <= 0) {
            nativeRestartPendingRef.current = false;
            handleStartNativeRecord();
            return;
        }
        handsFreeRestartTimerRef.current = setTimeout(() => {
            handsFreeRestartTimerRef.current = null;
            if (!handsFreeRunningRef.current || !shouldPreferNativeSpeech()) {
                return;
            }
            if (ttsBlockedRef.current) {
                nativeRestartPendingRef.current = true;
                return;
            }
            if (isNativeVoiceBusy()) {
                nativeRestartPendingRef.current = true;
                return;
            }
            handleStartNativeRecord();
        }, delayMs);
    }

    const recoverNativeSpeech = (delayMs: number = 150) => {
        setMicRecordState(false);
        setAsrConvertState(false);
        resetNativeSpeechState();
        if (handsFreeRunningRef.current) {
            setVoiceModeActive(true);
            setVoiceHint("Restarting voice");
            nativeRestartPendingRef.current = true;
            scheduleNativeRestart(delayMs);
        }
    }

    const clearNativeStartTimeout = () => {
        if (nativeStartTimeoutRef.current) {
            clearTimeout(nativeStartTimeoutRef.current);
            nativeStartTimeoutRef.current = null;
        }
    }

    const clearNativeListeningWatchdog = () => {
        if (nativeListeningWatchdogRef.current) {
            clearTimeout(nativeListeningWatchdogRef.current);
            nativeListeningWatchdogRef.current = null;
        }
    }

    const markNativeSpeechActivity = () => {
        nativeLastActivityAtRef.current = Date.now();
    }

    const markVoiceButtonInteraction = () => {
        if (typeof document === "undefined") {
            return;
        }
        document.dispatchEvent(new CustomEvent('sentio:voice-button-interaction', {
            detail: { at: Date.now() }
        }));
    }

    const stopActiveAsrForPlayback = () => {
        clearNativeSilenceTimer();
        clearHandsFreeRestartTimer();
        if (nativeRecognitionRef.current) {
            stopNativeSpeechRecognition(false);
            return;
        }
        if (micRecoder && startMicRecord && asrInferType !== IFER_TYPE.STREAM) {
            try {
                micRecoder.stop();
            } catch {}
            setStartMicRecord(false);
            setStartAsrConvert(false);
            setMessage("");
            return;
        }
        if (streamAudioRecoderRef.current || streamAsrWsClientRef.current) {
            setStartMicRecord(false);
            setStartAsrConvert(false);
            setMessage("");
            cleanupStreamSession();
        }
    }

    const resetNativeSpeechState = () => {
        clearNativeSilenceTimer();
        clearNativeStartTimeout();
        nativeFinalTranscriptRef.current = "";
        nativeDisplayTranscriptRef.current = "";
        nativeRecognitionStartedRef.current = false;
        nativeLastActivityAtRef.current = 0;
        nativeShouldSendRef.current = false;
        nativeFallbackToStreamRef.current = false;
        nativeSubmittedRef.current = false;
        clearNativeListeningWatchdog();

        const recognition = nativeRecognitionRef.current;
        if (recognition) {
            recognition.onstart = null;
            recognition.onresult = null;
            recognition.onerror = null;
            recognition.onend = null;
            recognition.onspeechstart = null;
            recognition.onspeechend = null;
        }
        nativeRecognitionRef.current = null;
    }

    const forceStopNativeSpeechRecognition = () => {
        const recognition = nativeRecognitionRef.current;
        if (!recognition) {
            resetNativeSpeechState();
            return;
        }
        recognition.onstart = null;
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.onspeechstart = null;
        recognition.onspeechend = null;
        try {
            recognition.stop();
        } catch {}
        resetNativeSpeechState();
    }

    const stopNativeSpeechRecognition = (shouldSend: boolean = true) => {
        const recognition = nativeRecognitionRef.current;
        nativeShouldSendRef.current = shouldSend;
        clearNativeSilenceTimer();
        clearNativeStartTimeout();
        clearHandsFreeRestartTimer();
        setMicRecordState(false);
        if (!recognition) {
            return;
        }
        try {
            recognition.stop();
        } catch {
            resetNativeSpeechState();
        }
    }

    const submitNativeSpeechTranscript = () => {
        const transcript = nativeDisplayTranscriptRef.current.trim();
        if (!transcript || nativeSubmittedRef.current) {
            return;
        }

        if (isAssistantEchoTranscript(transcript)) {
            console.info("[Voice] drop assistant echo transcript", { transcript });
            nativeSubmittedRef.current = true;
            nativeRestartPendingRef.current = true;
            nativeShouldSendRef.current = false;
            clearNativeSilenceTimer();
            clearNativeStartTimeout();
            clearNativeTranscriptDraft();
            nativeFinalTranscriptRef.current = "";
            nativeDisplayTranscriptRef.current = "";
            setMessage("");
            const recognition = nativeRecognitionRef.current;
            if (recognition) {
                try {
                    recognition.stop();
                } catch {
                    resetNativeSpeechState();
                }
            }
            return;
        }

        nativeSubmittedRef.current = true;
        nativeRestartPendingRef.current = true;
        nativeShouldSendRef.current = false;
        clearNativeSilenceTimer();
        clearNativeStartTimeout();
        setMicRecordState(false);
        setAsrConvertState(false);
        commitNativeTranscriptDraft(transcript);
        nativeFinalTranscriptRef.current = "";
        nativeDisplayTranscriptRef.current = "";
        console.info("[Voice] submit native transcript", { length: transcript.length, transcript });
        chat(transcript, postProcess, false);
        setMessage("");

        const recognition = nativeRecognitionRef.current;
        if (recognition) {
            try {
                recognition.stop();
            } catch {
                resetNativeSpeechState();
            }
        }
    }

    const scheduleNativeSpeechStop = () => {
        clearNativeSilenceTimer();
        nativeSilenceTimerRef.current = setTimeout(() => {
            submitNativeSpeechTranscript();
        }, NATIVE_SPEECH_SILENCE_MS);
    }

    const fallbackToStreamRecord = () => {
        if (nativeFallbackToStreamRef.current) {
            return;
        }

        nativeFallbackToStreamRef.current = true;
        setMicRecordState(false);
        setAsrConvertState(false);
        setVoiceModeActive(true);
        setVoiceHint("Using fallback ASR");
        forceStopNativeSpeechRecognition();
        window.setTimeout(() => {
            if (shouldUseRealtimeVoice()) {
                handsFreeRunningRef.current = true;
                handleStartStreamRecord();
                return;
            }
            handleStartStreamRecord();
        }, 0);
    }

    const maybeInterruptContinuousStreamPlayback = (chunk: Float32Array) => {
        if (!ttsBlockedRef.current) {
            streamBargeInFrameCountRef.current = 0;
            return;
        }

        const rms = calculateChunkRms(chunk);
        if (rms < STREAM_BARGE_IN_RMS_THRESHOLD) {
            streamBargeInFrameCountRef.current = 0;
            return;
        }

        streamBargeInFrameCountRef.current += 1;
        if (streamBargeInFrameCountRef.current < STREAM_BARGE_IN_MIN_FRAMES) {
            return;
        }

        streamBargeInFrameCountRef.current = 0;
        streamStaleResultIgnoreUntilRef.current = Date.now() + STREAM_STALE_RESULT_IGNORE_MS;
        abort();
        Live2dManager.getInstance().stopAudio();
    }

    const submitStreamTranscript = (text: string) => {
        const finalText = text.trim();
        if (!finalText || streamSubmittedCurrentUtteranceRef.current || ttsBlockedRef.current) {
            return false;
        }

        const now = Date.now();
        if (
            finalText === streamLastFinalTextRef.current &&
            now - streamLastFinalAtRef.current < 3000
        ) {
            streamSubmittedCurrentUtteranceRef.current = true;
            return false;
        }

        streamSubmittedCurrentUtteranceRef.current = true;
        streamLastFinalTextRef.current = finalText;
        streamLastFinalAtRef.current = now;
        streamFinalizingRef.current = false;
        clearStreamFinalizingTimer();
        clearStreamFinalizeTimer();
        setMessage(finalText);
        commitStreamTranscriptDraft(finalText);
        chat(finalText, postProcess, false);
        setMessage("");
        return true;
    }

    const maybeSubmitStableStreamPartial = () => {
        if (
            !continuousStreamActiveRef.current ||
            streamSubmittedCurrentUtteranceRef.current ||
            streamFinalizingRef.current ||
            ttsBlockedRef.current
        ) {
            return;
        }

        const latestText = streamLatestTranscriptRef.current.trim();
        if (!latestText || streamLastTranscriptAtRef.current === 0) {
            return;
        }

        const now = Date.now();
        const stableLongEnough = now - streamLastTranscriptAtRef.current >= STREAM_PARTIAL_STABLE_COMMIT_MS;
        const waitedTooLong = streamUtteranceStartedAtRef.current > 0 && now - streamUtteranceStartedAtRef.current >= STREAM_PARTIAL_COMMIT_MAX_MS;
        if (!stableLongEnough && !waitedTooLong) {
            return;
        }

        submitStreamTranscript(latestText);
        streamSentenceActiveRef.current = false;
        streamLastSpeechAtRef.current = 0;
        const wsClient = streamAsrWsClientRef.current;
        if (streamEngineReadyRef.current && wsClient?.isConnected()) {
            const finalChunk = streamAudioRecoderRef.current?.flush() ?? new Uint8Array(0);
            wsClient.sendMessage(WS_SEND_ACTION_TYPE.ENGINE_FINAL_INPUT, finalChunk);
        }
    }

    const sendContinuousStreamFinalInput = () => {
        const wsClient = streamAsrWsClientRef.current;
        if (!continuousStreamActiveRef.current || !streamSentenceActiveRef.current || streamFinalizingRef.current) {
            return;
        }
        if (!streamEngineReadyRef.current || !wsClient?.isConnected()) {
            return;
        }

        clearStreamFinalizeTimer();
        clearStreamFinalizingTimer();
        streamFinalizingRef.current = true;
        streamSentenceActiveRef.current = false;
        streamLastSpeechAtRef.current = 0;
        const committed = submitStreamTranscript(streamLatestTranscriptRef.current);
        const finalChunk = streamAudioRecoderRef.current?.flush() ?? new Uint8Array(0);
        wsClient.sendMessage(WS_SEND_ACTION_TYPE.ENGINE_FINAL_INPUT, finalChunk);
        if (committed) {
            return;
        }
        streamFinalizingTimerRef.current = setTimeout(() => {
            streamFinalizingTimerRef.current = null;
            streamFinalizingRef.current = false;
        }, STREAM_FINALIZING_TIMEOUT_MS);
    }

    const scheduleContinuousStreamFinalInput = () => {
        if (!streamSentenceActiveRef.current || streamFinalizingRef.current) {
            return;
        }

        clearStreamFinalizeTimer();
        streamFinalizeTimerRef.current = setTimeout(() => {
            streamFinalizeTimerRef.current = null;
            if (!continuousStreamActiveRef.current || ttsBlockedRef.current) {
                return;
            }
            if (Date.now() - streamLastSpeechAtRef.current < STREAM_FINAL_SILENCE_MS) {
                scheduleContinuousStreamFinalInput();
                return;
            }
            sendContinuousStreamFinalInput();
        }, STREAM_FINAL_SILENCE_MS);
    }

    const trackContinuousStreamSpeech = (chunk: Float32Array) => {
        if (!continuousStreamActiveRef.current || ttsBlockedRef.current || streamFinalizingRef.current) {
            return;
        }

        const rms = calculateChunkRms(chunk);
        if (rms >= STREAM_ACTIVITY_RMS_THRESHOLD) {
            if (!streamSentenceActiveRef.current) {
                streamUtteranceStartedAtRef.current = Date.now();
                streamSubmittedCurrentUtteranceRef.current = false;
                streamLatestTranscriptRef.current = "";
                streamLastTranscriptAtRef.current = 0;
            }
            streamSentenceActiveRef.current = true;
            streamLastSpeechAtRef.current = Date.now();
            clearStreamFinalizeTimer();
            return;
        }

        if (streamSentenceActiveRef.current) {
            scheduleContinuousStreamFinalInput();
        }
    }

    const getNativeSpeechRecognitionCtor = () => {
        if (typeof window === "undefined") {
            return null;
        }
        return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null;
    }

    const handleStartNativeRecord = () => {
        const SpeechRecognitionCtor = getNativeSpeechRecognitionCtor();
        if (!SpeechRecognitionCtor) {
            handsFreeRunningRef.current = false;
            autoVoiceStartedRef.current = false;
            setAsrConvertState(false);
            setVoiceModeActive(false);
            setVoiceHint("Browser ASR unavailable");
            addToast({
                title: "Browser SpeechRecognition is unavailable. Use Chrome/Edge on HTTPS.",
                variant: "flat",
                color: "danger"
            });
            return;
        }

        cleanupStreamSession();
        forceStopNativeSpeechRecognition();
        nativeSubmittedRef.current = false;
        nativeRecognitionStartedRef.current = false;
        nativeShouldSendRef.current = true;
        setMessage("");
        setAsrConvertState(true);
        setVoiceModeActive(true);

        const recognition = new SpeechRecognitionCtor();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        recognition.lang = navigator.language?.startsWith("zh") ? navigator.language : "zh-CN";

        recognition.onstart = () => {
            clearNativeStartTimeout();
            nativeFallbackToStreamRef.current = false;
            nativeRecognitionStartedRef.current = true;
            markNativeSpeechActivity();
            setVoiceHint("Listening");
            startAudioTimer();
            setMicRecordState(true);
            setAsrConvertState(false);
            clearNativeListeningWatchdog();
            nativeListeningWatchdogRef.current = setTimeout(() => {
                if (!handsFreeRunningRef.current || nativeDisplayTranscriptRef.current.trim().length > 0 || nativeSubmittedRef.current) {
                    return;
                }
                recoverNativeSpeech(0);
            }, 10000);
        };

        recognition.onspeechstart = () => {
            markNativeSpeechActivity();
            clearNativeSilenceTimer();
        };

        recognition.onspeechend = () => {
            markNativeSpeechActivity();
            if (nativeDisplayTranscriptRef.current.trim().length > 0) {
                scheduleNativeSpeechStop();
            }
        };

        recognition.onresult = (event: any) => {
            markNativeSpeechActivity();
            if (nativeSubmittedRef.current) {
                return;
            }
            clearNativeListeningWatchdog();
            let finalTranscript = nativeFinalTranscriptRef.current;
            let interimTranscript = "";
            let hasFinalResult = false;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0]?.transcript ?? "";
                if (event.results[i].isFinal) {
                    hasFinalResult = true;
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            nativeFinalTranscriptRef.current = finalTranscript;
            const nextTranscript = `${finalTranscript}${interimTranscript}`.trim();
            if (isAssistantEchoTranscript(nextTranscript)) {
                discardNativeTranscriptDraft();
                return;
            }
            nativeDisplayTranscriptRef.current = nextTranscript;
            setMessage(nextTranscript);
            updateNativeTranscriptDraft(nextTranscript);

            if (nextTranscript.length > 0) {
                scheduleNativeSpeechStop();
            }
        };

        recognition.onerror = (event: any) => {
            markNativeSpeechActivity();
            clearNativeStartTimeout();
            const error = String(event?.error || "");
            if (error === "aborted") {
                if (handsFreeRunningRef.current) {
                    recoverNativeSpeech(0);
                }
                return;
            }
            if (error === "no-speech") {
                setVoiceHint("Listening");
                recoverNativeSpeech(0);
                return;
            }
            if (error === "network") {
                setVoiceHint("Browser ASR network issue");
                recoverNativeSpeech(250);
                return;
            }
            setMicRecordState(false);
            setAsrConvertState(false);
            if (error === "service-not-allowed" || error === "language-not-supported") {
                handsFreeRunningRef.current = false;
                autoVoiceStartedRef.current = false;
                setVoiceModeActive(false);
                setVoiceHint("Browser ASR unavailable");
                forceStopNativeSpeechRecognition();
                addToast({
                    title: `Browser speech recognition unavailable: ${error}`,
                    variant: "flat",
                    color: "danger"
                });
                return;
            }
            if (error === "not-allowed" || error === "audio-capture") {
                handsFreeRunningRef.current = false;
                autoVoiceStartedRef.current = false;
                setVoiceModeActive(false);
                setVoiceHint("Click to allow microphone");
            }
            forceStopNativeSpeechRecognition();
            addToast({
                title: event?.error ? `Speech recognition error: ${event.error}` : t('micOpenError'),
                variant: "flat",
                color: "danger"
            });
        };

        recognition.onend = () => {
            markNativeSpeechActivity();
            clearNativeStartTimeout();
            clearNativeListeningWatchdog();
            if (!nativeShouldSendRef.current) {
                setMicRecordState(false);
                setAsrConvertState(false);
                resetNativeSpeechState();
                discardNativeTranscriptDraft();
                if (handsFreeRunningRef.current) {
                    nativeRestartPendingRef.current = true;
                    scheduleNativeRestart(0);
                }
                return;
            }
            if (nativeSubmittedRef.current) {
                setMicRecordState(false);
                setAsrConvertState(false);
                resetNativeSpeechState();
                scheduleNativeRestart();
                return;
            }
            const transcript = nativeDisplayTranscriptRef.current.trim();

            setMicRecordState(false);
            setAsrConvertState(false);

            if (transcript.length > 0) {
                submitNativeSpeechTranscript();
                resetNativeSpeechState();
                scheduleNativeRestart();
                return;
            }

            resetNativeSpeechState();

            if (transcript.length === 0) {
                clearNativeTranscriptDraft();
                setMessage("");
                scheduleNativeRestart();
            }
        };

        nativeRecognitionRef.current = recognition;
        clearNativeStartTimeout();
        nativeStartTimeoutRef.current = setTimeout(() => {
            if (nativeRecognitionRef.current === recognition && !nativeRecognitionStartedRef.current) {
                recoverNativeSpeech(0);
            }
        }, NATIVE_SPEECH_START_TIMEOUT_MS);
        const startRecognition = () => {
            try {
                setVoiceHint("Starting browser ASR");
                recognition.start();
            } catch (error: any) {
                clearNativeStartTimeout();
                setMicRecordState(false);
                setAsrConvertState(false);
                setVoiceModeActive(true);
                setVoiceHint("Browser ASR start failed");
                recoverNativeSpeech(150);
            }
        };

        const requestMic = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
        const shouldPreflightMic = false;
        if (shouldPreflightMic && requestMic && !micPermissionReadyRef.current) {
            setVoiceHint("Requesting microphone");
            requestMic({ audio: true })
                .then((stream) => {
                    micPermissionReadyRef.current = true;
                    stream.getTracks().forEach((track) => track.stop());
                    startRecognition();
                })
                .catch(() => {
                    handsFreeRunningRef.current = false;
                    autoVoiceStartedRef.current = false;
                    clearNativeStartTimeout();
                    setMicRecordState(false);
                    setAsrConvertState(false);
                    setVoiceModeActive(false);
                    setVoiceHint("Microphone blocked");
                    forceStopNativeSpeechRecognition();
                    addToast({
                        title: "Microphone permission blocked",
                        variant: "flat",
                        color: "danger"
                    });
                });
            return;
        }

        startRecognition();
    }

    const handleStartStreamRecord = () => {
        if (streamConnectingRef.current || streamAudioRecoderRef.current || streamAsrWsClientRef.current) {
            handsFreeRunningRef.current = true;
            continuousStreamActiveRef.current = true;
            setVoiceModeActive(true);
            return;
        }
        forceStopNativeSpeechRecognition();
        cleanupStreamSession();
        clearNativeTranscriptDraft();
        setMessage("");
        setStartAsrConvert(true);
        setVoiceModeActive(true);
        streamConnectingRef.current = true;
        continuousStreamActiveRef.current = true;
        streamTranscriptDraftActiveRef.current = false;
        streamLastFinalTextRef.current = "";
        streamLastFinalAtRef.current = 0;
        streamBargeInFrameCountRef.current = 0;
        streamStaleResultIgnoreUntilRef.current = 0;
        streamSentenceActiveRef.current = false;
        streamLastSpeechAtRef.current = 0;
        streamLatestTranscriptRef.current = "";
        streamLastTranscriptAtRef.current = 0;
        streamUtteranceStartedAtRef.current = 0;
        streamSubmittedCurrentUtteranceRef.current = false;
        streamFinalizingRef.current = false;
        clearStreamFinalizeTimer();
        const streamSessionId = latestStreamSessionIdRef.current;

        const audioRecoder = new AudioRecoder(
            16000,
            1,
            16000 / 1000 * 60 * 2,
            (chunk: Uint8Array) => {
                if (ttsBlockedRef.current || streamFinalizingRef.current) {
                    return;
                }
                if (streamEngineReadyRef.current && streamAsrWsClientRef.current?.isConnected()) {
                    streamAsrWsClientRef.current.sendMessage(WS_SEND_ACTION_TYPE.ENGINE_PARTIAL_INPUT, chunk);
                }
            },
            (chunk: Float32Array) => {
                maybeInterruptContinuousStreamPlayback(chunk);
                trackContinuousStreamSpeech(chunk);
            }
        );

        const asrWsClient = createASRWebsocketClient({
            engine: asrEngine,
            config: asrSettings,
            onMessage: (action: string, data: Uint8Array) => {
                if (streamSessionId !== latestStreamSessionIdRef.current) {
                    return;
                }
                const recvAction = action as WS_RECV_ACTION_TYPE;
                const recvData = new TextDecoder('utf-8').decode(data).trim();

                switch (recvAction) {
                    case WS_RECV_ACTION_TYPE.ENGINE_INITIALZING:
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_STARTED:
                        streamConnectingRef.current = false;
                        streamEngineReadyRef.current = true;
                        audioRecoder.start().then(() => {
                            setStartMicRecord(true);
                            setStartAsrConvert(false);
                        }).catch((error: Error) => {
                            continuousStreamActiveRef.current = false;
                            cleanupStreamSession();
                            setStartMicRecord(false);
                            setStartAsrConvert(false);
                            addToast({
                                title: error.message,
                                variant: "flat",
                                color: "danger"
                            })
                        });
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_PARTIAL_OUTPUT:
                        streamFinalizingRef.current = false;
                        clearStreamFinalizingTimer();
                        if (Date.now() < streamStaleResultIgnoreUntilRef.current) {
                            break;
                        }
                        if (ttsBlockedRef.current) {
                            setMessage("");
                            break;
                        }
                        if (recvData.length > 0) {
                            streamLatestTranscriptRef.current = recvData;
                            streamLastTranscriptAtRef.current = Date.now();
                            setMessage(recvData);
                            updateStreamTranscriptDraft(recvData);
                            window.setTimeout(maybeSubmitStableStreamPartial, STREAM_PARTIAL_STABLE_COMMIT_MS);
                            window.setTimeout(maybeSubmitStableStreamPartial, STREAM_PARTIAL_COMMIT_MAX_MS);
                        } else {
                            setMessage("");
                        }
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_FINAL_OUTPUT:
                        streamFinalizingRef.current = false;
                        clearStreamFinalizingTimer();
                        if (Date.now() < streamStaleResultIgnoreUntilRef.current) {
                            break;
                        }
                        if (ttsBlockedRef.current) {
                            setMessage("");
                            break;
                        }
                        if (recvData.length === 0) {
                            break;
                        }

                        submitStreamTranscript(recvData);
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_STOPPED:
                        if (!continuousStreamActiveRef.current) {
                            cleanupStreamSession();
                            setStartMicRecord(false);
                            setStartAsrConvert(false);
                        }
                        break;
                    case WS_RECV_ACTION_TYPE.ERROR:
                        continuousStreamActiveRef.current = false;
                        streamConnectingRef.current = false;
                        setStartMicRecord(false);
                        setStartAsrConvert(false);
                        cleanupStreamSession();
                        addToast({
                            title: recvData,
                            variant: "flat",
                            color: "danger"
                        })
                        break;
                    default:
                        break;
                }
            },
            onError: (error: Error) => {
                continuousStreamActiveRef.current = false;
                streamConnectingRef.current = false;
                setMicRecordState(false);
                setAsrConvertState(false);
                cleanupStreamSession();
                addToast({
                    title: error.message,
                    variant: "flat",
                    color: "danger"
                })
            }
        });

        streamAudioRecoderRef.current = audioRecoder;
        streamAsrWsClientRef.current = asrWsClient;
        asrWsClient.connect();
    }

    const handleStopStreamRecord = () => {
        continuousStreamActiveRef.current = false;
        streamBargeInFrameCountRef.current = 0;
        streamStaleResultIgnoreUntilRef.current = 0;
        clearStreamFinalizeTimer();
        clearStreamFinalizingTimer();
        streamSentenceActiveRef.current = false;
        streamLastSpeechAtRef.current = 0;
        streamFinalizingRef.current = false;
        setStartMicRecord(false);
        setMessage("");
        setStartAsrConvert(true);
        setVoiceModeActive(false);
        cleanupStreamSession();
        setAsrConvertState(false);
    }

    const handleStartRecord = () => {
        if (startAsrConvert) {
            return;
        }
        setVoiceHint("Listening");
        setVoiceModeActive(true);
        if (shouldUseRealtimeVoice()) {
            handsFreeRunningRef.current = true;
            nativeRestartPendingRef.current = false;
            if (shouldPreferNativeSpeech()) {
                handleStartNativeRecord();
                return;
            }
            handleStartStreamRecord();
            return;
        }
        handsFreeRunningRef.current = handsFreeMode;

        abort();
        if (micRecoder == null) {
            micRecoder = new Recorder({
                sampleBits: 16,         // 闁插洦鐗辨担宥嗘殶閿涘本鏁幐?8 閹?16閿涘矂绮拋銈嗘Ц16
                sampleRate: 16000,      // 闁插洦鐗遍悳鍥风礉閺€顖涘瘮 11025閵?6000閵?2050閵?4000閵?4100閵?8000
                numChannels: 1,         // 婢逛即浜鹃敍灞炬暜閹?1 閹?2閿?姒涙顓婚弰?
                compiling: false,
            })
        }
        micRecoder.start().then(
            () => {
                startAudioTimer();
                setStartMicRecord(true);
            }, () => {
                addToast({
                    title: t('micOpenError'),
                    variant: "flat",
                    color: "danger"
                })
            }
        )
    }

    const handleStopRecord = async () => {
        handsFreeRunningRef.current = false;
        nativeRestartPendingRef.current = false;
        setVoiceModeActive(false);
        setVoiceHint("Voice paused");
        clearHandsFreeRestartTimer();
        if (shouldUseRealtimeVoice()) {
            if (nativeRecognitionRef.current) {
                stopNativeSpeechRecognition(true);
                return;
            }
            if (startMicRecord || startAsrConvert || streamAudioRecoderRef.current || streamAsrWsClientRef.current) {
                handleStopStreamRecord();
                return;
            }
            setMessage("");
            return;
        }

        micRecoder.stop();
        setStartMicRecord(false);
        if (!stopAudioTimer()) return;
        setMessage(t('speech2text'));
        setStartAsrConvert(true);
        const requestId = ++latestFileAsrRequestIdRef.current;
        const mp3Blob = convertToMp3(micRecoder);
        let asrResult = "";
        asrResult = await api_asr_infer_file(asrEngine, asrSettings, mp3Blob);
        if (requestId !== latestFileAsrRequestIdRef.current) {
            return;
        }
        const normalizedResult = asrResult.trim();
        setStartAsrConvert(false);
        if (normalizedResult.length > 0) {
            setMessage(normalizedResult);
            chat(normalizedResult, postProcess);
            setMessage("");
        } else {
            setMessage("");
        }
    }

    const onFileClick = () => {
        // TODO: open file dialog
    }
    const onSendClick = () => {
        if (message == "") return;
        chat(message, postProcess);
        setMessage("");
    }
    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter") {
            onSendClick();
        }
    }
    // 韫囶偅宓庨柨?
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const recording = voiceModeActive || startMicRecord || startAsrConvert;
            const busy = startAsrConvert;
            if (busy) {
                return;
            }
            if (e.key === "m" && e.ctrlKey) {
                if (recording) {
                    handleStopRecord();
                } else {
                    handleStartRecord();
                }
            }
        }
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        }
    }, [voiceModeActive, startMicRecord, startAsrConvert, asrInferType, asrEngine])

    useEffect(() => {
        if (!ttsBlocked || shouldUseRealtimeVoice()) {
            return;
        }
        stopActiveAsrForPlayback();
    }, [ttsBlocked, asrInferType, asrEngine])

    useEffect(() => {
        const handleAssistantSpeechText = (event: Event) => {
            const detail = (event as CustomEvent<{ text?: string; at?: number }>).detail;
            if (detail?.text) {
                rememberAssistantSpeechText(detail.text, detail.at ?? Date.now());
            }
        };

        const handleOpeningGreeting = (event: Event) => {
            const state = (event as CustomEvent<{ state?: string }>).detail?.state;
            if (state === "starting" || state === "playing") {
                openingGreetingActiveRef.current = true;
                nativeRestartPendingRef.current = true;
                return;
            }
            if (state === "done") {
                openingGreetingActiveRef.current = false;
                nativeRestartPendingRef.current = true;
                scheduleNativeRestart(0);
            }
        };

        const handleTtsState = (event: Event) => {
            const blocked = !!(event as CustomEvent<{ blocked?: boolean }>).detail?.blocked;
            if (blocked) {
                assistantShortEchoGraceUntilRef.current = Date.now() + ASSISTANT_SHORT_ECHO_GRACE_MS;
                nativeRestartPendingRef.current = true;
                return;
            }
            assistantShortEchoGraceUntilRef.current = Date.now() + ASSISTANT_SHORT_ECHO_GRACE_MS;
            if (nativeDisplayTranscriptRef.current.trim().length > 0 && !nativeSubmittedRef.current) {
                scheduleNativeSpeechStop();
            }
            if (handsFreeRunningRef.current && shouldPreferNativeSpeech() && !nativeRecognitionRef.current) {
                nativeRestartPendingRef.current = true;
                scheduleNativeRestart(0);
            }
        };

        document.addEventListener('sentio:assistant-speech-text', handleAssistantSpeechText as EventListener);
        document.addEventListener('sentio:opening-greeting', handleOpeningGreeting as EventListener);
        document.addEventListener('sentio:tts-state', handleTtsState as EventListener);
        openingGreetingFallbackTimerRef.current = window.setTimeout(() => {
            openingGreetingActiveRef.current = false;
            nativeRestartPendingRef.current = true;
            if (shouldPreferNativeSpeech()) {
                scheduleNativeRestart(0);
            }
        }, 750);

        return () => {
            handsFreeRunningRef.current = false;
            autoVoiceStartedRef.current = false;
            setVoiceModeActive(false);
            document.removeEventListener('sentio:assistant-speech-text', handleAssistantSpeechText as EventListener);
            document.removeEventListener('sentio:opening-greeting', handleOpeningGreeting as EventListener);
            document.removeEventListener('sentio:tts-state', handleTtsState as EventListener);
            if (openingGreetingFallbackTimerRef.current) {
                window.clearTimeout(openingGreetingFallbackTimerRef.current);
                openingGreetingFallbackTimerRef.current = null;
            }
            clearHandsFreeRestartTimer();
            forceStopNativeSpeechRecognition();
            cleanupStreamSession();
        }
    }, [])

    useEffect(() => {
        if (autoVoiceStartedRef.current) {
            return;
        }
        if (isNativeVoiceBusy()) {
            return;
        }
        autoVoiceStartedRef.current = true;
        handsFreeRunningRef.current = true;
        setVoiceModeActive(true);
        nativeRestartPendingRef.current = false;
        setVoiceHint("Starting voice");
        window.setTimeout(() => {
            if (isNativeVoiceBusy() || openingGreetingActiveRef.current) {
                autoVoiceStartedRef.current = false;
                nativeRestartPendingRef.current = true;
                return;
            }
            handleStartRecord();
        }, 0);
    }, [startMicRecord, startAsrConvert])

    useEffect(() => {
        if (!handsFreeRunningRef.current || !shouldPreferNativeSpeech()) {
            return;
        }
        if (isNativeVoiceBusy() || openingGreetingActiveRef.current || ttsBlockedRef.current) {
            return;
        }
        if (nativeRecognitionRef.current) {
            return;
        }
        nativeRestartPendingRef.current = false;
        handleStartNativeRecord();
        return () => {
            clearHandsFreeRestartTimer();
        }
    }, [chatting, startMicRecord, startAsrConvert, ttsBlocked, asrInferType, asrEngine])

    useEffect(() => {
        if (!enableASR) {
            return;
        }
        const timer = window.setInterval(() => {
            if (!handsFreeRunningRef.current || !shouldPreferNativeSpeech()) {
                return;
            }
            if (openingGreetingActiveRef.current || ttsBlockedRef.current || chatting) {
                return;
            }
            const now = Date.now();
            if (nativeRecognitionRef.current && nativeRecognitionStartedRef.current) {
                const lastActivityAt = nativeLastActivityAtRef.current || now;
                const staleForMs = now - lastActivityAt;
                const restartCooldownMs = now - nativeLastStaleRestartAtRef.current;
                if (staleForMs > NATIVE_SPEECH_STALE_RESTART_MS && restartCooldownMs > NATIVE_SPEECH_STALE_RESTART_COOLDOWN_MS) {
                    console.warn("[Voice] Browser ASR stale, restarting recognition", { staleForMs });
                    nativeLastStaleRestartAtRef.current = now;
                    recoverNativeSpeech(0);
                }
                return;
            }
            if (isNativeVoiceBusy()) {
                return;
            }
            nativeRestartPendingRef.current = false;
            handleStartNativeRecord();
        }, 200);
        return () => {
            window.clearInterval(timer);
        }
    }, [enableASR, chatting, startMicRecord, startAsrConvert, asrInferType, asrEngine])

    const isRealtimeStreamMode = shouldUseRealtimeVoice();
    const voiceInputRunning = startMicRecord || startAsrConvert || !!nativeRecognitionRef.current || !!streamAudioRecoderRef.current || !!streamAsrWsClientRef.current;
    const micRecording = voiceModeActive || voiceInputRunning;
    const asrBusy = startAsrConvert;
    const voiceStatus = chatting || ttsBlocked
        ? "Replying"
        : asrBusy
            ? "Recognizing"
            : micRecording
                ? "Listening"
                : voiceHint;
    const stopAssistant = () => {
        if (isRealtimeStreamMode) {
            abort();
            Live2dManager.getInstance().stopAudio();
            return;
        }
        abort();
    }
    const canStopAssistant = chatting || ttsBlocked;

    return (
        <div className='flex flex-col w-4/5 md:w-2/3 2xl:w-1/2 items-start z-10 gap-2'>
            <div className='flex w-full items-center z-10 gap-2'>
                <Tooltip className='opacity-90' content={voiceModeActive ? 'Voice chat active' : 'Voice chat (Ctrl+M)'}>
                    <button
                        type="button"
                        onPointerDown={(event) => {
                            event.stopPropagation();
                            markVoiceButtonInteraction();
                        }}
                        onTouchStart={(event) => {
                            event.stopPropagation();
                            markVoiceButtonInteraction();
                        }}
                        onClick={(voiceInputRunning || asrBusy) ? handleStopRecord : handleStartRecord}
                        aria-label="Voice chat"
                        className={clsx(
                            "flex items-center justify-center rounded-full transition-all duration-200",
                            (voiceInputRunning || asrBusy)
                                ? "w-12 h-12 bg-red-500 text-white shadow-lg shadow-red-500/40 animate-pulse"
                                : true
                                    ? "w-12 h-12 bg-green-500 text-white shadow-lg shadow-green-500/40 hover:bg-green-600 hover:scale-105"
                                    : "w-12 h-12 bg-gray-400 text-gray-200 cursor-not-allowed"
                        )}
                    >
                        {(voiceInputRunning || asrBusy) ? (
                            <StopCircleIcon className='size-6' />
                        ) : (
                            asrBusy ? (
                                <Spinner size="sm" color="white" />
                            ) : (
                                <MicrophoneIcon className='size-6' />
                            )
                        )}
                    </button>
                </Tooltip>
                <div className="opacity-90 flex-1 min-w-0 h-12 rounded-full bg-zinc-900/85 text-white px-5 flex items-center shadow-lg">
                    <span className="text-sm md:text-base truncate">{voiceStatus}</span>
                </div>
                <Tooltip className='opacity-90' content={canStopAssistant ? 'Stop reply' : 'No reply playing'}>
                    <button
                        type="button"
                        onClick={stopAssistant}
                        disabled={!canStopAssistant}
                        className={clsx(
                            "w-12 h-12 shrink-0 rounded-full flex items-center justify-center transition-all duration-200 shadow-lg",
                            canStopAssistant
                                ? "bg-red-500 text-white shadow-red-500/40 hover:bg-red-600 hover:scale-105"
                                : "bg-zinc-700/70 text-zinc-400 cursor-not-allowed shadow-zinc-900/20"
                        )}
                        aria-label="Stop reply"
                    >
                        <StopCircleIcon className='size-6' />
                    </button>
                </Tooltip>
            </div>
        </div>
    )
});

const convertFloat32ToAnalyseData = (float32Data: Float32Array) => {
    const analyseData = new Uint8Array(float32Data.length);
    const dataLength = float32Data.length;

    for (let i = 0; i < dataLength; i++) {
        const value = float32Data[i];
        // 鐏?-1 閸?1 閻ㄥ嫬鈧吋妲х亸鍕煂 0 閸?255
        const mappedValue = Math.round((value + 1) * 128);
        // 绾喕绻氶崐鐓庢躬 0 閸?255 娑斿妫?
        analyseData[i] = Math.max(0, Math.min(255, mappedValue));
    }

    return analyseData;
}

const calculateChunkRms = (float32Data: Float32Array) => {
    if (float32Data.length === 0) {
        return 0;
    }

    let sumSquares = 0;
    for (let i = 0; i < float32Data.length; i++) {
        const sample = float32Data[i];
        sumSquares += sample * sample;
    }

    return Math.sqrt(sumSquares / float32Data.length);
}

export const ChatVadInput = memo(() => {
    const t = useTranslations('Products.sentio');
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const { engine: asrEngine, settings: asrSettings } = useSentioAsrStore();
    const { chat, abort } = useChatWithAgent();
    const { startAudioTimer, stopAudioTimer } = useAudioTimer();
    const waveData = useRef<Uint8Array | null>();
    const drawId = useRef<number | null>(null);
    const latestSpeechRequestIdRef = useRef(0);
    const { blocked: ttsBlocked, blockedRef: ttsBlockedRef } = useTtsPlaybackGuard();

    const handleSpeechEnd = async (audio: Float32Array) => {
        const requestId = ++latestSpeechRequestIdRef.current;
        const mp3Blob = convertFloat32ArrayToMp3(audio);
        let asrResult = ""
        asrResult = await api_asr_infer_file(asrEngine, asrSettings, mp3Blob);
        if (requestId !== latestSpeechRequestIdRef.current) {
            return;
        }
        if (asrResult.trim().length > 0) {
            chat(asrResult);
        }
    }
    const vad = useMicVAD({
        baseAssetPath: getSrcPath("vad/"),
        onnxWASMBasePath: getSrcPath("vad/"),
        // model: "v5",
        redemptionFrames: 30,
        minSpeechFrames: 8,
        positiveSpeechThreshold: 0.3,
        negativeSpeechThreshold: 0.25,
        onSpeechStart: () => {
            if (ttsBlockedRef.current) {
                return;
            }
            abort();
            startAudioTimer();
        },
        onFrameProcessed: (audio, frame) => {
            // frame 鏉?dataUnit8Array
            const dataUnit8Array = convertFloat32ToAnalyseData(frame);
            waveData.current = dataUnit8Array;
        },
        onSpeechEnd: (audio) => {
            if (ttsBlockedRef.current) {
                return;
            }
            if (stopAudioTimer() && audio && audio.length > 0) {
                handleSpeechEnd(audio);
            }
        },
    });

    useEffect(() => {
        try {
            if (ttsBlocked) {
                (vad as any).pause?.();
            } else {
                (vad as any).start?.();
            }
        } catch {}
    }, [ttsBlocked, vad])

    const initCanvas = () => {
        const dpr = window.devicePixelRatio || 1
        const canvas = document.getElementById('voice-input') as HTMLCanvasElement

        if (canvas) {
            const { width: cssWidth, height: cssHeight } = canvas.getBoundingClientRect()

            canvas.width = dpr * cssWidth
            canvas.height = dpr * cssHeight
            canvasRef.current = canvas

            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.scale(dpr, dpr)
                ctx.fillStyle = 'rgb(215, 183, 237)'
                ctxRef.current = ctx
            }
        }
    }

    function drawCanvas() {
        const canvas = canvasRef.current!
        const ctx = ctxRef.current!
        if (canvas && ctx && waveData.current) {
            const resolution = 3
            const dataArray = [].slice.call(waveData.current)
            const lineLength = parseInt(`${canvas.width / resolution}`)
            const gap = parseInt(`${dataArray.length / lineLength}`)

            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.beginPath()
            let x = 0
            for (let i = 0; i < lineLength; i++) {
                let v = dataArray.slice(i * gap, i * gap + gap).reduce((prev: number, next: number) => {
                    return prev + next
                }, 0) / gap

                // if (v < 128)
                //     v = 128
                // if (v > 178)
                //     v = 178
                const y = (v - 128) / 128 * canvas.height

                ctx.moveTo(x, 16)
                if (ctx.roundRect)
                    ctx.roundRect(x, 16 - y, 2, y, [1, 1, 0, 0])
                else
                    ctx.rect(x, 16 - y, 2, y)
                ctx.fill()
                x += resolution
            }
            ctx.closePath();
        }
        drawId.current = requestAnimationFrame(drawCanvas);
    }

    useEffect(() => {
        initCanvas();
        drawId.current = requestAnimationFrame(drawCanvas);
        return () => {
            !!drawId.current && cancelAnimationFrame(drawId.current);
        }
    }, [])

    return (
        // <div>{vad.userSpeaking ? "User is speaking" : "no speaking"}</div>
        <div className='flex flex-col h-10 w-1/2 md:w-1/3 items-center'>
            {vad.loading && <div className='flex flex-row gap-1 items-center'>
                    <p className='text-xl font-bold'>{t('loading')}</p>
                    <Spinner color='warning' variant="dots" size='lg'/>
                </div>
            }
            <canvas id="voice-input" className='h-full w-full' />
        </div>
        
    )
});

export const ChatStreamInput = memo(() => {
    const t = useTranslations('Products.sentio');
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)
    const { chat, abort } = useChatWithAgent();
    const { engine, settings } = useSentioAsrStore();
    const waveData = useRef<Uint8Array | null>();
    const drawId = useRef<number | null>(null);
    const [engineLoading, setEngineLoading] = useState<boolean>(true);
    const engineReady = useRef<boolean>(false);
    const sessionIdRef = useRef(0);
    const lastFinalTextRef = useRef("");
    const lastFinalAtRef = useRef(0);
    const bargeInFrameCountRef = useRef(0);
    const staleResultIgnoreUntilRef = useRef(0);
    const { blocked: ttsBlocked, blockedRef: ttsBlockedRef } = useTtsPlaybackGuard();

    const maybeInterruptPlayback = (chunk: Float32Array) => {
        if (!ttsBlockedRef.current) {
            bargeInFrameCountRef.current = 0;
            return;
        }

        const rms = calculateChunkRms(chunk);
        if (rms < STREAM_BARGE_IN_RMS_THRESHOLD) {
            bargeInFrameCountRef.current = 0;
            return;
        }

        bargeInFrameCountRef.current += 1;
        if (bargeInFrameCountRef.current < STREAM_BARGE_IN_MIN_FRAMES) {
            return;
        }

        bargeInFrameCountRef.current = 0;
        staleResultIgnoreUntilRef.current = Date.now() + STREAM_STALE_RESULT_IGNORE_MS;
        abort();
        Live2dManager.getInstance().stopAudio();
    }

    const initCanvas = () => {
        const dpr = window.devicePixelRatio || 1
        const canvas = document.getElementById('voice-input') as HTMLCanvasElement

        if (canvas) {
            const { width: cssWidth, height: cssHeight } = canvas.getBoundingClientRect()

            canvas.width = dpr * cssWidth
            canvas.height = dpr * cssHeight
            canvasRef.current = canvas

            const ctx = canvas.getContext('2d')
            if (ctx) {
                ctx.scale(dpr, dpr)
                ctx.fillStyle = 'rgb(215, 183, 237)'
                ctxRef.current = ctx
            }
        }
    }

    function drawCanvas() {
        const canvas = canvasRef.current!
        const ctx = ctxRef.current!
        if (canvas && ctx && waveData.current) {
            const dataArray = [].slice.call(waveData.current)
            const resolution = 10
            const lineLength = parseInt(`${canvas.width / resolution}`)
            const gap = parseInt(`${dataArray.length / lineLength}`)
            ctx.clearRect(0, 0, canvas.width, canvas.height)
            ctx.beginPath()
            let x = 0
            for (let i = 0; i < lineLength; i++) {
                let v = dataArray.slice(i * gap, i * gap + gap).reduce((prev: number, next: number) => {
                    return prev + next
                }, 0) / gap

                // if (v < 128)
                //     v = 128
                // if (v > 178)
                //     v = 178
                const y = (v - 128) / 128 * canvas.height

                ctx.moveTo(x, 16)
                if (ctx.roundRect)
                    ctx.roundRect(x, 16 - y, 2, y, [1, 1, 0, 0])
                else
                    ctx.rect(x, 16 - y, 2, y)
                ctx.fill()
                x += resolution
            }
            ctx.closePath();
        }
        drawId.current = requestAnimationFrame(drawCanvas);
    }

    useEffect(() => {
        const sessionId = ++sessionIdRef.current;
        const asrWsClient = createASRWebsocketClient({
            engine: engine,
            config: settings,
            onMessage: (action: string, data: Uint8Array) => {
                if (sessionId !== sessionIdRef.current) {
                    return;
                }
                const recvAction = action as WS_RECV_ACTION_TYPE;
                const recvData = new TextDecoder('utf-8').decode(data).trim();
                switch (recvAction) {
                    case WS_RECV_ACTION_TYPE.ENGINE_INITIALZING:
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_STARTED:
                        setEngineLoading(false);
                        engineReady.current = true;
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_PARTIAL_OUTPUT:
                        if (Date.now() < staleResultIgnoreUntilRef.current) {
                            break;
                        }
                        if (ttsBlockedRef.current) {
                            break;
                        }
                        // 鐎圭偞妞傜拠鍡楀焼缂佹挻鐏?- 娴犲懐鏁ゆ禍搴ょ殶鐠囨洩绱濇稉宥嗗潑閸旂姴鍩岀€电鐦界拋鏉跨秿
                        console.log('[ASR] Partial result:', recvData);
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_FINAL_OUTPUT:
                        if (Date.now() < staleResultIgnoreUntilRef.current) {
                            break;
                        }
                        if (ttsBlockedRef.current) {
                            console.warn('[ASR] Drop final result during TTS playback:', recvData);
                            break;
                        }
                        if (recvData.length === 0) {
                            break;
                        }
                        const now = Date.now();
                        if (recvData === lastFinalTextRef.current && now - lastFinalAtRef.current < 3000) {
                            console.warn('[ASR] Drop duplicate final result:', recvData);
                            break;
                        }
                        lastFinalTextRef.current = recvData;
                        lastFinalAtRef.current = now;
                        chat(recvData);
                        break;
                    case WS_RECV_ACTION_TYPE.ENGINE_STOPPED:
                        setEngineLoading(true);
                        engineReady.current = false;
                        break;
                    case WS_RECV_ACTION_TYPE.ERROR:
                        setEngineLoading(true);
                        engineReady.current = false;
                        addToast({
                            title: recvData,
                            variant: "flat",
                            color: "danger"
                        })
                        break;
                    default:
                        break;
                }
            },
            onError: (error: Error) => {
                addToast({
                    title: error.message,
                    variant: "flat",
                    color: "danger"
                })
            }
        })
        const audioRecoder = new AudioRecoder(
            16000, 
            1, 
            16000 / 1000 * 60 * 2, // 60ms閺佺増宓?鐎涙濡弫? 娑撯偓娑撶專rame 16娴? 2娑撶寵yte)
            (chunk: Uint8Array) => {
                try {
                    if (ttsBlockedRef.current) {
                        return;
                    }
                    if (asrWsClient.isConnected() && engineReady.current) {
                        asrWsClient.sendMessage(WS_SEND_ACTION_TYPE.ENGINE_PARTIAL_INPUT, chunk) 
                    }
                } catch(error: any) {
                    addToast({
                        title: error.message,
                        variant: "flat",
                        color: "danger"
                    })
                }
            },
            (chunk: Float32Array) => {
                maybeInterruptPlayback(chunk);
                if (engineReady.current) {
                    waveData.current = convertFloat32ToAnalyseData(chunk);
                }
            }
        );
        initCanvas();
        drawId.current = requestAnimationFrame(drawCanvas);
        asrWsClient.connect();
        audioRecoder.start();

        return () => {
            sessionIdRef.current += 1;
            audioRecoder.stop();
            asrWsClient.disconnect();
            !!drawId.current && cancelAnimationFrame(drawId.current);
        }
    }, [])

    useEffect(() => {
        if (!ttsBlocked) {
            bargeInFrameCountRef.current = 0;
        }
    }, [ttsBlocked])

    return (
        <div className='flex flex-col h-10 w-1/2 md:w-1/3 items-center'>
            {engineLoading && <div className='flex flex-row gap-1 items-center'>
                    <p className='text-xl font-bold'>{t('loading')}</p>
                    <Spinner color='warning' variant="dots" size='lg'/>
                </div>
            }
            <canvas id="voice-input" className='h-full w-full' />
        </div>
        
    )
});
