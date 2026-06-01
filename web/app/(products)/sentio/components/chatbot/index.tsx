'use client'

import { useEffect, memo, useRef, useState } from "react";
import { APP_TYPE } from "@/lib/protocol";
import { ChatRecord } from "./record";
import { ChatInput } from "./input";
import { api_tts_infer } from "@/lib/api/server";
import { base64ToArrayBuffer } from "@/lib/func";
import { convertMp3ArrayBufferToWavArrayBuffer } from "@/lib/utils/audio";
import { Live2dManager } from "@/lib/live2d/live2dManager";
import { Tooltip } from "@heroui/react";
import { ChatBubbleLeftRightIcon, ArrowPathIcon, StopIcon } from "@heroicons/react/24/solid";
import {
    useSentioThemeStore,
    useSentioTtsStore,
    useChatRecordStore,
} from "@/lib/store/sentio";
import clsx from "clsx";

const OPENING_GREETING = "\u4f60\u597d\uff0c\u8bf7\u95ee\u6709\u4ec0\u4e48\u53ef\u4ee5\u5e2e\u52a9\u4f60\u7684\u5462\uff1f";
const OPENING_GREETING_START_DELAY_MS = 1200;
const OPENING_GREETING_RETRY_MS = 700;
const OPENING_GREETING_MAX_ATTEMPTS = 8;

const dispatchAssistantSpeechText = (text: string) => {
    document.dispatchEvent(new CustomEvent("sentio:assistant-speech-text", {
        detail: { text, at: Date.now() }
    }));
};

const dispatchOpeningGreetingState = (state: "starting" | "playing" | "done") => {
    document.dispatchEvent(new CustomEvent('sentio:opening-greeting', {
        detail: { state, at: Date.now() }
    }));
};

function FreedomChatBot() {
    const { clearChatRecord } = useChatRecordStore();
    const [showChatRecord, setShowChatRecord] = useState(true);
    const lastVoiceButtonInteractionAtRef = useRef(0);
    const greetedRef = useRef(false);
    const greetingAudioRef = useRef<ArrayBuffer | null>(null);
    const touchVoiceControllerRef = useRef<AbortController | null>(null);
    const touchVoiceRequestIdRef = useRef(0);

    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const searchParams = new URLSearchParams(window.location.search);
        if (searchParams.get("app") === "android") {
            clearChatRecord();
        }
    }, [clearChatRecord]);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: number | null = null;
        let attemptCount = 0;
        const controller = new AbortController();

        const playGreeting = async (force = false) => {
            if (cancelled || (!force && greetedRef.current)) {
                return;
            }
            attemptCount += 1;

            try {
                dispatchOpeningGreetingState("starting");
                if (!greetingAudioRef.current) {
                    const store = useSentioTtsStore.getState();
                    const audioBase64 = await api_tts_infer(store.engine, store.settings, OPENING_GREETING, controller.signal);
                    if (!audioBase64 || cancelled || controller.signal.aborted) {
                        return;
                    }

                    const audioData = base64ToArrayBuffer(audioBase64);
                    greetingAudioRef.current = await convertMp3ArrayBufferToWavArrayBuffer(audioData);
                }

                if (!greetingAudioRef.current || cancelled || controller.signal.aborted) {
                    return;
                }

                const manager = Live2dManager.getInstance();
                if (!manager.isReady() || manager.isPlaybackBlocked()) {
                    if (attemptCount < OPENING_GREETING_MAX_ATTEMPTS) {
                        retryTimer = window.setTimeout(() => playGreeting(force), OPENING_GREETING_RETRY_MS);
                    } else {
                        dispatchOpeningGreetingState("done");
                    }
                    return;
                }
                void manager.resumeAudioContext();

                dispatchAssistantSpeechText(OPENING_GREETING);
                if (manager.playAudioNow(greetingAudioRef.current.slice(0))) {
                    greetedRef.current = true;
                    dispatchOpeningGreetingState("playing");
                    const handleTtsState = (event: Event) => {
                        const detail = (event as CustomEvent<{ blocked?: boolean }>).detail;
                        if (!detail?.blocked) {
                            document.removeEventListener('sentio:tts-state', handleTtsState as EventListener);
                            dispatchOpeningGreetingState("done");
                        }
                    };
                    document.addEventListener('sentio:tts-state', handleTtsState as EventListener);
                    window.setTimeout(() => {
                        document.removeEventListener('sentio:tts-state', handleTtsState as EventListener);
                        dispatchOpeningGreetingState("done");
                    }, 6000);
                    return;
                }

                if (attemptCount < OPENING_GREETING_MAX_ATTEMPTS) {
                    retryTimer = window.setTimeout(() => playGreeting(force), OPENING_GREETING_RETRY_MS);
                } else {
                    dispatchOpeningGreetingState("done");
                }
            } catch (error) {
                if (!cancelled) {
                    console.error('[ChatBot] Failed to play opening greeting:', error);
                }
                dispatchOpeningGreetingState("done");
            }
        };

        const handleReplayOpeningGreeting = () => {
            attemptCount = 0;
            greetedRef.current = false;
            if (retryTimer) {
                window.clearTimeout(retryTimer);
                retryTimer = null;
            }
            void playGreeting(true);
        };

        const startTimer = window.setTimeout(() => playGreeting(), OPENING_GREETING_START_DELAY_MS);
        document.addEventListener('sentio:replay-opening-greeting', handleReplayOpeningGreeting);

        return () => {
            cancelled = true;
            controller.abort();
            document.removeEventListener('sentio:replay-opening-greeting', handleReplayOpeningGreeting);
            window.clearTimeout(startTimer);
            if (retryTimer) {
                window.clearTimeout(retryTimer);
            }
        };
    }, []);

    useEffect(() => {
        const handleVoiceButtonInteraction = (event: Event) => {
            const customEvent = event as CustomEvent<{ at?: number }>;
            lastVoiceButtonInteractionAtRef.current = customEvent.detail?.at ?? Date.now();
        };

        const handleLive2dTouch = async (event: Event) => {
            if (Date.now() - lastVoiceButtonInteractionAtRef.current < 800) {
                return;
            }

            const customEvent = event as CustomEvent<{ text?: string }>;
            const text = customEvent.detail?.text?.trim();
            if (!text) {
                return;
            }

            const requestId = touchVoiceRequestIdRef.current + 1;
            touchVoiceRequestIdRef.current = requestId;
            touchVoiceControllerRef.current?.abort("new-touch-voice");
            const controller = new AbortController();
            touchVoiceControllerRef.current = controller;
            Live2dManager.getInstance().stopAudio();

            try {
                const store = useSentioTtsStore.getState();
                const audioBase64 = await api_tts_infer(store.engine, store.settings, text, controller.signal);
                if (!audioBase64 || controller.signal.aborted || requestId !== touchVoiceRequestIdRef.current) {
                    return;
                }

                const audioData = base64ToArrayBuffer(audioBase64);
                const wavBuffer = await convertMp3ArrayBufferToWavArrayBuffer(audioData);
                if (controller.signal.aborted || requestId !== touchVoiceRequestIdRef.current) {
                    return;
                }
                const manager = Live2dManager.getInstance();
                dispatchAssistantSpeechText(text);
                manager.playAudioNow(wavBuffer);
            } catch (error) {
                if (!controller.signal.aborted) {
                    console.error('[ChatBot] Failed to synthesize touch voice:', error);
                }
            }
        };

        document.addEventListener('sentio:voice-button-interaction', handleVoiceButtonInteraction);
        document.addEventListener('live2d:touch', handleLive2dTouch);

        return () => {
            touchVoiceControllerRef.current?.abort("unmount");
            document.removeEventListener('sentio:voice-button-interaction', handleVoiceButtonInteraction);
            document.removeEventListener('live2d:touch', handleLive2dTouch);
        };
    }, []);

    const handleRestartConversation = () => {
        touchVoiceControllerRef.current?.abort("restart-conversation");
        touchVoiceRequestIdRef.current += 1;
        Live2dManager.getInstance().stopAudio();
        clearChatRecord();
        document.dispatchEvent(new CustomEvent('sentio:replay-opening-greeting'));
    };

    const handleStopAssistantSpeech = () => {
        touchVoiceControllerRef.current?.abort("stop-assistant-speech");
        touchVoiceRequestIdRef.current += 1;
        Live2dManager.getInstance().stopAudio();
    };

    const toolButtonClass = (active: boolean) => clsx(
        "h-12 w-12 rounded-full flex items-center justify-center border",
        "backdrop-blur-md shadow-lg transition-all duration-200 focus:outline-none",
        active
            ? "bg-white/25 border-white/55 text-white hover:bg-white/35"
            : "bg-slate-900/65 border-white/45 text-white hover:bg-slate-900/75"
    );

    return (
        <div className="relative flex flex-col full-height-minus-64px pb-6 md:px-6 gap-6 justify-between items-center z-10">
            <div className="absolute left-3 bottom-24 z-20 flex flex-row gap-2 md:left-6 md:bottom-1/2 md:translate-y-1/2 md:flex-col md:gap-3">
                <Tooltip className='opacity-90' placement="right" content={showChatRecord ? "隐藏聊天记录" : "显示聊天记录"}>
                    <button
                        type="button"
                        className={toolButtonClass(showChatRecord)}
                        onClick={() => setShowChatRecord((value) => !value)}
                        aria-pressed={showChatRecord}
                        aria-label="聊天记录"
                    >
                        <ChatBubbleLeftRightIcon className="size-5 shrink-0" />
                    </button>
                </Tooltip>
                <Tooltip className='opacity-90' placement="right" content="重新对话">
                    <button
                        type="button"
                        className={toolButtonClass(false)}
                        onClick={handleRestartConversation}
                        aria-label="重新对话"
                    >
                        <ArrowPathIcon className="size-5 shrink-0" />
                    </button>
                </Tooltip>
                <Tooltip className='opacity-90' placement="right" content="打断数字人说话">
                    <button
                        type="button"
                        className={toolButtonClass(false)}
                        onClick={handleStopAssistantSpeech}
                        aria-label="打断数字人说话"
                    >
                        <StopIcon className="size-5 shrink-0" />
                    </button>
                </Tooltip>
            </div>
            <ChatRecord className={clsx("md:pl-16", !showChatRecord && "opacity-0 pointer-events-none")} />
            <ChatInput />
        </div>
    );
}

function ChatBot() {
    const { theme } = useSentioThemeStore();
    switch (theme) {
        case APP_TYPE.FREEDOM:
            return <FreedomChatBot />;
        default:
            return <FreedomChatBot />;
    }
}

export default memo(ChatBot);
