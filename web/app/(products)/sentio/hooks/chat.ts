import { useEffect, useRef, useState } from "react";
import {
    useChatRecordStore,
    useSentioAgentStore,
    useSentioTtsStore,
    useSentioBasicStore,
} from "@/lib/store/sentio";
import { useTranslations } from "next-intl";
import { CHAT_ROLE, EventResponse, STREAMING_EVENT_TYPE } from "@/lib/protocol";
import { Live2dManager } from "@/lib/live2d/live2dManager";
import { base64ToArrayBuffer, ttsTextPreprocess } from "@/lib/func";
import { convertMp3ArrayBufferToWavArrayBuffer } from "@/lib/utils/audio";
import { api_tts_infer, api_agent_stream } from "@/lib/api/server";
import { addToast } from "@heroui/react";
import {
    SENTIO_RECODER_MIN_TIME,
    SENTIO_RECODER_MAX_TIME,
} from "@/lib/constants";

const REALTIME_TTS_SEGMENT_TIMEOUT_MS = 8000;
const REALTIME_AGENT_IDLE_TIMEOUT_MS = 25000;

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(message)), timeoutMs);
            }),
        ]);
    } finally {
        if (timer) {
            clearTimeout(timer);
        }
    }
};

const dispatchAssistantSpeechText = (text: string) => {
    if (typeof document === "undefined") {
        return;
    }
    const normalizedText = text.trim();
    if (!normalizedText) {
        return;
    }
    document.dispatchEvent(new CustomEvent("sentio:assistant-speech-text", {
        detail: { text: normalizedText, at: Date.now() }
    }));
};

const normalizeAgentRequest = (engine: string, settings: { [key: string]: any }) => {
    if (!engine || engine === "OpenAI" || engine === "LongCat") {
        return {
            engine: "LongCat",
            settings: {
                base_url: "https://api.longcat.chat/openai/v1",
                ...(settings || {}),
                model: (settings?.model === "LongCat-2.0-Preview" || !settings?.model)
                    ? "LongCat-Flash-Chat"
                    : settings.model,
            }
        };
    }

    return {
        engine,
        settings: settings || {},
    };
};

export function useAudioTimer() {
    const t = useTranslations("Products.sentio");
    const startTime = useRef(new Date());

    const toast = (message: string) => {
        addToast({
            title: message,
            color: "warning",
        });
    };

    const startAudioTimer = () => {
        startTime.current = new Date();
    };

    const stopAudioTimer = (): boolean => {
        const duration = new Date().getTime() - startTime.current.getTime();
        if (duration < SENTIO_RECODER_MIN_TIME) {
            toast(`${t("recordingTime")} < ${SENTIO_RECODER_MIN_TIME}`);
        } else if (duration > SENTIO_RECODER_MAX_TIME) {
            toast(`${t("recordingTime")} > ${SENTIO_RECODER_MAX_TIME}`);
        } else {
            return true;
        }
        return false;
    };

    return { startAudioTimer, stopAudioTimer };
}

const textContainsAny = (text: string, keywords: string[]) => {
    const lowerText = text.toLowerCase();
    return keywords.some((keyword) => {
        const lowerKeyword = keyword.toLowerCase();
        return text.includes(keyword) || lowerText.includes(lowerKeyword);
    });
};

const detectAndTriggerEmotion = (text: string) => {
    if (textContainsAny(text, ["开心", "高兴", "快乐", "兴奋", "哈哈", "太好了", "真棒", "happy"])) {
        console.log("[Emotion] Detected happy emotion");
        Live2dManager.getInstance().triggerEmotionMotion("happy");
        return;
    }

    if (textContainsAny(text, ["难过", "伤心", "悲伤", "失落", "sad"])) {
        console.log("[Emotion] Detected sad emotion");
        Live2dManager.getInstance().triggerEmotionMotion("sad");
        return;
    }

    if (textContainsAny(text, ["生气", "愤怒", "火大", "angry"])) {
        console.log("[Emotion] Detected angry emotion");
        Live2dManager.getInstance().triggerEmotionMotion("angry");
        return;
    }

    if (textContainsAny(text, ["惊讶", "震惊", "意外", "surprised"])) {
        console.log("[Emotion] Detected surprised emotion");
        Live2dManager.getInstance().triggerEmotionMotion("surprised");
    }
};

export function useChatWithAgent() {
    const [chatting, setChatting] = useState(false);
    const { engine: agentEngine, settings: agentSettings } = useSentioAgentStore();
    const { engine: ttsEngine, settings: ttsSettings } = useSentioTtsStore();
    const { sound } = useSentioBasicStore();

    const { addChatRecord, updateLastRecord } = useChatRecordStore();
    const controller = useRef<AbortController | null>(null);
    const conversationId = useRef<string>("");
    const messageId = useRef<string>("");
    const activeSessionIdRef = useRef(0);
    const pendingTtsRequestsRef = useRef(0);
    const streamCompletedRef = useRef(true);

    const isActiveSession = (sessionId: number) => activeSessionIdRef.current === sessionId;

    const finishChatIfIdle = (sessionId: number) => {
        if (!isActiveSession(sessionId)) return;
        if (!streamCompletedRef.current) return;
        if (pendingTtsRequestsRef.current > 0) return;
        if (Live2dManager.getInstance().hasPendingAudio()) return;
        controller.current = null;
        setChatting(false);
    };

    const abort = () => {
        activeSessionIdRef.current += 1;
        pendingTtsRequestsRef.current = 0;
        streamCompletedRef.current = true;
        setChatting(false);
        Live2dManager.getInstance().stopAudio();
        if (controller.current) {
            controller.current.abort("abort");
            controller.current = null;
        }
    };

    const chatWithAgent = (
        message: string,
        postProcess?: (conversation_id: string, message_id: string, think: string, content: string) => void,
        appendHumanMessage: boolean = true
    ) => {
        const sessionId = activeSessionIdRef.current + 1;
        activeSessionIdRef.current = sessionId;

        if (appendHumanMessage) {
            addChatRecord({ role: CHAT_ROLE.HUMAN, think: "", content: message });
        }
        addChatRecord({ role: CHAT_ROLE.AI, think: "", content: "..." });

        const agentController = new AbortController();
        controller.current = agentController;
        pendingTtsRequestsRef.current = 0;
        streamCompletedRef.current = false;
        setChatting(true);

        let agentResponse = "";
        let agentThink = "";
        let agentIdleTimer: ReturnType<typeof setTimeout> | null = null;
        let postProcessed = false;

        const clearAgentIdleTimer = () => {
            if (agentIdleTimer) {
                clearTimeout(agentIdleTimer);
                agentIdleTimer = null;
            }
        };

        const resetAgentIdleTimer = () => {
            clearAgentIdleTimer();
            agentIdleTimer = setTimeout(() => {
                if (!isActiveSession(sessionId) || streamCompletedRef.current) {
                    return;
                }
                console.warn('[Chat] Agent stream idle timeout, releasing current chat session.');
                markStreamCompleted();
            }, REALTIME_AGENT_IDLE_TIMEOUT_MS);
        };

        const runPostProcess = () => {
            if (postProcessed || !postProcess) {
                return;
            }
            postProcessed = true;
            postProcess(conversationId.current, messageId.current, agentThink, agentResponse);
        };

        const playFullResponseTts = () => {
            if (!isActiveSession(sessionId)) {
                return;
            }
            if (!sound) {
                finishChatIfIdle(sessionId);
                return;
            }
            const processText = ttsTextPreprocess(agentResponse);
            if (!processText) {
                finishChatIfIdle(sessionId);
                return;
            }

            pendingTtsRequestsRef.current += 1;
            dispatchAssistantSpeechText(processText);

            withTimeout(
                api_tts_infer(ttsEngine, ttsSettings, processText, agentController.signal),
                REALTIME_TTS_SEGMENT_TIMEOUT_MS,
                "tts segment timeout"
            )
                .then(async (ttsResult) => {
                    if (!ttsResult || !isActiveSession(sessionId)) {
                        return;
                    }
                    const audioData = base64ToArrayBuffer(ttsResult);
                    const buffer = await withTimeout(
                        convertMp3ArrayBufferToWavArrayBuffer(audioData),
                        REALTIME_TTS_SEGMENT_TIMEOUT_MS,
                        "tts audio convert timeout"
                    );
                    if (!isActiveSession(sessionId)) {
                        return;
                    }
                    const manager = Live2dManager.getInstance();
                    manager.pushAudioQueue(buffer);
                    manager.playAudio();
                })
                .catch((error) => {
                    console.warn('[Chat] Skipping full response TTS:', error);
                })
                .finally(() => {
                    if (!isActiveSession(sessionId)) {
                        return;
                    }
                    pendingTtsRequestsRef.current = Math.max(0, pendingTtsRequestsRef.current - 1);
                    finishChatIfIdle(sessionId);
                });
        };

        const markStreamCompleted = () => {
            if (!isActiveSession(sessionId)) {
                return;
            }
            clearAgentIdleTimer();
            streamCompletedRef.current = true;
            runPostProcess();
            if (sound && agentResponse.trim()) {
                playFullResponseTts();
            } else {
                finishChatIfIdle(sessionId);
            }
        };

        const agentCallback = (response: EventResponse) => {
            if (!isActiveSession(sessionId)) {
                return;
            }
            resetAgentIdleTimer();

            const event = response.event;
            const data = response.data;

            switch (event) {
                case STREAMING_EVENT_TYPE.CONVERSATION_ID:
                    conversationId.current = data;
                    break;
                case STREAMING_EVENT_TYPE.MESSAGE_ID:
                    messageId.current = data;
                    break;
                case STREAMING_EVENT_TYPE.THINK:
                    agentThink += data;
                    updateLastRecord({ role: CHAT_ROLE.AI, think: agentThink, content: agentResponse });
                    break;
                case STREAMING_EVENT_TYPE.TEXT:
                    agentResponse += data;
                    updateLastRecord({ role: CHAT_ROLE.AI, think: agentThink, content: agentResponse });
                    if (agentResponse.length === data.length) {
                        detectAndTriggerEmotion(agentResponse);
                    }
                    break;
                case STREAMING_EVENT_TYPE.ERROR:
                    addToast({
                        title: data,
                        color: "danger",
                    });
                    markStreamCompleted();
                    break;
                case STREAMING_EVENT_TYPE.DONE:
                    markStreamCompleted();
                    break;
                default:
                    break;
            }
        };

        const agentErrorCallback = () => {
            markStreamCompleted();
        };

        resetAgentIdleTimer();
        const agentRequest = normalizeAgentRequest(agentEngine, agentSettings);
        api_agent_stream(
            agentRequest.engine,
            agentRequest.settings,
            message,
            conversationId.current,
            agentController.signal,
            agentCallback,
            agentErrorCallback
        );
    };

    const chat = (
        message: string,
        postProcess?: (conversation_id: string, message_id: string, think: string, content: string) => void,
        appendHumanMessage: boolean = true
    ) => {
        abort();
        chatWithAgent(message, postProcess, appendHumanMessage);
    };

    useEffect(() => {
        conversationId.current = "";
        return () => {
            abort();
        };
    }, [agentEngine, agentSettings]);

    useEffect(() => {
        if (!chatting) {
            return;
        }
        const sessionId = activeSessionIdRef.current;
        const timer = window.setInterval(() => {
            finishChatIfIdle(sessionId);
        }, 120);
        return () => {
            window.clearInterval(timer);
        };
    }, [chatting]);

    return { chat, abort, chatting, conversationId };
}
