'use client'

import { useEffect, useRef, useState } from 'react';
import { addToast } from '@heroui/react';
import { AudioRecoder } from '@/lib/utils/audio';
import { getWsUrl } from '@/lib/api/requests';
import { CHAT_ROLE, ChatMessage } from '@/lib/protocol';
import {
    useChatRecordStore,
    useSentioAgentStore,
    useSentioAsrStore,
    useSentioTtsStore,
} from '@/lib/store/sentio';
import { Live2dManager } from '@/lib/live2d/live2dManager';

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

const ensureAiPlaceholder = (
    lastRecord: ChatMessage | undefined,
    addChatRecord: (message: ChatMessage) => void,
) => {
    if (!lastRecord || lastRecord.role !== CHAT_ROLE.AI) {
        addChatRecord({ role: CHAT_ROLE.AI, think: "", content: "" });
    }
}

export const useRealtimeVoice = () => {
    const { engine: asrEngine, settings: asrSettings } = useSentioAsrStore();
    const { engine: agentEngine, settings: agentSettings } = useSentioAgentStore();
    const { engine: ttsEngine, settings: ttsSettings } = useSentioTtsStore();
    const { addChatRecord, updateLastRecord, deleteLastRecord, getLastRecord } = useChatRecordStore();
    const { blocked: ttsBlocked, blockedRef: ttsBlockedRef } = useTtsPlaybackGuard();

    const [isRecording, setIsRecording] = useState(false);
    const [isConnecting, setIsConnecting] = useState(false);
    const [partialText, setPartialText] = useState("");
    const [isAssistantResponding, setIsAssistantResponding] = useState(false);
    const [statusText, setStatusText] = useState("Voice ready");

    const wsRef = useRef<WebSocket | null>(null);
    const recorderRef = useRef<AudioRecoder | null>(null);
    const activeSessionIdRef = useRef(0);
    const isRecordingRef = useRef(false);
    const isConnectingRef = useRef(false);
    const isAssistantRespondingRef = useRef(false);
    const assistantThinkRef = useRef("");
    const assistantTextRef = useRef("");
    const transcriptDraftActiveRef = useRef(false);
    const lastAudioSentAtRef = useRef(0);

    const setAssistantResponding = (responding: boolean) => {
        isAssistantRespondingRef.current = responding;
        setIsAssistantResponding(responding);
    }

    const setRecordingState = (recording: boolean) => {
        isRecordingRef.current = recording;
        setIsRecording(recording);
    }

    const setConnectingState = (connecting: boolean) => {
        isConnectingRef.current = connecting;
        setIsConnecting(connecting);
    }

    const resetAssistantDraft = () => {
        assistantThinkRef.current = "";
        assistantTextRef.current = "";
    }

    const syncLastAiRecord = () => {
        const lastRecord = getLastRecord();
        ensureAiPlaceholder(lastRecord, addChatRecord);
        updateLastRecord({
            role: CHAT_ROLE.AI,
            think: assistantThinkRef.current,
            content: assistantTextRef.current || "...",
        });
    }

    const updateTranscriptDraft = (text: string) => {
        const nextText = text.trim();
        if (!nextText) {
            return;
        }

        const draftRecord = {
            role: CHAT_ROLE.HUMAN,
            think: "",
            content: nextText,
        };

        const lastRecord = getLastRecord();
        if (transcriptDraftActiveRef.current && lastRecord?.role === CHAT_ROLE.HUMAN) {
            updateLastRecord(draftRecord);
            return;
        }

        addChatRecord(draftRecord);
        transcriptDraftActiveRef.current = true;
    }

    const commitTranscriptDraft = (text: string) => {
        const finalText = text.trim();
        if (!finalText) {
            clearTranscriptDraft();
            return;
        }

        updateTranscriptDraft(finalText);
        transcriptDraftActiveRef.current = false;
    }

    const clearTranscriptDraft = () => {
        if (!transcriptDraftActiveRef.current) {
            return;
        }
        const lastRecord = getLastRecord();
        if (lastRecord?.role === CHAT_ROLE.HUMAN) {
            deleteLastRecord();
        }
        transcriptDraftActiveRef.current = false;
    }

    const playAudioChunk = async (audioData: ArrayBuffer) => {
        const manager = Live2dManager.getInstance();
        manager.pushAudioQueue(audioData);
        manager.playAudio();
    }

    const cleanupSession = (closeSocket: boolean = true) => {
        recorderRef.current?.stop();
        recorderRef.current = null;

        const currentWs = wsRef.current;
        wsRef.current = null;
        if (closeSocket && currentWs) {
            try {
                currentWs.close();
            } catch {}
        }

        clearTranscriptDraft();
        setRecordingState(false);
        setConnectingState(false);
        setAssistantResponding(false);
        setPartialText("");
        setStatusText("Voice paused");
    }

    const interrupt = async () => {
        Live2dManager.getInstance().stopAudio();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'interrupt' }));
        }
        clearTranscriptDraft();
        setAssistantResponding(false);
    }

    const stop = async () => {
        activeSessionIdRef.current += 1;
        Live2dManager.getInstance().stopAudio();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ type: 'stop' }));
        }
        cleanupSession();
    }

    const handleRealtimeEvent = async (sessionId: number, payload: any) => {
        if (sessionId !== activeSessionIdRef.current) {
            return;
        }

        switch (payload?.type) {
            case 'ready':
                setStatusText("Voice connected");
                return;
            case 'configured':
                setStatusText("Listening");
                return;
            case 'vad_state':
                setStatusText(payload.speaking ? "Speaking" : "Recognizing");
                return;
            case 'asr_partial':
                {
                    const text = String(payload.text || "");
                    setPartialText(text);
                    updateTranscriptDraft(text);
                    if (text.trim()) {
                        setStatusText("Recognizing");
                    }
                }
                return;
            case 'asr_final':
                {
                    const text = String(payload.text || "");
                    setPartialText(text);
                    updateTranscriptDraft(text);
                    setStatusText(text.trim() ? "Thinking" : "Listening");
                }
                return;
            case 'user_text':
                resetAssistantDraft();
                setPartialText("");
                commitTranscriptDraft(String(payload.text || ""));
                addChatRecord({ role: CHAT_ROLE.AI, think: "", content: "..." });
                setAssistantResponding(true);
                setStatusText("Replying");
                return;
            case 'assistant_think':
                assistantThinkRef.current += String(payload.text || "");
                syncLastAiRecord();
                return;
            case 'assistant_text':
                assistantTextRef.current += String(payload.text || "");
                syncLastAiRecord();
                setAssistantResponding(true);
                return;
            case 'assistant_done':
                setAssistantResponding(false);
                setStatusText("Listening");
                return;
            case 'interrupted':
                clearTranscriptDraft();
                setAssistantResponding(false);
                setStatusText("Listening");
                return;
            case 'error':
                clearTranscriptDraft();
                setAssistantResponding(false);
                setStatusText("Voice error");
                addToast({
                    title: String(payload.message || 'Realtime voice error'),
                    variant: 'flat',
                    color: 'danger',
                });
                return;
            default:
                return;
        }
    }

    const startRecorder = async (sessionId: number) => {
        const recorder = new AudioRecoder(
            16000,
            1,
            16000 / 1000 * 20 * 2,
            (chunk: Uint8Array) => {
                if (sessionId !== activeSessionIdRef.current) {
                    return;
                }
                const currentWs = wsRef.current;
                if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
                    return;
                }
                if (ttsBlockedRef.current || isAssistantRespondingRef.current) {
                    return;
                }
                lastAudioSentAtRef.current = Date.now();
                currentWs.send(chunk);
            }
        );

        recorderRef.current = recorder;
        await recorder.start();

        if (sessionId !== activeSessionIdRef.current) {
            recorder.stop();
            return;
        }

        setRecordingState(true);
        setConnectingState(false);
        setStatusText("Listening");
    }

    const start = async () => {
        if (isRecordingRef.current || isConnectingRef.current) {
            return;
        }

        const sessionId = activeSessionIdRef.current + 1;
        activeSessionIdRef.current = sessionId;
        setConnectingState(true);
        setRecordingState(false);
        setStatusText("Connecting voice");
        resetAssistantDraft();
        setPartialText("");

        const ws = new WebSocket(getWsUrl('/adh/voice/v0/dialogue/stream'));
        ws.binaryType = 'arraybuffer';
        wsRef.current = ws;

        ws.onopen = () => {
            if (sessionId !== activeSessionIdRef.current) {
                ws.close();
                return;
            }
            ws.send(JSON.stringify({
                type: 'start',
                asr: {
                    engine: asrEngine || 'funasrStreaming',
                    config: {
                        ...asrSettings,
                        mode: '2pass',
                    },
                },
                tts: {
                    engine: ttsEngine || 'EdgeTTS',
                    config: ttsSettings,
                },
                agent: {
                    engine: agentEngine === 'OpenAI' ? 'LongCat' : (agentEngine || 'LongCat'),
                    config: {
                        base_url: "https://api.longcat.chat/openai/v1",
                        ...(agentSettings || {}),
                        model: (agentSettings?.model === "LongCat-2.0-Preview" || !agentSettings?.model)
                            ? "LongCat-Flash-Chat"
                            : agentSettings.model,
                    },
                }
            }));

            void startRecorder(sessionId).catch((error: any) => {
                if (sessionId !== activeSessionIdRef.current) {
                    return;
                }
                cleanupSession();
                addToast({
                    title: error?.message || 'Failed to open microphone',
                    variant: 'flat',
                    color: 'danger',
                });
            });
        };

        ws.onmessage = async (event) => {
            if (sessionId !== activeSessionIdRef.current) {
                return;
            }
            if (typeof event.data === 'string') {
                await handleRealtimeEvent(sessionId, JSON.parse(event.data));
                return;
            }
            if (event.data instanceof ArrayBuffer) {
                await playAudioChunk(event.data);
                return;
            }
            if (event.data instanceof Blob) {
                await playAudioChunk(await event.data.arrayBuffer());
            }
        };

        ws.onerror = () => {
            if (sessionId !== activeSessionIdRef.current) {
                return;
            }
            addToast({
                title: 'Realtime voice websocket error',
                variant: 'flat',
                color: 'danger',
            });
            setStatusText("Voice error");
            cleanupSession();
        };

        ws.onclose = () => {
            if (sessionId !== activeSessionIdRef.current) {
                return;
            }
            setStatusText("Voice disconnected");
            cleanupSession(false);
        };
    }

    useEffect(() => {
        return () => {
            activeSessionIdRef.current += 1;
            cleanupSession();
        }
    }, [])

    return {
        isRecording,
        isConnecting,
        isAssistantResponding,
        isPlaybackBlocked: ttsBlocked,
        partialText,
        statusText,
        lastAudioSentAt: lastAudioSentAtRef.current,
        start,
        stop,
        interrupt,
    };
}
