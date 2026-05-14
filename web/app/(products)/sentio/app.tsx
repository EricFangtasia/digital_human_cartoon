'use client'

import { useEffect, useMemo, useState } from "react";
import { Live2d } from './components/live2d';
import ChatBot from './components/chatbot';
import { Header } from './components/header';
import { LoginForm } from './components/LoginForm';
import { GreetingBanner } from './components/GreetingBanner';
import { useAppConfig } from "./hooks/appConfig";
import { Spinner } from "@heroui/react";
import { useAuthStore } from "@/lib/store/auth";
import { useChatRecordStore, useSentioCharacterStore, useSentioTtsStore } from "@/lib/store/sentio";
import { getUserProfile } from "@/lib/api/adh";
import { ArrowLeftIcon, ArrowRightOnRectangleIcon } from "@heroicons/react/24/solid";
import { ResourceModel, RESOURCE_TYPE } from "@/lib/protocol";
import { getSrcPath } from "@/lib/path";
import * as CONSTANTS from "@/lib/constants";

const CHARACTER_TTS_VOICE_MAP: Record<string, string> = {
    Chitose: "zh-CN-YunxiNeural",
    HaruGreeter: "zh-CN-XiaoxiaoNeural",
    Haru: "zh-CN-XiaoyiNeural",
    Kei: "zh-CN-XiaoxiaoNeural",
    Epsilon: "zh-CN-XiaoyiNeural",
    Hibiki: "zh-CN-XiaoxiaoNeural",
    Hiyori: "zh-CN-XiaoyiNeural",
    Izumi: "zh-CN-XiaoxiaoNeural",
    Mao: "zh-CN-XiaoyiNeural",
    Rice: "zh-CN-XiaoxiaoNeural",
    Shizuku: "zh-CN-XiaoyiNeural",
    Tsumiki: "zh-CN-XiaoxiaoNeural",
};

const MALE_TTS_VOICES = new Set([
    "zh-CN-YunjianNeural",
    "zh-CN-YunxiNeural",
    "zh-CN-YunxiaNeural",
    "zh-CN-YunyangNeural",
    "zh-HK-WanLungNeural",
    "zh-TW-YunJheNeural",
]);

const getCharacterTtsVoice = (characterName: string) => {
    return CHARACTER_TTS_VOICE_MAP[characterName] ?? "zh-CN-XiaoxiaoNeural";
};

const getCharacterVoiceLabel = (characterName: string) => {
    return MALE_TTS_VOICES.has(getCharacterTtsVoice(characterName)) ? "男声音色" : "女声音色";
};

const getDigitalHumanEntries = (): ResourceModel[] => [
    ...CONSTANTS.SENTIO_CHARACTER_FREE_MODELS.map((model) => ({
        resource_id: `FREE_${model}`,
        name: model,
        link: getSrcPath(`${CONSTANTS.SENTIO_CHARACTER_FREE_PATH}/${model}/${model}.png`),
        type: RESOURCE_TYPE.CHARACTER,
    })),
    ...CONSTANTS.SENTIO_CHARACTER_IP_MODELS.map((model) => ({
        resource_id: `IP_${model}`,
        name: model,
        link: getSrcPath(`${CONSTANTS.SENTIO_CHARACTER_IP_PATH}/${model}/${model}.png`),
        type: RESOURCE_TYPE.CHARACTER,
    })),
];

function DigitalHumanEntryPage({ onSelect }: { onSelect: (character: ResourceModel) => void }) {
    const characters = useMemo(() => getDigitalHumanEntries(), []);

    return (
        <main className="h-[calc(100vh-64px)] overflow-y-auto px-5 pb-10 pt-5 md:px-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-7">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div className="max-w-2xl text-white drop-shadow">
                        <div className="mb-3 inline-flex items-center rounded-full border border-white/35 bg-white/18 px-4 py-1.5 text-xs font-semibold tracking-wide text-white/85 backdrop-blur-md">
                            DIGITAL HUMAN LOBBY
                        </div>
                        <h1 className="text-3xl font-bold leading-tight md:text-5xl">选择你的数字人</h1>
                        <p className="mt-3 text-sm leading-6 text-white/82 md:text-base">每个角色都是一个独立入口，点击形象卡片后进入专属语音对话。</p>
                    </div>
                    <div className="grid w-full max-w-xs grid-cols-2 gap-3 text-white md:max-w-sm">
                        <div className="rounded-2xl border border-white/30 bg-slate-950/22 px-4 py-3 backdrop-blur-md">
                            <div className="text-2xl font-bold">{characters.length}</div>
                            <div className="text-xs text-white/70">可选数字人</div>
                        </div>
                        <div className="rounded-2xl border border-white/30 bg-slate-950/22 px-4 py-3 backdrop-blur-md">
                            <div className="text-2xl font-bold">8</div>
                            <div className="text-xs text-white/70">首屏展示</div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4">
                    {characters.map((character, index) => (
                        <button
                            key={character.resource_id}
                            type="button"
                            onClick={() => onSelect(character)}
                            className="group relative flex min-h-[278px] flex-col overflow-hidden rounded-[28px] border border-white/45 bg-white/22 text-left shadow-2xl shadow-slate-900/18 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/70 hover:bg-white/30 hover:shadow-slate-900/28 focus:outline-none focus:ring-2 focus:ring-white/85 md:min-h-[322px]"
                            aria-label={`进入 ${character.name}`}
                        >
                            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-cyan-300/25 via-white/14 to-rose-300/18" />
                            <div className="absolute right-4 top-4 rounded-full border border-white/35 bg-slate-950/25 px-3 py-1 text-xs font-semibold text-white/78 backdrop-blur-md">
                                No. {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="relative flex min-h-0 flex-1 items-end justify-center px-5 pt-8">
                                <img
                                    src={character.link}
                                    alt={character.name}
                                    className="h-[218px] max-w-full object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-108 md:h-[255px]"
                                />
                            </div>
                            <div className="relative w-full border-t border-white/25 bg-slate-950/38 px-4 py-4 text-white backdrop-blur-md">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-lg font-semibold leading-6">{character.name}</div>
                                        <div className="mt-1 text-xs text-white/68">{getCharacterVoiceLabel(character.name)} · 语音对话入口</div>
                                    </div>
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition-transform duration-300 group-hover:translate-x-0.5">
                                        <ArrowRightOnRectangleIcon className="h-5 w-5" />
                                    </div>
                                </div>
                            </div>
                        </button>
                    ))}
                </div>
            </div>
        </main>
    );
}


export default function App() {
    const { setAppConfig } = useAppConfig();
    const [isLoading, setIsLoading] = useState(true);
    const [greeting, setGreeting] = useState<string>("");
    const [selectedDigitalHuman, setSelectedDigitalHuman] = useState<ResourceModel | null>(null);
    const { isLoggedIn, user, setAuth, initFromStorage, clearAuth } = useAuthStore();
    const { setCharacter } = useSentioCharacterStore();
    const { setEngine: setTtsEngine, settings: ttsSettings, setSettings: setTtsSettings } = useSentioTtsStore();
    const { clearChatRecord } = useChatRecordStore();

    // 初始化：从 localStorage 恢复登录状态，并向服务器验证 token 有效性
    useEffect(() => {
        // 先从 localStorage 读取
        initFromStorage();
        const afterInit = useAuthStore.getState();
        if (afterInit.isLoggedIn && afterInit.token) {
            // 有 token，向服务器验证是否有效
            getUserProfile()
                .then((profile) => {
                    const name = profile.name || profile.username || "朋友";
                    setGreeting(`${name}，好久不见，最近怎么样？`);
                    setAppConfig(null);
                    setIsLoading(false);
                })
                .catch(() => {
                    // token 无效或过期，强制清除登录状态
                    useAuthStore.getState().clearAuth();
                    setIsLoading(false);
                });
        } else {
            // 无 token，直接显示登录页
            setIsLoading(false);
        }
    }, []);

    // 登录成功后获取用户 profile 并设置问候语（登录动作触发，非初始化）
    useEffect(() => {
        if (!isLoggedIn || isLoading) return;
        // 初始化已处理过 profile，此处仅在登录状态变为 true 时（手动登录）重新拉取
        setAppConfig(null);
        getUserProfile().then((profile) => {
            const name = profile.name || profile.username || "朋友";
            setGreeting(`${name}，好久不见，最近怎么样？`);
        }).catch(() => {
            if (user) {
                setGreeting(`${user.name || user.username || "朋友"}，好久不见，最近怎么样？`);
            }
        });
    }, [isLoggedIn]);

    // 等待初始化
    if (isLoading) {
        return (
            <div className="w-full h-full animated-gradient flex items-center justify-center">
                <Spinner color="secondary" size="lg" variant="wave" />
            </div>
        );
    }

    // 未登录：仅显示登录页，不渲染任何数字人组件
    if (!isLoggedIn) {
        return (
            <>
                <GlobalStyle />
                <div className='w-full min-h-screen animated-gradient flex items-center justify-center' style={{ position: 'relative' }}>
                    <LoginForm onSuccess={() => {}} />
                </div>
            </>
        );
    }

    // 已登录：正常对话页
    const enterDigitalHuman = (character: ResourceModel) => {
        clearChatRecord();
        setCharacter(character);
        setTtsEngine("EdgeTTS");
        setTtsSettings({
            ...ttsSettings,
            voice: getCharacterTtsVoice(character.name),
        });
        setSelectedDigitalHuman(character);
    };

    const returnToDigitalHumanEntries = () => {
        clearChatRecord();
        setSelectedDigitalHuman(null);
    };

    return (
        <>
            <GlobalStyle />
            <div className='w-full min-h-screen animated-gradient' style={{ position: 'relative' }}>
                <div className='flex flex-col w-full h-full'>
                    <div style={{ position: 'relative' }}>
                        <Header />
                        {selectedDigitalHuman && (
                            <button
                                onClick={returnToDigitalHumanEntries}
                                title="返回数字人入口"
                                style={{
                                    position: 'absolute',
                                    left: '16px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    zIndex: 20,
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    background: 'rgba(255,255,255,0.15)',
                                    backdropFilter: 'blur(8px)',
                                    border: '1px solid rgba(255,255,255,0.4)',
                                    cursor: 'pointer',
                                    transition: 'background 0.2s',
                                }}
                                onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.35)')}
                                onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                            >
                                <ArrowLeftIcon style={{ width: '18px', height: '18px', color: 'rgba(255,255,255,0.85)' }} />
                            </button>
                        )}
                        <button
                            onClick={() => clearAuth()}
                            title="退出登录"
                            style={{
                                position: 'absolute',
                                right: '16px',
                                top: '50%',
                                transform: 'translateY(-50%)',
                                zIndex: 20,
                                width: '36px',
                                height: '36px',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: 'rgba(255,255,255,0.15)',
                                backdropFilter: 'blur(8px)',
                                border: '1px solid rgba(255,255,255,0.4)',
                                cursor: 'pointer',
                                transition: 'background 0.2s',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.35)')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')}
                        >
                            <ArrowRightOnRectangleIcon style={{ width: '18px', height: '18px', color: 'rgba(255,255,255,0.85)' }} />
                        </button>
                    </div>
                    {selectedDigitalHuman ? (
                        <>
                            {greeting && <GreetingBanner message={greeting} />}
                            <ChatBot />
                        </>
                    ) : (
                        <DigitalHumanEntryPage onSelect={enterDigitalHuman} />
                    )}
                </div>
                {selectedDigitalHuman && <Live2d />}
            </div>
        </>
    );
}

function GlobalStyle() {
    return (
        <style jsx global>{`
            @keyframes radial-chaos {
                0% {
                    background-position: 20% 30%, 75% 60%, 50% 15%, 10% 80%, 85% 25%;
                }
                16% {
                    background-position: 40% 70%, 15% 40%, 80% 85%, 60% 20%, 25% 50%;
                }
                32% {
                    background-position: 70% 50%, 30% 15%, 50% 75%, 90% 60%, 10% 35%;
                }
                48% {
                    background-position: 15% 65%, 85% 80%, 40% 25%, 70% 90%, 50% 10%;
                }
                64% {
                    background-position: 55% 40%, 20% 85%, 90% 30%, 35% 55%, 75% 70%;
                }
                80% {
                    background-position: 80% 20%, 45% 75%, 10% 45%, 65% 10%, 30% 90%;
                }
                100% {
                    background-position: 20% 30%, 75% 60%, 50% 15%, 10% 80%, 85% 25%;
                }
            }

            .animated-gradient {
                background:
                    radial-gradient(circle at 20% 30%, rgba(120, 150, 255, 0.35) 0%, transparent 40%),
                    radial-gradient(circle at 75% 60%, rgba(100, 255, 200, 0.35) 0%, transparent 40%),
                    radial-gradient(circle at 50% 15%, rgba(255, 150, 255, 0.35) 0%, transparent 40%),
                    radial-gradient(circle at 10% 80%, rgba(100, 200, 255, 0.35) 0%, transparent 40%),
                    radial-gradient(circle at 85% 25%, rgba(150, 220, 255, 0.35) 0%, transparent 40%),
                    linear-gradient(135deg, #e8ecf4 0%, #d5dce8 100%);
                background-size: 200% 200%, 200% 200%, 200% 200%, 200% 200%, 200% 200%, 100% 100%;
                animation: radial-chaos 30s ease-in-out infinite;
            }
        `}</style>
    );
}
