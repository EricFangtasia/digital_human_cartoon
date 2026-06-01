'use client'

import { useEffect, useMemo, useRef, useState } from "react";
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
import {
    ArrowLeftIcon,
    ArrowPathIcon,
    ArrowRightOnRectangleIcon,
    CheckCircleIcon,
    ClipboardDocumentCheckIcon,
    ArrowsPointingOutIcon,
    XMarkIcon,
    MusicalNoteIcon,
    PauseIcon,
    PlayIcon,
    PuzzlePieceIcon,
    FlagIcon,
    UserGroupIcon,
} from "@heroicons/react/24/solid";
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

const getCharacterPreviewLink = (character: ResourceModel) => {
    return `${getSrcPath(`sentio/character-previews/${character.name}.png`)}?v=20260526-preview2`;
};

type LobbyModule = "digital-human" | "audio" | "assessment" | "games";

type HealingAudioEntry = {
    id: string;
    title: string;
    subtitle: string;
    duration: string;
    image: string;
    audioSrc?: string;
    category: "pop" | "white-noise" | "instrumental";
    tone: "breath" | "sleep" | "focus" | "nature" | "pop-bright" | "pop-soft" | "piano" | "guitar";
    style: "anthem" | "nostalgia" | "lofi" | "cinematic" | "rain" | "wind" | "ocean" | "forest" | "minimal";
};

type GameEntry = {
    id: string;
    title: string;
    subtitle: string;
    tag: string;
    image: string;
};

type MineCell = {
    mine: boolean;
    open: boolean;
    flagged: boolean;
    adjacent: number;
};

type MineBoardState = {
    cells: MineCell[][];
    opened: number;
    flagged: number;
};

type TetrisPiece = {
    shape: number[][];
    row: number;
    col: number;
    color: string;
};

type AssessmentAnswer = {
    label: string;
    text: string;
    scores: Record<string, number>;
    nextHint: string;
};

type AssessmentQuestion = {
    id: string;
    title: string;
    getPrompt: (answers: AssessmentAnswer[]) => string;
    getAnswers: (answers: AssessmentAnswer[]) => [AssessmentAnswer, AssessmentAnswer];
    image: string;
};

const ASSESSMENT_DEPTH = 10;

const assessmentLeafBuckets = {
    focus: ["关系", "行动", "秩序", "探索", "边界", "共情", "现实", "洞察"],
    depth: ["外放", "内收", "快速", "耐心", "清晰", "柔软", "稳定", "变化"],
    frame: ["具体", "抽象", "收束", "展开", "推进", "修复", "边界", "连接"],
} as const;

const getAssessmentPathCode = (answers: AssessmentAnswer[]) => answers.map((answer) => answer.label).join("");

const getAssessmentPathIndex = (answers: AssessmentAnswer[]) => {
    return answers.slice(0, ASSESSMENT_DEPTH - 1).reduce((acc, answer) => {
        const bit = answer.label === "B" ? 1 : 0;
        return (acc << 1) | bit;
    }, 0);
};

const getAssessmentLeafPrompt = (answers: AssessmentAnswer[]) => {
    const index = getAssessmentPathIndex(answers);
    const focus = assessmentLeafBuckets.focus[(index >> 6) & 7];
    const depth = assessmentLeafBuckets.depth[(index >> 3) & 7];
    const frame = assessmentLeafBuckets.frame[index & 7];

    return `最后收束：你前面的选择更像「${focus} / ${depth} / ${frame}」的组合。当你需要被支持时，哪一种更贴近你？`;
};

const createAssessmentAnswer = (
    label: "A" | "B",
    text: string,
    scores: Record<string, number>,
    nextHint: string,
): AssessmentAnswer => ({ label, text, scores, nextHint });

const pickAssessmentVariant = <T,>(answers: AssessmentAnswer[], variants: T[]) => {
    const index = answers.reduce((acc, answer, answerIndex) => {
        const bitWeight = answer.label === "B" ? 2 : 1;
        return acc + bitWeight * (answerIndex + 3) * 7;
    }, answers.length * 5);
    return variants[index % variants.length];
};

const assessmentImages: Record<string, string> = {
    entry: "https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=1200&q=80",
    "first-pressure": "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    attention: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80",
    decision: "https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?auto=format&fit=crop&w=1200&q=80",
    rhythm: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80",
    recovery: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=1200&q=80",
    conflict: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1200&q=80",
    change: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=1200&q=80",
    expression: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=1200&q=80",
    support: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=1200&q=80",
};

const assessmentBranchThemes = [
    { title: "关系雷达", prompt: "前面的选择显示你会先感知关系温度。现在如果对方态度忽冷忽热，你更会怎么判断？", a: "先观察对方行为是否稳定，再决定靠近多少", b: "直接轻轻确认对方感受，减少互相猜测", scoresA: { stable: 2, boundary: 1 }, scoresB: { empathy: 2, repair: 1 } },
    { title: "行动入口", prompt: "前面的选择显示你需要一个可执行入口。现在如果目标很大又很模糊，你会先做哪一步？", a: "切出一个最小任务，先完成一小块建立手感", b: "先问清楚真正目标，避免一开始就跑偏", scoresA: { action: 2, practical: 1 }, scoresB: { rational: 2, insight: 1 } },
    { title: "边界温度", prompt: "前面的选择显示你会在靠近之前确认边界。现在如果别人不断把事情推给你，你会怎么做？", a: "明确说出我能做和不能做的范围", b: "先理解对方为什么需要我，再决定接多少", scoresA: { boundary: 2, rational: 1 }, scoresB: { empathy: 2, stable: 1 } },
    { title: "变化试探", prompt: "前面的选择显示你对变化有自己的节奏。现在如果一个机会突然出现，你更像哪种反应？", a: "先做风险清单，确认有退路再试", b: "先体验一小段，用真实反馈判断方向", scoresA: { practical: 2, stable: 1 }, scoresB: { explore: 2, action: 1 } },
    { title: "内在恢复", prompt: "前面的选择显示你的能量需要被认真照顾。现在如果你已经有点透支，你最想先拿回什么？", a: "安静空间和不被打扰的时间", b: "有人懂我为什么累，并愿意陪我缓下来", scoresA: { inward: 2, repair: 1 }, scoresB: { empathy: 2, outward: 1 } },
    { title: "表达分岔", prompt: "前面的选择显示你很在意表达是否被准确接住。现在如果必须说一件难说的事，你会先怎么开口？", a: "先讲事实和边界，让对话有清楚框架", b: "先讲这件事对我的影响，让对方听见真实感受", scoresA: { order: 2, boundary: 1 }, scoresB: { empathy: 2, insight: 1 } },
    { title: "秩序拼图", prompt: "前面的选择显示你会从混乱里找结构。现在如果信息互相矛盾，你会先抓哪块？", a: "按时间线还原发生顺序，先找到确定事实", b: "找出矛盾背后的模式，看是不是目标本身变了", scoresA: { order: 2, practical: 1 }, scoresB: { insight: 2, explore: 1 } },
    { title: "意义探索", prompt: "前面的选择显示你不只想解决问题，也想理解它的意义。现在如果一件事反复发生，你会怎么看？", a: "把它当成需要修正的系统问题", b: "把它当成提醒我改变关系或生活方式的信号", scoresA: { rational: 2, order: 1 }, scoresB: { insight: 2, explore: 1 } },
] as const;

const getDynamicAssessmentTheme = (answers: AssessmentAnswer[], offset = 0) => {
    const index = getAssessmentPathIndex(answers) + answers.length * 3 + offset;
    return assessmentBranchThemes[index % assessmentBranchThemes.length];
};

const getDynamicAssessmentTitle = (answers: AssessmentAnswer[]) => {
    if (answers.length === 0) return "进入方式";
    if (answers.length >= ASSESSMENT_DEPTH - 1) return "支持收束";
    return getDynamicAssessmentTheme(answers).title;
};

const getDynamicAssessmentPrompt = (answers: AssessmentAnswer[]) => {
    if (answers.length === 0) return "来到一个完全陌生但重要的场合，你第一反应更像哪一种？";
    if (answers.length >= ASSESSMENT_DEPTH - 1) return getAssessmentLeafPrompt(answers);
    return getDynamicAssessmentTheme(answers).prompt;
};

const getDynamicAssessmentAnswers = (answers: AssessmentAnswer[]): [AssessmentAnswer, AssessmentAnswer] => {
    if (answers.length === 0) {
        return [
            createAssessmentAnswer("A", "先扫一圈环境，确认氛围和规则后再行动", { inward: 2, stable: 1, practical: 1 }, "下一题会顺着你的进入方式继续下钻。"),
            createAssessmentAnswer("B", "先找一个人或一个任务切进去，让自己快速进入状态", { outward: 2, action: 1, empathy: 1 }, "下一题会顺着你的进入方式继续下钻。"),
        ];
    }
    if (answers.length >= ASSESSMENT_DEPTH - 1) {
        const theme = getDynamicAssessmentTheme(answers, 2);
        return [
            createAssessmentAnswer("A", `更需要：${theme.a}`, theme.scoresA, "已生成画像。"),
            createAssessmentAnswer("B", `更需要：${theme.b}`, theme.scoresB, "已生成画像。"),
        ];
    }
    const theme = getDynamicAssessmentTheme(answers);
    return [
        createAssessmentAnswer("A", theme.a, theme.scoresA, "下一题会继续沿着这条选择分支下钻。"),
        createAssessmentAnswer("B", theme.b, theme.scoresB, "下一题会继续沿着这条选择分支下钻。"),
    ];
};

const dynamicAssessmentQuestion: AssessmentQuestion = {
    id: "dynamic-assessment",
    title: "",
    image: assessmentImages.entry,
    getPrompt: getDynamicAssessmentPrompt,
    getAnswers: getDynamicAssessmentAnswers,
};

const getDynamicAssessmentImage = (answers: AssessmentAnswer[]) => {
    if (answers.length === 0) return assessmentImages.entry;
    const imageKeys = Object.keys(assessmentImages);
    const key = imageKeys[(getAssessmentPathIndex(answers) + answers.length) % imageKeys.length];
    return assessmentImages[key];
};

const adaptiveAssessmentStages: AssessmentQuestion[] = [
    {
        id: "entry",
        title: "进入方式",
        image: assessmentImages.entry,
        getPrompt: () => "来到一个完全陌生但重要的场合，你第一反应更像哪一种？",
        getAnswers: () => [
            createAssessmentAnswer("A", "先扫一圈环境，确认氛围和规则后再行动", { inward: 2, stable: 1, practical: 1 }, "下一题会顺着你的进入方式继续下钻。"),
            createAssessmentAnswer("B", "先找一个人或一个任务切进去，让自己快速进入状态", { outward: 2, action: 1, empathy: 1 }, "下一题会顺着你的进入方式继续下钻。"),
        ],
    },
    {
        id: "first-pressure",
        title: "初始压力",
        image: assessmentImages["first-pressure"],
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "如果你已经先观察了一阵，但现场信息越来越多，你会怎样处理这种压力？",
            "如果你已经主动切入了，但反馈比预期复杂，你会怎样稳住局面？",
            "当你发现自己需要马上判断环境是否安全时，你更依赖什么？",
            "当你一开始就被拉进互动里，你更希望先抓住哪条线索？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "把信息分层：哪些必须现在处理，哪些可以先放一放", { order: 2, boundary: 1 }, "下一题会看你的注意力会落在哪里。"),
                createAssessmentAnswer("B", "找一个可信的人确认感受，先让紧张感降下来", { empathy: 2, repair: 1 }, "下一题会看你的注意力会落在哪里。"),
            ],
            [
                createAssessmentAnswer("A", "先把任务目标缩小，避免自己被场面带着跑", { practical: 2, boundary: 1 }, "下一题会看你的注意力会落在哪里。"),
                createAssessmentAnswer("B", "继续互动，从对方反应里快速修正判断", { outward: 2, action: 1 }, "下一题会看你的注意力会落在哪里。"),
            ],
            [
                createAssessmentAnswer("A", "先确认规则、风险和底线，心里有边界才舒服", { boundary: 2, rational: 1 }, "下一题会看你的注意力会落在哪里。"),
                createAssessmentAnswer("B", "先确认人的态度，关系安全了才容易继续", { empathy: 2, stable: 1 }, "下一题会看你的注意力会落在哪里。"),
            ],
        ]),
    },
    {
        id: "attention",
        title: "注意焦点",
        image: assessmentImages.attention,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "当你开始分析眼前局面时，最容易被哪类信息吸住？",
            "如果有人给你一堆建议，你会先筛选哪一种？",
            "当事情还不清楚但必须推进时，你会先观察哪个层面？",
            "你已经有了初步安全感后，下一步更想确认什么？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "可验证的细节、时间线、证据和限制条件", { practical: 2, rational: 1 }, "下一题会看你如何做选择。"),
                createAssessmentAnswer("B", "整体走向、隐藏动机、未来可能发生的变化", { insight: 2, explore: 1 }, "下一题会看你如何做选择。"),
            ],
            [
                createAssessmentAnswer("A", "哪些建议能马上落地，先帮我少走弯路", { action: 2, practical: 1 }, "下一题会看你如何做选择。"),
                createAssessmentAnswer("B", "哪些建议能打开新视角，让我重新理解问题", { insight: 2, explore: 1 }, "下一题会看你如何做选择。"),
            ],
            [
                createAssessmentAnswer("A", "谁负责什么、边界在哪里、我该守住哪一块", { boundary: 2, order: 1 }, "下一题会看你如何做选择。"),
                createAssessmentAnswer("B", "谁的情绪正在变化，关系里有没有没说出口的东西", { empathy: 2, repair: 1 }, "下一题会看你如何做选择。"),
            ],
        ]),
    },
    {
        id: "decision",
        title: "取舍方式",
        image: assessmentImages.decision,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "当两个选项都说得通，但只能选一个时，你更想保住什么？",
            "如果继续推进会有效率，但可能伤到关系，你会更在意哪边？",
            "如果照顾关系会变慢，但能减少冲突，你会怎么判断？",
            "面对一次重要决定，你最怕之后出现哪种后悔？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "保住逻辑一致和长期代价，哪怕短期不舒服", { rational: 2, boundary: 1 }, "下一题会看你的节奏偏好。"),
                createAssessmentAnswer("B", "保住人的感受和合作空间，哪怕效率慢一点", { empathy: 2, repair: 1 }, "下一题会看你的节奏偏好。"),
            ],
            [
                createAssessmentAnswer("A", "先把事情做成，后续再补沟通和情绪", { action: 2, rational: 1 }, "下一题会看你的节奏偏好。"),
                createAssessmentAnswer("B", "先把人稳住，事情可以分阶段慢慢推进", { empathy: 2, stable: 1 }, "下一题会看你的节奏偏好。"),
            ],
            [
                createAssessmentAnswer("A", "后悔自己没有更果断，错过窗口期", { action: 2, explore: 1 }, "下一题会看你的节奏偏好。"),
                createAssessmentAnswer("B", "后悔自己太快下判断，没有听见真正的问题", { repair: 2, insight: 1 }, "下一题会看你的节奏偏好。"),
            ],
        ]),
    },
    {
        id: "rhythm",
        title: "推进节奏",
        image: assessmentImages.rhythm,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "当目标已经定下来，你更自然的推进方式是什么？",
            "当你发现计划开始偏离，你会怎么调整节奏？",
            "当别人期待你快一点，但你心里还没准备好，你更可能？",
            "当你终于有一点掌控感后，你会怎样维持它？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "排出步骤和截止点，完成一个节点再看下一个", { order: 2, stable: 1 }, "下一题会看你如何恢复能量。"),
                createAssessmentAnswer("B", "保留弹性，边做边感受哪里需要换方向", { explore: 2, insight: 1 }, "下一题会看你如何恢复能量。"),
            ],
            [
                createAssessmentAnswer("A", "先停一下，把偏离原因拆出来再继续", { order: 2, rational: 1 }, "下一题会看你如何恢复能量。"),
                createAssessmentAnswer("B", "顺着变化试一个新办法，也许会更接近答案", { explore: 2, action: 1 }, "下一题会看你如何恢复能量。"),
            ],
            [
                createAssessmentAnswer("A", "说明我需要一点准备时间，不想被节奏拖走", { boundary: 2, inward: 1 }, "下一题会看你如何恢复能量。"),
                createAssessmentAnswer("B", "先跟上对方节奏，再在过程中找自己的位置", { outward: 2, action: 1 }, "下一题会看你如何恢复能量。"),
            ],
        ]),
    },
    {
        id: "recovery",
        title: "能量恢复",
        image: assessmentImages.recovery,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "经历一段高强度投入后，哪种恢复对你更有效？",
            "如果你已经为了别人撑了一阵，你最需要什么补回来？",
            "当你脑子里一直转个不停时，什么更能让你回到自己身上？",
            "当你感觉被消耗但还没崩掉时，你会先怎么自救？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "独处、降噪、减少输入，让身体和脑子都慢下来", { inward: 2, repair: 1 }, "下一题会看你处理冲突的方式。"),
                createAssessmentAnswer("B", "轻松陪伴、被理解、有人和我一起把情绪放下", { empathy: 2, outward: 1 }, "下一题会看你处理冲突的方式。"),
            ],
            [
                createAssessmentAnswer("A", "重新划清哪些事不是我的责任", { boundary: 2, repair: 1 }, "下一题会看你处理冲突的方式。"),
                createAssessmentAnswer("B", "听到一句真诚的肯定，确认自己没有白白付出", { empathy: 2, stable: 1 }, "下一题会看你处理冲突的方式。"),
            ],
            [
                createAssessmentAnswer("A", "整理文字、清单或空间，把混乱变得可见", { order: 2, practical: 1 }, "下一题会看你处理冲突的方式。"),
                createAssessmentAnswer("B", "换个环境走一走，让新的感受把旧循环打断", { explore: 2, repair: 1 }, "下一题会看你处理冲突的方式。"),
            ],
        ]),
    },
    {
        id: "conflict",
        title: "冲突处理",
        image: assessmentImages.conflict,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "如果关系里出现误会，而你又不想让问题扩大，你会先做什么？",
            "当你觉得自己被冒犯，但对方可能不是故意的，你会怎么处理？",
            "当冲突已经让你很累，你更希望对话先从哪里开始？",
            "如果必须表达不满，你会更怕哪一种结果？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "先把事实和边界说清楚，避免继续猜测", { boundary: 2, rational: 1 }, "下一题会看你面对变化的方式。"),
                createAssessmentAnswer("B", "先确认双方感受，再慢慢靠近真正的问题", { empathy: 2, repair: 1 }, "下一题会看你面对变化的方式。"),
            ],
            [
                createAssessmentAnswer("A", "明确告诉对方哪件事让我不舒服", { boundary: 2, action: 1 }, "下一题会看你面对变化的方式。"),
                createAssessmentAnswer("B", "先问清楚对方当时的想法，再决定怎么回应", { empathy: 2, insight: 1 }, "下一题会看你面对变化的方式。"),
            ],
            [
                createAssessmentAnswer("A", "怕自己没说清楚，之后问题还会反复出现", { order: 2, boundary: 1 }, "下一题会看你面对变化的方式。"),
                createAssessmentAnswer("B", "怕自己说重了，让关系变得更远", { empathy: 2, repair: 1 }, "下一题会看你面对变化的方式。"),
            ],
        ]),
    },
    {
        id: "change",
        title: "变化适应",
        image: assessmentImages.change,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "当原本稳定的安排突然被打乱，你更像哪一种反应？",
            "如果一个新机会很诱人，但也意味着不确定性，你会怎么靠近它？",
            "当别人都在变，你需要多久才会觉得自己也可以变？",
            "如果你必须重新开始，你最想先保留什么？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "先守住核心目标，只允许小范围试错", { stable: 2, order: 1 }, "下一题会看你的表达方式。"),
                createAssessmentAnswer("B", "把变化当线索，快速试一个新方向", { explore: 2, action: 1 }, "下一题会看你的表达方式。"),
            ],
            [
                createAssessmentAnswer("A", "先确认风险和退出方式，再决定要不要开始", { boundary: 2, practical: 1 }, "下一题会看你的表达方式。"),
                createAssessmentAnswer("B", "先体验一小段，真实感受比想象更重要", { explore: 2, insight: 1 }, "下一题会看你的表达方式。"),
            ],
            [
                createAssessmentAnswer("A", "保留熟悉的节奏和支点，变化才不会失控", { stable: 2, inward: 1 }, "下一题会看你的表达方式。"),
                createAssessmentAnswer("B", "保留选择权和空间，边走边重新定义自己", { explore: 2, boundary: 1 }, "下一题会看你的表达方式。"),
            ],
        ]),
    },
    {
        id: "expression",
        title: "表达方式",
        image: assessmentImages.expression,
        getPrompt: (answers) => pickAssessmentVariant(answers, [
            "当你终于想把内心的想法说出来，你更自然的表达方式是？",
            "如果你要让别人真正理解你，而不是只听懂字面意思，你会怎么说？",
            "当你担心表达会被误解，你会先做哪件事？",
            "如果你很在意一段关系，你的表达会更偏向什么？",
        ]),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "先讲结构、原因和边界，让对方知道重点在哪里", { order: 2, rational: 1 }, "最后一题会收束支持需求。"),
                createAssessmentAnswer("B", "用故事、比喻或感受把真实状态带出来", { insight: 2, empathy: 1 }, "最后一题会收束支持需求。"),
            ],
            [
                createAssessmentAnswer("A", "把希望对方回应的具体动作说出来", { action: 2, boundary: 1 }, "最后一题会收束支持需求。"),
                createAssessmentAnswer("B", "先让对方知道这件事对我为什么重要", { empathy: 2, insight: 1 }, "最后一题会收束支持需求。"),
            ],
            [
                createAssessmentAnswer("A", "先限定语境：我不是指责，只是在说明影响", { boundary: 2, repair: 1 }, "最后一题会收束支持需求。"),
                createAssessmentAnswer("B", "先表达善意：我仍然重视这段关系", { empathy: 2, stable: 1 }, "最后一题会收束支持需求。"),
            ],
        ]),
    },
    {
        id: "support",
        title: "支持需求",
        image: assessmentImages.support,
        getPrompt: (answers) => getAssessmentLeafPrompt(answers),
        getAnswers: (answers) => pickAssessmentVariant(answers, [
            [
                createAssessmentAnswer("A", "给我清晰反馈、资源和下一步行动", { action: 2, boundary: 1 }, "已生成画像。"),
                createAssessmentAnswer("B", "先理解我，再陪我慢慢把感受理顺", { repair: 2, empathy: 1 }, "已生成画像。"),
            ],
            [
                createAssessmentAnswer("A", "帮我把混乱拆成步骤，让我看到可控的开始", { order: 2, practical: 1 }, "已生成画像。"),
                createAssessmentAnswer("B", "陪我看见问题背后的意义，而不是只催我解决", { insight: 2, empathy: 1 }, "已生成画像。"),
            ],
            [
                createAssessmentAnswer("A", "提醒我守住边界，不要把所有责任都背走", { boundary: 2, stable: 1 }, "已生成画像。"),
                createAssessmentAnswer("B", "给我一点尝试空间，让我用自己的节奏变化", { explore: 2, action: 1 }, "已生成画像。"),
            ],
        ]),
    },
];

const lobbyModules: Array<{
    id: LobbyModule;
    title: string;
    subtitle: string;
    Icon: typeof UserGroupIcon;
}> = [
    { id: "digital-human", title: "数字人", subtitle: "选择陪伴角色进入实时对话", Icon: UserGroupIcon },
    { id: "audio", title: "音频疗愈", subtitle: "呼吸、睡眠、正念与自然声", Icon: MusicalNoteIcon },
    { id: "assessment", title: "心理评测", subtitle: "十题自适应性格画像", Icon: ClipboardDocumentCheckIcon },
    { id: "games", title: "游戏模块", subtitle: "休闲、益智、放松训练", Icon: PuzzlePieceIcon },
];

const audioCategories: Array<{ id: HealingAudioEntry["category"]; title: string; subtitle: string }> = [
    { id: "pop", title: "流行乐", subtitle: "轻节拍、明亮旋律" },
    { id: "white-noise", title: "白噪音疗愈", subtitle: "雨声、自然声、低频底噪" },
    { id: "instrumental", title: "金曲纯音", subtitle: "全球热歌前 20 的纯音乐版本" },
];

const healingAudioEntries: HealingAudioEntry[] = [
    {
        id: "sunny-pop",
        title: "晴天轻流行",
        subtitle: "明亮和弦加轻节拍，适合提振心情",
        duration: "4 分钟",
        category: "pop",
        tone: "pop-bright",
        style: "anthem",
        image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "soft-pop",
        title: "晚风流行",
        subtitle: "柔和旋律和慢速律动，适合放松聊天前",
        duration: "5 分钟",
        category: "pop",
        tone: "pop-soft",
        style: "nostalgia",
        image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "sleep-rain",
        title: "睡眠放松",
        subtitle: "低频铺底与柔和雨声，适合睡前安定",
        duration: "12 分钟",
        category: "white-noise",
        tone: "sleep",
        style: "rain",
        image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "body-scan",
        title: "身体扫描",
        subtitle: "从肩颈到腹部逐段放松身体警觉",
        duration: "9 分钟",
        category: "white-noise",
        tone: "nature",
        style: "forest",
        image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "mindful-breath",
        title: "正念呼吸",
        subtitle: "用 4-6 呼吸节奏快速降低紧张感",
        duration: "6 分钟",
        category: "white-noise",
        tone: "breath",
        style: "minimal",
        image: "https://images.unsplash.com/photo-1506126613408-eca07ce68773?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "piano-morning",
        title: "晨间钢琴",
        subtitle: "清澈钢琴动机，适合安静整理思绪",
        duration: "6 分钟",
        category: "instrumental",
        tone: "piano",
        style: "lofi",
        image: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "guitar-evening",
        title: "黄昏吉他",
        subtitle: "温暖拨弦质感，适合舒缓情绪",
        duration: "7 分钟",
        category: "instrumental",
        tone: "guitar",
        style: "cinematic",
        image: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "focus-flow",
        title: "专注冥想",
        subtitle: "稳定注意力，适合学习和工作前使用",
        duration: "8 分钟",
        category: "instrumental",
        tone: "focus",
        style: "minimal",
        image: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "self-compassion",
        title: "自我慈悲",
        subtitle: "把苛责换成支持，适合情绪低落时使用",
        duration: "7 分钟",
        category: "white-noise",
        tone: "breath",
        style: "wind",
        image: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "anxiety-release",
        title: "焦虑舒缓",
        subtitle: "渐进式放松，帮助从反复担心中退出",
        duration: "10 分钟",
        category: "white-noise",
        tone: "sleep",
        style: "ocean",
        image: "https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=900&q=80",
    },
];

const globalHitInstrumentals: HealingAudioEntry[] = [
    { id: "classic-instrumental-01", title: "01 - 沉默是金", subtitle: "经典华语 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "piano", style: "nostalgia", image: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-02", title: "02 - 但愿人长久", subtitle: "经典华语 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "piano", style: "lofi", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-03", title: "03 - 风之谷", subtitle: "经典旋律 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-04", title: "04 - 荷塘月色", subtitle: "国风流行 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-soft", style: "nostalgia", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-05", title: "05 - 寂静之声", subtitle: "经典旋律 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "focus", style: "minimal", image: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-06", title: "06 - 茉莉花", subtitle: "民乐旋律 · 纯音乐版", duration: "3 分钟", category: "instrumental", tone: "piano", style: "lofi", image: "https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-07", title: "07 - 女儿情", subtitle: "经典影视 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-08", title: "08 - 琵琶语", subtitle: "民乐氛围 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "focus", style: "minimal", image: "https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-09", title: "09 - 偏偏喜欢你", subtitle: "经典华语 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-soft", style: "nostalgia", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80" },
    { id: "classic-instrumental-10", title: "10 - 千千阙歌", subtitle: "经典华语 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80" },
    { id: "sunny-pop-instrumental", title: "晴天轻流行", subtitle: "明亮和弦加轻节拍 · 纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80" },
    { id: "soft-pop-instrumental", title: "晚风流行", subtitle: "柔和旋律和慢速律动 · 纯音乐版", duration: "5 分钟", category: "instrumental", tone: "pop-soft", style: "nostalgia", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80" },
    { id: "billie-jean", title: "Billie Jean", subtitle: "Michael Jackson · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "piano", style: "anthem", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80" },
    { id: "beauty-and-a-beat", title: "Beauty And A Beat", subtitle: "Justin Bieber, Nicki Minaj · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80" },
    { id: "swim", title: "SWIM", subtitle: "BTS · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "focus", style: "lofi", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80" },
    { id: "janice-stfu", title: "Janice STFU", subtitle: "Drake · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=900&q=80" },
    { id: "babydoll", title: "Babydoll", subtitle: "Dominic Fike · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "pop-soft", style: "nostalgia", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80" },
    { id: "beat-it", title: "Beat It", subtitle: "Michael Jackson · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80" },
    { id: "national-treasures", title: "National Treasures", subtitle: "Drake · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "focus", style: "minimal", image: "https://images.unsplash.com/photo-1487180144351-b8472da7d491?auto=format&fit=crop&w=900&q=80" },
    { id: "ran-to-atlanta", title: "Ran To Atlanta", subtitle: "Drake, Future, Molly Santana · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80" },
    { id: "whisper-my-name", title: "Whisper My Name", subtitle: "Drake · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "breath", style: "minimal", image: "https://images.unsplash.com/photo-1482192505345-5655af888cc4?auto=format&fit=crop&w=900&q=80" },
    { id: "earrings", title: "Earrings", subtitle: "Malcolm Todd · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "piano", style: "lofi", image: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=900&q=80" },
    { id: "the-one-that-got-away", title: "The One That Got Away", subtitle: "Katy Perry · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "pop-soft", style: "nostalgia", image: "https://images.unsplash.com/photo-1516280440614-37939bbacd81?auto=format&fit=crop&w=900&q=80" },
    { id: "back-to-friends", title: "back to friends", subtitle: "sombr · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "piano", style: "lofi", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80" },
    { id: "human-nature", title: "Human Nature", subtitle: "Michael Jackson · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80" },
    { id: "shabang", title: "Shabang", subtitle: "Drake · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "focus", style: "minimal", image: "https://images.unsplash.com/photo-1501612780327-45045538702b?auto=format&fit=crop&w=900&q=80" },
    { id: "dont-stop-til-you-get-enough", title: "Don't Stop 'Til You Get Enough", subtitle: "Michael Jackson · 金曲纯音乐版", duration: "6 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=900&q=80" },
    { id: "end-of-beginning", title: "End of Beginning", subtitle: "Djo · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "piano", style: "nostalgia", image: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=900&q=80" },
    { id: "man-i-need", title: "Man I Need", subtitle: "Olivia Dean · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "piano", style: "lofi", image: "https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80" },
    { id: "choosin-texas", title: "Choosin' Texas", subtitle: "Ella Langley · 金曲纯音乐版", duration: "4 分钟", category: "instrumental", tone: "guitar", style: "cinematic", image: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80" },
    { id: "risk-it-all", title: "Risk It All", subtitle: "Bruno Mars · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "pop-bright", style: "anthem", image: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80" },
    { id: "dracula-remix", title: "Dracula - JENNIE Remix", subtitle: "Tame Impala, JENNIE · 金曲纯音乐版", duration: "3 分钟", category: "instrumental", tone: "focus", style: "lofi", image: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=900&q=80" },
];

const chinesePopEntries: HealingAudioEntry[] = [
    "芒种", "少年", "一笑江湖", "漠河舞厅", "学猫叫", "小了白了兔", "晴天", "一路生花", "向云端", "孤勇者",
    "晚夜微风问海棠", "锦鲤抄", "牵丝戏", "难却", "叹云兮", "乱世书", "虞兮叹", "关山酒", "落了白", "吹梦到西洲",
    "谪仙", "青丝", "盲眼画师", "赤伶", "九张机", "倾尽天下", "月光", "不谓侠", "春庭雪", "棠梨煎雪",
    "谪居", "眉间雪", "探窗", "琵琶行", "长安姑娘", "盗墓笔记十年人间", "红昭愿", "鸳鸯戏", "千里共婵娟", "相思引",
    "画离弦", "溺水三千", "清明上河图", "拜无忧", "典狱司", "伯虎说", "相思瑶", "桃花诺", "壁上观",
].map((title, index) => {
    const isAntique = index >= 10;
    const styleCycle: HealingAudioEntry["style"][] = isAntique
        ? ["cinematic", "nostalgia", "lofi", "minimal"]
        : ["anthem", "nostalgia", "lofi"];
    const toneCycle: HealingAudioEntry["tone"][] = isAntique
        ? ["guitar", "piano", "pop-soft", "focus"]
        : ["pop-bright", "pop-soft", "piano"];

    return {
        id: `cn-pop-${index + 1}`,
        title,
        subtitle: `${isAntique ? "国风流行" : "中文流行"} · 风格版`,
        duration: `${index % 4 === 0 ? 4 : 3} 分钟`,
        category: "pop",
        tone: toneCycle[index % toneCycle.length],
        style: styleCycle[index % styleCycle.length],
        image: isAntique
            ? "https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=900&q=80"
            : "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
    };
});

const musicCoverImages = {
    stage: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=900&q=80",
    cityNight: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=900&q=80",
    lotusMoon: "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80",
    valley: "https://images.unsplash.com/photo-1500534314209-a25ddb2bd429?auto=format&fit=crop&w=900&q=80",
    flower: "https://images.unsplash.com/photo-1490750967868-88aa4486c946?auto=format&fit=crop&w=900&q=80",
    guqin: "https://images.unsplash.com/photo-1528181304800-259b08848526?auto=format&fit=crop&w=900&q=80",
    opera: "https://images.unsplash.com/photo-1503095396549-807759245b35?auto=format&fit=crop&w=900&q=80",
    ancientCity: "https://images.unsplash.com/photo-1528360983277-13d401cdc186?auto=format&fit=crop&w=900&q=80",
    moon: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=900&q=80",
    ocean: "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=900&q=80",
    clouds: "https://images.unsplash.com/photo-1499346030926-9a72daac6c63?auto=format&fit=crop&w=900&q=80",
    guitar: "https://images.unsplash.com/photo-1510915361894-db8b60106cb1?auto=format&fit=crop&w=900&q=80",
    piano: "https://images.unsplash.com/photo-1520523839897-bd0b52f945a0?auto=format&fit=crop&w=900&q=80",
};

const resolveMusicCover = (title: string, fallback: string) => {
    if (/荷塘|月色|千千阙歌|但愿人长久|月光|婵娟/.test(title)) return musicCoverImages.lotusMoon;
    if (/风之谷|向云端|云/.test(title)) return musicCoverImages.valley;
    if (/茉莉花|一路生花|桃花|棠梨|春庭雪/.test(title)) return musicCoverImages.flower;
    if (/琵琶|牵丝戏|锦鲤抄|九张机|倾尽天下|谪仙|青丝|不谓侠|关山酒|虞兮叹|相思|画离弦|清明上河图|拜无忧|伯虎说|壁上观/.test(title)) return musicCoverImages.guqin;
    if (/赤伶|探窗|红昭愿|鸳鸯戏|典狱司|长安|女儿情/.test(title)) return musicCoverImages.opera;
    if (/江湖|乱世书|盗墓笔记|十年人间|长安姑娘/.test(title)) return musicCoverImages.ancientCity;
    if (/漠河|寂静|沉默/.test(title)) return musicCoverImages.cityNight;
    if (/海棠|问海棠|溺水|海/.test(title)) return musicCoverImages.ocean;
    if (/晴天|少年|孤勇者|学猫叫|小了白了兔|芒种/.test(title)) return musicCoverImages.stage;
    if (/Billie|Beat|Beauty|Risk|Dracula|SWIM/.test(title)) return musicCoverImages.stage;
    if (/Guitar|Texas|Human Nature/.test(title)) return musicCoverImages.guitar;
    if (/Earrings|Beginning|Man I Need|friends/.test(title)) return musicCoverImages.piano;
    return fallback;
};

const gameEntries: GameEntry[] = [
    {
        id: "2048",
        title: "2048 数字合成",
        subtitle: "高频流行的滑动合成益智游戏",
        tag: "逻辑",
        image: "https://images.unsplash.com/photo-1611996575749-79a3a250f948?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "sudoku",
        title: "数独训练",
        subtitle: "经典推理，适合稳定注意力",
        tag: "推理",
        image: "https://images.unsplash.com/photo-1635070041078-e363dbe005cb?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "memory",
        title: "记忆翻牌",
        subtitle: "短时记忆与图形匹配训练",
        tag: "记忆",
        image: "https://images.unsplash.com/photo-1610890716171-6b1bb98ffd09?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "breath",
        title: "呼吸节奏挑战",
        subtitle: "跟随节奏放松，兼具小游戏和训练",
        tag: "放松",
        image: "https://images.unsplash.com/photo-1470115636492-6d2b56f9146d?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "link",
        title: "颜色连线",
        subtitle: "把同色节点连接且路径不交叉",
        tag: "空间",
        image: "https://images.unsplash.com/photo-1557683316-973673baf926?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "tower",
        title: "汉诺塔",
        subtitle: "用最少步数完成圆盘移动",
        tag: "策略",
        image: "https://images.unsplash.com/photo-1517048676732-d65bc937f952?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "mines",
        title: "扫雷",
        subtitle: "标记风险，推理安全区域",
        tag: "推理",
        image: "https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80",
    },
    {
        id: "tetris",
        title: "俄罗斯方块",
        subtitle: "旋转、堆叠、消除整行",
        tag: "反应",
        image: "https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=900&q=80",
    },
];

const assessmentQuestions = adaptiveAssessmentStages;

const assessmentTypeLabels: Record<string, { title: string; description: string }> = {
    inward: { title: "内省型", description: "需要安静空间整理信息，适合深度思考。" },
    outward: { title: "连接型", description: "通过交流获得能量，擅长带动关系。" },
    stable: { title: "稳定型", description: "重视安全感和连续性，能守住节奏。" },
    action: { title: "行动型", description: "偏好快速试错，把想法转成动作。" },
    order: { title: "秩序型", description: "喜欢结构和计划，能把混乱变清楚。" },
    repair: { title: "修复型", description: "重视恢复与照顾，能觉察情绪消耗。" },
    empathy: { title: "共情型", description: "敏感于他人感受，适合做关系协调。" },
    practical: { title: "现实型", description: "关注事实细节，判断落地性强。" },
    insight: { title: "洞察型", description: "擅长看见模式、意义和潜在趋势。" },
    explore: { title: "探索型", description: "愿意保持开放，能从变化里找到机会。" },
    rational: { title: "理性型", description: "看重逻辑一致和长期代价。" },
    boundary: { title: "边界型", description: "能保护精力，适合处理复杂边界。" },
};

const breathGamePhases = [
    { label: "吸气", seconds: 4, helper: "鼻吸，圆形会慢慢变大。", sizeClass: "h-32 w-32" },
    { label: "停留", seconds: 2, helper: "轻轻停住，不要憋到难受。", sizeClass: "h-28 w-28" },
    { label: "呼气", seconds: 6, helper: "慢慢呼出，圆形会收缩。", sizeClass: "h-20 w-20" },
    { label: "放松", seconds: 2, helper: "自然呼吸，准备下一轮。", sizeClass: "h-24 w-24" },
];

const createHealingAudioUrl = (entry: HealingAudioEntry) => {
    const { tone, style } = entry;
    const sampleRate = 22050;
    const durationSeconds = style === "anthem" || style === "cinematic" ? 12 : 10;
    const sampleCount = sampleRate * durationSeconds;
    const dataSize = sampleCount * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const writeString = (offset: number, value: string) => {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + dataSize, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    const preset = {
        anthem: {
            root: [261.63, 329.63, 392, 523.25],
            melody: [523.25, 659.25, 587.33, 523.25, 784, 659.25],
            beatRate: 2.9,
            noise: 0.004,
            melodyStep: 0.55,
            beatStrength: 0.28,
            envelope: 0.95,
            shimmer: 0.11,
            swing: 0.08,
        },
        nostalgia: {
            root: [220, 261.63, 329.63, 392],
            melody: [440, 392, 329.63, 392, 440, 392],
            beatRate: 1.5,
            noise: 0.006,
            melodyStep: 0.95,
            beatStrength: 0.12,
            envelope: 0.85,
            shimmer: 0.06,
            swing: 0.15,
        },
        rain: {
            root: [146.83, 196, 246.94, 293.66],
            melody: [293.66, 246.94, 220, 246.94],
            beatRate: 0.45,
            noise: 0.05,
            melodyStep: 2.5,
            beatStrength: 0.03,
            envelope: 0.75,
            shimmer: 0.02,
            swing: 0,
        },
        wind: {
            root: [174.61, 220, 261.63, 349.23],
            melody: [329.63, 246.94, 207.65, 246.94],
            beatRate: 0.35,
            noise: 0.04,
            melodyStep: 3,
            beatStrength: 0.02,
            envelope: 0.78,
            shimmer: 0.015,
            swing: 0,
        },
        ocean: {
            root: [164.81, 207.65, 246.94, 329.63],
            melody: [329.63, 293.66, 246.94, 196],
            beatRate: 0.28,
            noise: 0.045,
            melodyStep: 2.8,
            beatStrength: 0.02,
            envelope: 0.8,
            shimmer: 0.03,
            swing: 0,
        },
        forest: {
            root: [174.61, 220, 261.63, 392],
            melody: [392, 329.63, 293.66, 329.63],
            beatRate: 0.32,
            noise: 0.038,
            melodyStep: 2.2,
            beatStrength: 0.03,
            envelope: 0.8,
            shimmer: 0.04,
            swing: 0,
        },
        minimal: {
            root: [196, 246.94, 329.63, 392],
            melody: [392, 329.63, 293.66, 329.63],
            beatRate: 0.6,
            noise: 0.012,
            melodyStep: 1.6,
            beatStrength: 0.05,
            envelope: 0.78,
            shimmer: 0.02,
            swing: 0.04,
        },
        lofi: {
            root: [261.63, 311.13, 392, 466.16],
            melody: [523.25, 466.16, 392, 311.13, 349.23, 392],
            beatRate: 1.0,
            noise: 0.02,
            melodyStep: 1.1,
            beatStrength: 0.08,
            envelope: 0.82,
            shimmer: 0.05,
            swing: 0.12,
        },
        cinematic: {
            root: [196, 261.63, 329.63, 392],
            melody: [392, 523.25, 659.25, 784, 659.25, 523.25],
            beatRate: 0.75,
            noise: 0.018,
            melodyStep: 1.4,
            beatStrength: 0.06,
            envelope: 0.88,
            shimmer: 0.09,
            swing: 0.05,
        },
    } as const;

    const presetKey =
        style === "anthem" ? "anthem"
        : style === "nostalgia" ? "nostalgia"
        : style === "lofi" ? "lofi"
        : style === "cinematic" ? "cinematic"
        : style === "rain" ? "rain"
        : style === "wind" ? "wind"
        : style === "ocean" ? "ocean"
        : style === "forest" ? "forest"
        : "minimal";
    const tonePreset = preset[presetKey];
    const isPop = presetKey === "anthem" || presetKey === "nostalgia";
    const isInstrumental = presetKey === "lofi" || presetKey === "cinematic" || tone === "piano" || tone === "guitar" || tone === "focus";
    const isAmbient = !isPop && !isInstrumental;
    const chord = tonePreset.root;
    const melody = tonePreset.melody;

    for (let i = 0; i < sampleCount; i += 1) {
        const t = i / sampleRate;
        const beatPulse = Math.sin(2 * Math.PI * tonePreset.beatRate * t + tonePreset.swing * Math.sin(2 * Math.PI * t * 0.25));
        const beat = isPop || presetKey === "lofi" || presetKey === "cinematic" ? Math.max(0, beatPulse) * tonePreset.beatStrength : 0;
        const pluck = isInstrumental ? Math.exp(-((t * 2) % 1) * (presetKey === "cinematic" ? 4 : 6)) * (presetKey === "cinematic" ? 0.18 : 0.12) : 0;
        const breathEnvelope = isAmbient ? 0.72 + 0.28 * Math.sin(2 * Math.PI * t / 5) : tonePreset.envelope;
        const base = chord.reduce((sum, freq, index) => {
            const harmonic = Math.sin(2 * Math.PI * freq * t) + Math.sin(2 * Math.PI * freq * 2 * t) * 0.18;
            return sum + harmonic * (index === 0 ? 0.22 : presetKey === "cinematic" ? 0.11 : 0.085);
        }, 0);
        const melodyStep = tonePreset.melodyStep;
        const melodyFreq = melody[Math.floor(t / melodyStep) % melody.length];
        const melodyEnvelope = isPop ? (presetKey === "anthem" ? 0.32 : 0.22) : isInstrumental ? 0.19 + pluck : 0.1;
        const shimmer = tonePreset.shimmer * Math.sin(2 * Math.PI * (melodyFreq / 2) * t);
        const melodyWave = (Math.sin(2 * Math.PI * melodyFreq * t) + Math.sin(2 * Math.PI * melodyFreq * 2 * t) * 0.08 + shimmer) * melodyEnvelope;
        const softNoise = (Math.random() * 2 - 1) * tonePreset.noise;
        const fadeIn = Math.min(1, t / 0.6);
        const fadeOut = Math.min(1, (durationSeconds - t) / 0.8);
        const sample = Math.max(-1, Math.min(1, (base + melodyWave + softNoise + beat) * breathEnvelope * fadeIn * fadeOut * (isPop ? 0.84 : isInstrumental ? 0.74 : 0.7)));
        view.setInt16(44 + i * 2, sample * 32767, true);
    }

    return URL.createObjectURL(new Blob([view], { type: "audio/wav" }));
};

const playCelebrationSound = (variant: "bright" | "soft" = "bright") => {
    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.0001, ctx.currentTime);
    master.gain.exponentialRampToValueAtTime(variant === "soft" ? 0.2 : 0.32, ctx.currentTime + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (variant === "soft" ? 1.1 : 0.9));
    master.connect(ctx.destination);

    const notes = variant === "soft"
        ? [329.63, 392, 523.25]
        : [523.25, 659.25, 783.99, 1046.5];

    notes.forEach((frequency, index) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const start = ctx.currentTime + index * (variant === "soft" ? 0.16 : 0.08);
        osc.type = variant === "soft" ? "sine" : "triangle";
        osc.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(variant === "soft" ? 0.18 : 0.28, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + (variant === "soft" ? 0.45 : 0.32));
        osc.connect(gain);
        gain.connect(master);
        osc.start(start);
        osc.stop(start + 0.5);
    });

    void ctx.resume();
    window.setTimeout(() => {
        if (ctx.state !== "closed") {
            ctx.close().catch(() => {});
        }
    }, 1400);
};

const getTrackAudioSrc = (entry: HealingAudioEntry) => {
    return entry.audioSrc ?? `/audio/tracks/${entry.id}.mp3`;
};

function DigitalHumanEntryPage({ onSelect }: { onSelect: (character: ResourceModel) => void }) {
    const [activeModule, setActiveModule] = useState<LobbyModule>("digital-human");
    const characters = useMemo(() => getDigitalHumanEntries(), []);

    return (
        <main className="h-[calc(100vh-64px)] overflow-y-auto px-4 pb-10 pt-5 md:px-8">
            <div className="mx-auto flex max-w-7xl flex-col gap-6">
                <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                    <div className="max-w-2xl text-white drop-shadow">
                        <div className="mb-3 inline-flex items-center rounded-full border border-white/35 bg-white/18 px-4 py-1.5 text-xs font-semibold tracking-wide text-white/95 backdrop-blur-md">
                            WELLNESS SPACE
                        </div>
                        <h1 className="text-3xl font-bold leading-tight md:text-5xl">心理陪伴中心</h1>
                        <p className="mt-3 text-sm leading-6 text-white/95 md:text-base">数字人对话、音频疗愈、心理评测和休闲训练集中在一个入口里。</p>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    {lobbyModules.map(({ id, title, subtitle, Icon }) => {
                        const isActive = activeModule === id;
                        return (
                            <button
                                key={id}
                                type="button"
                                onClick={() => setActiveModule(id)}
                                className={`group flex min-h-[104px] items-center gap-3 rounded-xl border px-4 py-4 text-left backdrop-blur-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-white/80 ${
                                    isActive
                                        ? "border-white/80 bg-white/88 text-slate-950 shadow-xl shadow-slate-900/15"
                                        : "border-white/35 bg-white/18 text-white hover:border-white/60 hover:bg-white/28"
                                }`}
                            >
                                <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${isActive ? "bg-slate-950 text-white" : "bg-slate-950/28 text-white"}`}>
                                    <Icon className="h-6 w-6" />
                                </span>
                                <span className="min-w-0">
                                    <span className="flex items-center gap-2 text-base font-bold leading-5">
                                        <span>{title}</span>
                                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${isActive ? "bg-slate-950 text-white" : "bg-white/18 text-white"}`}>
                                            {id === "digital-human" ? characters.length : id === "audio" ? healingAudioEntries.length : id === "assessment" ? ASSESSMENT_DEPTH : gameEntries.length}
                                        </span>
                                    </span>
                                    <span className={`mt-1 block text-xs leading-5 ${isActive ? "text-slate-800" : "text-white/95"}`}>{subtitle}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                {activeModule === "digital-human" && <DigitalHumanPanel characters={characters} onSelect={onSelect} />}
                {activeModule === "audio" && <HealingAudioPanel />}
                {activeModule === "assessment" && <AssessmentPanel />}
                {activeModule === "games" && <GamesPanel />}
            </div>
        </main>
    );
}

function DigitalHumanPanel({ characters, onSelect }: { characters: ResourceModel[]; onSelect: (character: ResourceModel) => void }) {
    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-white md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-2xl font-bold">选择数字人</h2>
                    <p className="mt-1 text-sm text-white/95">一个页面约展示 8 个入口，向下滚动可以查看更多角色。</p>
                </div>
                <div className="text-sm text-white/95">点击角色进入专属语音对话</div>
            </div>
                <div className="grid grid-cols-2 gap-4 md:gap-5 lg:grid-cols-4">
                    {characters.map((character, index) => {
                        const previewLink = getCharacterPreviewLink(character);

                        return (
                        <button
                            key={character.resource_id}
                            type="button"
                            onClick={() => onSelect(character)}
                            className="group relative flex min-h-[278px] flex-col overflow-hidden rounded-[28px] border border-white/45 bg-white/22 text-left shadow-2xl shadow-slate-900/18 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/70 hover:bg-white/30 hover:shadow-slate-900/28 focus:outline-none focus:ring-2 focus:ring-white/85 md:min-h-[322px]"
                            aria-label={`进入 ${character.name}`}
                        >
                            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-br from-cyan-300/25 via-white/14 to-rose-300/18" />
                            <div className="absolute right-4 top-4 rounded-full border border-white/35 bg-slate-950/25 px-3 py-1 text-xs font-semibold text-white/95 backdrop-blur-md">
                                No. {String(index + 1).padStart(2, "0")}
                            </div>
                            <div className="relative flex min-h-0 flex-1 items-end justify-center px-5 pt-8">
                                <div className="absolute inset-x-4 bottom-4 top-12 rounded-3xl border border-white/30 bg-gradient-to-br from-white/34 via-sky-100/24 to-teal-100/28 shadow-inner backdrop-blur-sm" />
                                <div className="absolute inset-x-8 bottom-8 h-20 rounded-full bg-white/22 blur-2xl" />
                                <img
                                    src={previewLink}
                                    alt={character.name}
                                    onError={(event) => {
                                        event.currentTarget.src = character.link;
                                    }}
                                    className="relative h-[218px] max-w-full object-contain drop-shadow-2xl transition-transform duration-300 group-hover:scale-108 md:h-[255px]"
                                />
                            </div>
                            <div className="relative w-full border-t border-white/25 bg-slate-950/38 px-4 py-4 text-white backdrop-blur-md">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="truncate text-lg font-semibold leading-6">{character.name}</div>
                                        <div className="mt-1 text-xs text-white/95">{getCharacterVoiceLabel(character.name)} · 语音对话入口</div>
                                    </div>
                                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-slate-900 shadow-lg transition-transform duration-300 group-hover:translate-x-0.5">
                                        <ArrowRightOnRectangleIcon className="h-5 w-5" />
                                    </div>
                                </div>
                            </div>
                        </button>
                        );
                    })}
                </div>
        </section>
    );
}

function HealingAudioPanel() {
    const [audioSession, setAudioSession] = useState<{ id: string; stop: () => void } | null>(null);
    const [selectedAudio, setSelectedAudio] = useState<HealingAudioEntry | null>(null);
    const [activeAudioCategory, setActiveAudioCategory] = useState<HealingAudioEntry["category"]>("pop");
    const [audioPlaybackError, setAudioPlaybackError] = useState("");
    const visibleAudioEntries = activeAudioCategory === "instrumental"
        ? globalHitInstrumentals
        : activeAudioCategory === "pop"
            ? chinesePopEntries
            : healingAudioEntries.filter((entry) => entry.category === activeAudioCategory);

    useEffect(() => () => audioSession?.stop(), [audioSession]);

    const stopAudio = () => {
        audioSession?.stop();
        setAudioSession(null);
    };

    const startAudio = async (entry: HealingAudioEntry) => {
        setAudioPlaybackError("");
        audioSession?.stop();
        const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) {
            setAudioPlaybackError("当前浏览器不支持网页音频播放。");
            return;
        }

        const realAudioSrc = getTrackAudioSrc(entry);
        const realAudioElement = new Audio(realAudioSrc);
        realAudioElement.loop = true;
        realAudioElement.volume = 0.86;

        try {
            await realAudioElement.play();
            setAudioSession({
                id: entry.id,
                stop: () => {
                    realAudioElement.pause();
                    realAudioElement.src = "";
                },
            });
            return;
        } catch {
            realAudioElement.src = "";
        }

        const audioUrl = createHealingAudioUrl(entry);
        const audioElement = new Audio(audioUrl);
        audioElement.loop = true;
        audioElement.volume = 0.82;

        try {
            await audioElement.play();
            setAudioPlaybackError("未找到授权原曲音频，当前播放风格生成版。");
            setAudioSession({
                id: entry.id,
                stop: () => {
                    audioElement.pause();
                    audioElement.src = "";
                    URL.revokeObjectURL(audioUrl);
                },
            });
            return;
        } catch {
            URL.revokeObjectURL(audioUrl);
        }

        const ctx = new AudioContextClass();
        const master = ctx.createGain();
        master.gain.setValueAtTime(0.0001, ctx.currentTime);
        master.gain.exponentialRampToValueAtTime(0.32, ctx.currentTime + 0.8);
        master.connect(ctx.destination);

        const filter = ctx.createBiquadFilter();
        filter.type = "lowpass";
        filter.frequency.value = entry.tone === "focus" ? 1500 : 900;
        filter.Q.value = 0.8;
        filter.connect(master);

        const frequencies = entry.tone === "sleep"
            ? [146.83, 220, 293.66]
            : entry.tone === "focus"
                ? [196, 293.66, 392]
            : entry.tone === "nature"
                    ? [174.61, 261.63, 349.23]
                    : [164.81, 246.94, 329.63];

        const oscillators = frequencies.map((frequency, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = index === 0 ? "sine" : "triangle";
            osc.frequency.value = frequency;
            gain.gain.value = index === 0 ? 0.2 : 0.075;
            osc.connect(gain);
            gain.connect(filter);
            osc.start();
            return osc;
        });

        const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const noiseData = noiseBuffer.getChannelData(0);
        for (let i = 0; i < noiseData.length; i += 1) {
            noiseData[i] = (Math.random() * 2 - 1) * 0.28;
        }
        const noiseSource = ctx.createBufferSource();
        const noiseGain = ctx.createGain();
        const noiseFilter = ctx.createBiquadFilter();
        noiseSource.buffer = noiseBuffer;
        noiseSource.loop = true;
        noiseGain.gain.value = entry.tone === "nature" || entry.tone === "sleep" ? 0.12 : 0.045;
        noiseFilter.type = "lowpass";
        noiseFilter.frequency.value = entry.tone === "sleep" ? 650 : 1100;
        noiseSource.connect(noiseFilter);
        noiseFilter.connect(noiseGain);
        noiseGain.connect(master);
        noiseSource.start();

        try {
            if (ctx.state === "suspended") {
                await ctx.resume();
            }
            if (ctx.state !== "running") {
                setAudioPlaybackError("浏览器暂时拦截了音频播放，请点一下播放按钮重试。");
            }
        } catch {
            setAudioPlaybackError("音频启动失败，请点一下播放按钮重试。");
        }

        let stopped = false;
        const stop = () => {
            if (stopped) return;
            stopped = true;
            try {
                if (ctx.state !== "closed") {
                    master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
                }
                window.setTimeout(() => {
                    oscillators.forEach((osc) => {
                        try {
                            osc.stop();
                        } catch {}
                    });
                    try {
                        noiseSource.stop();
                    } catch {}
                    if (ctx.state !== "closed") {
                        ctx.close().catch(() => {});
                    }
                }, 280);
            } catch {
                if (ctx.state !== "closed") {
                    ctx.close().catch(() => {});
                }
            }
        };

        setAudioSession({ id: entry.id, stop });
    };

    const enterAudioImmersion = (entry: HealingAudioEntry) => {
        setSelectedAudio(entry);
        void startAudio(entry);
    };

    const leaveAudioImmersion = () => {
        stopAudio();
        setSelectedAudio(null);
    };

    if (selectedAudio) {
        const isPlaying = audioSession?.id === selectedAudio.id;
        const selectedAudioImage = resolveMusicCover(selectedAudio.title, selectedAudio.image);

        return (
            <section className="relative min-h-[calc(100vh-220px)] overflow-hidden rounded-xl border border-white/40 bg-slate-950 text-white shadow-2xl shadow-slate-900/20">
                <img src={selectedAudioImage} alt={selectedAudio.title} className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-br from-slate-950/88 via-slate-950/50 to-slate-950/72" />
                <div className="relative flex min-h-[calc(100vh-220px)] flex-col justify-between p-5 md:p-8">
                    <div className="flex items-center justify-between gap-3">
                        <button
                            type="button"
                            onClick={leaveAudioImmersion}
                            className="inline-flex items-center gap-2 rounded-xl border border-white/35 bg-white/14 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-white/24"
                        >
                            <ArrowLeftIcon className="h-4 w-4" />
                            返回音频列表
                        </button>
                        <span className="rounded-full border border-white/25 bg-white/14 px-3 py-1 text-xs font-semibold text-white/95 backdrop-blur-md">
                            沉浸疗愈模式
                        </span>
                    </div>

                    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center py-10 text-center">
                        <div className="mb-8 flex h-44 w-44 items-center justify-center rounded-full border border-white/25 bg-white/12 shadow-2xl shadow-black/25 backdrop-blur-xl">
                            <div className={`flex items-center justify-center rounded-full bg-white text-slate-950 shadow-xl transition-all duration-700 ${isPlaying ? "h-28 w-28 scale-110" : "h-24 w-24"}`}>
                                <MusicalNoteIcon className="h-12 w-12" />
                            </div>
                        </div>
                        <div className="rounded-full border border-white/25 bg-white/12 px-4 py-1 text-sm font-semibold text-white/95 backdrop-blur-md">{selectedAudio.duration}</div>
                        <h2 className="mt-5 text-4xl font-bold leading-tight md:text-6xl">{selectedAudio.title}</h2>
                        <p className="mt-4 max-w-2xl text-base leading-7 text-white/95 md:text-lg">{selectedAudio.subtitle}</p>
                        <button
                            type="button"
                            onClick={() => isPlaying ? stopAudio() : void startAudio(selectedAudio)}
                            className="mt-8 inline-flex h-16 min-w-44 items-center justify-center gap-3 rounded-full bg-white px-7 text-base font-bold text-slate-950 shadow-xl transition hover:scale-105"
                        >
                            {isPlaying ? <PauseIcon className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
                            {isPlaying ? "暂停" : "播放"}
                        </button>
                        {audioPlaybackError && (
                            <div className="mt-4 rounded-full border border-amber-200/70 bg-amber-100/90 px-4 py-2 text-sm font-semibold text-amber-900">
                                {audioPlaybackError}
                            </div>
                        )}
                    </div>

                    <div className="grid gap-3 text-sm text-white/95 md:grid-cols-3">
                        <div className="rounded-xl border border-white/18 bg-white/10 px-4 py-3 backdrop-blur-md">建议佩戴耳机或保持安静环境</div>
                        <div className="rounded-xl border border-white/18 bg-white/10 px-4 py-3 backdrop-blur-md">播放时可以闭眼跟随呼吸</div>
                        <div className="rounded-xl border border-white/18 bg-white/10 px-4 py-3 backdrop-blur-md">不舒服时随时暂停或返回</div>
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1 text-white md:flex-row md:items-end md:justify-between">
                <div>
                    <h2 className="text-2xl font-bold">音频疗愈</h2>
                    <p className="mt-1 text-sm text-white/95">分成流行乐、白噪音疗愈和纯音乐三类，每类都做了不同风格，不会像同一条歌单反复播放。</p>
                </div>
                {audioSession && (
                    <button
                        type="button"
                        onClick={stopAudio}
                        className="inline-flex items-center gap-2 rounded-xl border border-white/35 bg-slate-950/25 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-slate-950/35"
                    >
                        <PauseIcon className="h-4 w-4" />
                        停止播放
                    </button>
                )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {audioCategories.map((category) => {
                    const isActive = activeAudioCategory === category.id;
                    const count = category.id === "instrumental"
                        ? globalHitInstrumentals.length
                        : category.id === "pop"
                            ? chinesePopEntries.length
                            : healingAudioEntries.filter((entry) => entry.category === category.id).length;

                    return (
                        <button
                            key={category.id}
                            type="button"
                            onClick={() => {
                                stopAudio();
                                setActiveAudioCategory(category.id);
                            }}
                            className={`rounded-xl border px-4 py-3 text-left backdrop-blur-xl transition focus:outline-none focus:ring-2 focus:ring-white/80 ${
                                isActive
                                    ? "border-white/80 bg-white/88 text-slate-950"
                                    : "border-white/35 bg-white/16 text-white hover:bg-white/24"
                            }`}
                        >
                            <div className="flex items-center justify-between gap-3">
                                <span className="font-bold">{category.title}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${isActive ? "bg-slate-950 text-white" : "bg-white/18 text-white"}`}>{count}</span>
                            </div>
                            <div className={`mt-1 text-xs leading-5 ${isActive ? "text-slate-800" : "text-white/95"}`}>{category.subtitle}</div>
                        </button>
                    );
                })}
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {visibleAudioEntries.map((entry) => {
                    const entryImage = resolveMusicCover(entry.title, entry.image);
                    return (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => enterAudioImmersion(entry)}
                            className="group relative min-h-[210px] overflow-hidden rounded-xl border border-white/40 bg-slate-900/25 text-left shadow-xl shadow-slate-900/15 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/70 focus:outline-none focus:ring-2 focus:ring-white/85"
                        >
                            <img src={entryImage} alt={entry.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/82 via-slate-950/24 to-transparent" />
                            <div className="relative flex h-full min-h-[210px] flex-col justify-end p-5 text-white">
                                <div className="mb-4 flex items-center justify-between">
                                    <span className="rounded-full bg-white/18 px-3 py-1 text-xs font-semibold backdrop-blur-md">{entry.duration}</span>
                                    <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-950 shadow-lg">
                                        <PlayIcon className="h-5 w-5" />
                                    </span>
                                </div>
                                <h3 className="text-xl font-bold leading-6">{entry.title}</h3>
                                <p className="mt-2 text-sm leading-5 text-white/95">{entry.subtitle}</p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </section>
    );
}

function AssessmentPanel() {
    const [answers, setAnswers] = useState<AssessmentAnswer[]>([]);
    const currentQuestion = dynamicAssessmentQuestion;
    const isComplete = answers.length >= ASSESSMENT_DEPTH;

    const scores = useMemo(() => {
        return answers.reduce<Record<string, number>>((acc, answer) => {
            Object.entries(answer.scores).forEach(([key, value]) => {
                acc[key] = (acc[key] ?? 0) + value;
            });
            return acc;
        }, {});
    }, [answers]);

    const topTypes = useMemo(() => {
        return Object.entries(scores)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 4)
            .map(([key, value]) => ({ key, value, ...assessmentTypeLabels[key] }));
    }, [scores]);

    const pathIndex = useMemo(() => getAssessmentPathIndex(answers), [answers]);
    const pathCode = useMemo(() => getAssessmentPathCode(answers), [answers]);
    const questionTitle = useMemo(() => getDynamicAssessmentTitle(answers), [answers]);
    const questionImage = useMemo(() => getDynamicAssessmentImage(answers), [answers]);

    const resetAssessment = () => setAnswers([]);

    return (
        <section className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
            <div className="rounded-xl border border-white/40 bg-white/86 p-5 text-slate-950 shadow-xl shadow-slate-900/12 backdrop-blur-xl">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <h2 className="text-2xl font-bold">心理评测</h2>
                        <p className="mt-2 text-sm leading-6 text-slate-800">十题二选一，每一题会根据前面的选择进入不同场景。结果不是诊断，而是用可叠加标签描述你的性格和支持需求。</p>
                    </div>
                    <button
                        type="button"
                        onClick={resetAssessment}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                        title="重新评测"
                    >
                        <ArrowPathIcon className="h-5 w-5" />
                    </button>
                </div>

                <div className="mt-5 h-2 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${(answers.length / ASSESSMENT_DEPTH) * 100}%` }} />
                </div>

                {!isComplete && currentQuestion && (
                    <div className="mt-6">
                        <div className="text-sm font-semibold text-emerald-700">
                            第 {answers.length + 1} / {ASSESSMENT_DEPTH} 题 · {questionTitle}
                            {pathCode && <span className="ml-2 text-slate-700">路径 {pathCode}</span>}
                        </div>
                        <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                            <img
                                src={questionImage}
                                alt={questionTitle}
                                className="h-44 w-full object-cover sm:h-56"
                            />
                        </div>
                        <h3 className="mt-3 text-2xl font-bold leading-8">{currentQuestion.getPrompt(answers)}</h3>
                        <div className="mt-5 grid gap-3">
                            {currentQuestion.getAnswers(answers).map((answer) => (
                                <button
                                    key={answer.label}
                                    type="button"
                                    onClick={() => setAnswers((prev) => [...prev, answer])}
                                    className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-emerald-400 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                >
                                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-950 text-sm font-bold text-white">{answer.label}</span>
                                    <span>
                                        <span className="block text-base font-semibold text-slate-950">{answer.text}</span>
                                        <span className="mt-1 block text-xs text-slate-700">{answer.nextHint}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {isComplete && (
                    <div className="mt-6">
                        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                            <CheckCircleIcon className="h-4 w-4" />
                            已完成画像
                        </div>
                        <h3 className="mt-4 text-2xl font-bold">你的叠加类型</h3>
                        <p className="mt-2 text-sm leading-6 text-slate-800">这是第 {pathIndex + 1} 条路径。前 9 题一共可分出 512 条不同分支，第 10 题在当前分支上继续收束为画像。</p>
                        <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {topTypes.map((type) => (
                                <div key={type.key} className="rounded-xl border border-slate-200 bg-white p-4">
                                    <div className="flex items-center justify-between gap-3">
                                        <div className="text-lg font-bold">{type.title}</div>
                                        <div className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-800">{type.value} 分</div>
                                    </div>
                                    <p className="mt-2 text-sm leading-5 text-slate-800">{type.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <div className="rounded-xl border border-white/35 bg-slate-950/28 p-5 text-white shadow-xl shadow-slate-900/12 backdrop-blur-xl">
                <h3 className="text-xl font-bold">设计思路</h3>
                <p className="mt-3 text-sm leading-6 text-white/95">相比直接复刻 MBTI，这里把结果拆成可叠加的心理风格标签，更适合数字人后续做个性化陪伴：既能描述能量来源，也能描述压力、边界、共情和行动方式。</p>
                <div className="mt-5 grid gap-3">
                    {Object.values(assessmentTypeLabels).slice(0, 6).map((type) => (
                        <div key={type.title} className="rounded-xl border border-white/18 bg-white/10 px-4 py-3">
                            <div className="font-semibold">{type.title}</div>
                            <div className="mt-1 text-xs leading-5 text-white/95">{type.description}</div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}

const cloneGrid = (grid: number[][]) => grid.map((row) => [...row]);

const add2048Tile = (grid: number[][]) => {
    const next = cloneGrid(grid);
    const empty: Array<[number, number]> = [];
    next.forEach((row, rowIndex) => {
        row.forEach((value, colIndex) => {
            if (value === 0) empty.push([rowIndex, colIndex]);
        });
    });

    if (empty.length === 0) return next;
    const [row, col] = empty[Math.floor(Math.random() * empty.length)];
    next[row][col] = Math.random() > 0.85 ? 4 : 2;
    return next;
};

const create2048Board = () => add2048Tile(add2048Tile(Array.from({ length: 4 }, () => [0, 0, 0, 0])));

const merge2048Row = (row: number[]) => {
    const values = row.filter(Boolean);
    const merged: number[] = [];
    let gained = 0;

    for (let index = 0; index < values.length; index += 1) {
        if (values[index] === values[index + 1]) {
            const value = values[index] * 2;
            merged.push(value);
            gained += value;
            index += 1;
        } else {
            merged.push(values[index]);
        }
    }

    while (merged.length < 4) merged.push(0);
    return { row: merged, gained };
};

const move2048Board = (grid: number[][], direction: "up" | "down" | "left" | "right") => {
    let gained = 0;
    let next = cloneGrid(grid);

    const readColumn = (col: number) => [next[0][col], next[1][col], next[2][col], next[3][col]];
    const writeColumn = (col: number, values: number[]) => {
        values.forEach((value, row) => {
            next[row][col] = value;
        });
    };

    if (direction === "left" || direction === "right") {
        next = next.map((row) => {
            const source = direction === "right" ? [...row].reverse() : row;
            const result = merge2048Row(source);
            gained += result.gained;
            return direction === "right" ? result.row.reverse() : result.row;
        });
    } else {
        for (let col = 0; col < 4; col += 1) {
            const source = direction === "down" ? readColumn(col).reverse() : readColumn(col);
            const result = merge2048Row(source);
            gained += result.gained;
            writeColumn(col, direction === "down" ? result.row.reverse() : result.row);
        }
    }

    const moved = JSON.stringify(grid) !== JSON.stringify(next);
    return { board: moved ? add2048Tile(next) : next, moved, gained };
};

function Mini2048Game() {
    const [board, setBoard] = useState(() => create2048Board());
    const [score, setScore] = useState(0);
    const maxTile = Math.max(...board.flat());
    const celebratedTileRef = useRef(0);
    const tileClass: Record<number, string> = {
        0: "bg-slate-100 text-slate-300",
        2: "bg-emerald-50 text-slate-800",
        4: "bg-teal-100 text-slate-800",
        8: "bg-cyan-200 text-slate-900",
        16: "bg-sky-300 text-slate-950",
        32: "bg-indigo-300 text-white",
        64: "bg-violet-400 text-white",
        128: "bg-fuchsia-400 text-white",
        256: "bg-rose-400 text-white",
        512: "bg-orange-400 text-white",
        1024: "bg-amber-400 text-slate-950",
        2048: "bg-yellow-300 text-slate-950",
    };

    const move = (direction: "up" | "down" | "left" | "right") => {
        const result = move2048Board(board, direction);
        setBoard(result.board);
        if (result.moved) setScore((prev) => prev + result.gained);
        const nextMaxTile = Math.max(...result.board.flat());
        if (nextMaxTile >= 128 && nextMaxTile > celebratedTileRef.current) {
            celebratedTileRef.current = nextMaxTile;
            playCelebrationSound("bright");
        }
    };

    const reset = () => {
        setBoard(create2048Board());
        setScore(0);
        celebratedTileRef.current = 0;
    };

    return (
        <div>
            <div className="flex items-center justify-between gap-3">
                <h3 className="text-xl font-bold">2048</h3>
                <div className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold">分数 {score}</div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 rounded-xl bg-slate-200 p-2">
                {board.flat().map((value, index) => (
                    <div key={`${index}-${value}`} className={`flex aspect-square items-center justify-center rounded-lg text-xl font-bold ${tileClass[value] ?? "bg-slate-950 text-white"}`}>
                        {value || ""}
                    </div>
                ))}
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2">
                <div />
                <button type="button" onClick={() => move("up")} className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">上</button>
                <div />
                <button type="button" onClick={() => move("left")} className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">左</button>
                <div className="rounded-xl bg-slate-100" aria-hidden="true" />
                <button type="button" onClick={() => move("right")} className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">右</button>
                <div />
                <button type="button" onClick={() => move("down")} className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">下</button>
                <div />
            </div>
            <div className="mt-4 flex justify-end">
                <button
                    type="button"
                    onClick={reset}
                    className="rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-white hover:text-slate-950"
                >
                    重开本局
                </button>
            </div>
            {maxTile >= 128 && (
                <GamePraiseCard
                    title="恭喜，局面打开了！"
                    message={`你已经合成到 ${maxTile}。`}
                    detail="这不是随便点出来的，你刚刚在规划空间、控制节奏、给下一步留余地。继续保持这个节奏，很稳。"
                />
            )}
        </div>
    );
}

function GamePraiseCard({ title, message, detail }: { title: string; message: string; detail: string }) {
    return (
        <div className="mt-4 rounded-xl border border-emerald-300 bg-gradient-to-br from-emerald-50 to-amber-50 p-4 text-emerald-950 shadow-sm">
            <div className="text-2xl font-black">{title}</div>
            <div className="mt-1 text-base font-bold">{message}</div>
            <div className="mt-2 text-sm leading-6 text-emerald-900/82">{detail}</div>
        </div>
    );
}

function MemoryGame() {
    const symbols = ["月", "星", "花", "云", "山", "海"];
    const [cards, setCards] = useState(() => [...symbols, ...symbols].sort(() => Math.random() - 0.5));
    const [opened, setOpened] = useState<number[]>([]);
    const [matched, setMatched] = useState<number[]>([]);
    const celebratedRef = useRef(false);

    const flip = (index: number) => {
        if (opened.includes(index) || matched.includes(index) || opened.length >= 2) return;
        const nextOpened = [...opened, index];
        setOpened(nextOpened);
        if (nextOpened.length === 2) {
            const [first, second] = nextOpened;
            if (cards[first] === cards[second]) {
                window.setTimeout(() => {
                    setMatched((prev) => {
                        const next = [...prev, first, second];
                        if (next.length === cards.length && !celebratedRef.current) {
                            celebratedRef.current = true;
                            playCelebrationSound("bright");
                        }
                        return next;
                    });
                    setOpened([]);
                }, 260);
            } else {
                window.setTimeout(() => setOpened([]), 650);
            }
        }
    };

    const reset = () => {
        setCards([...symbols, ...symbols].sort(() => Math.random() - 0.5));
        setOpened([]);
        setMatched([]);
        celebratedRef.current = false;
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">记忆翻牌</h3>
                <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
                {cards.map((card, index) => {
                    const visible = opened.includes(index) || matched.includes(index);
                    return (
                        <button
                            key={`${card}-${index}`}
                            type="button"
                            onClick={() => flip(index)}
                            className={`flex aspect-square items-center justify-center rounded-xl text-2xl font-bold transition ${visible ? "bg-emerald-100 text-emerald-800" : "bg-slate-950 text-white"}`}
                        >
                            {visible ? card : "?"}
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 text-sm text-slate-800">已配对 {matched.length / 2} / {symbols.length}</div>
            {matched.length === cards.length && (
                <GamePraiseCard
                    title="太棒了，全部配对完成！"
                    message="你的记忆和观察力刚刚都在线。"
                    detail="你不是只靠运气翻完的，而是在记住位置、比较线索、一步步确认。这个过程很漂亮。"
                />
            )}
        </div>
    );
}

function TowerGame() {
    const [level, setLevel] = useState(1);
    const diskCount = level + 2;
    const minimumMoves = Math.pow(2, diskCount) - 1;
    const initial = Array.from({ length: diskCount }, (_, index) => diskCount - index);
    const [pegs, setPegs] = useState<number[][]>([initial, [], []]);
    const [selectedPeg, setSelectedPeg] = useState<number | null>(null);
    const [moves, setMoves] = useState(0);
    const solved = pegs[2].length === diskCount;
    const perfectSolved = solved && moves === minimumMoves;
    const celebratedRef = useRef(false);
    const diskColors = [
        "from-rose-500 via-pink-400 to-rose-600",
        "from-orange-400 via-amber-300 to-orange-500",
        "from-yellow-300 via-lime-300 to-emerald-400",
        "from-cyan-400 via-sky-400 to-blue-500",
        "from-indigo-500 via-violet-500 to-purple-600",
        "from-fuchsia-500 via-pink-500 to-rose-500",
        "from-emerald-500 via-teal-400 to-cyan-500",
        "from-slate-700 via-slate-500 to-slate-800",
    ];

    const getDiskWidth = (disk: number) => {
        if (diskCount <= 1) return 72;
        return 38 + ((disk - 1) / (diskCount - 1)) * 56;
    };

    useEffect(() => {
        if (solved && !celebratedRef.current) {
            celebratedRef.current = true;
            playCelebrationSound("bright");
        }
    }, [solved]);

    useEffect(() => {
        setPegs([initial, [], []]);
        setSelectedPeg(null);
        setMoves(0);
        celebratedRef.current = false;
    }, [diskCount]);

    const choosePeg = (index: number) => {
        if (selectedPeg === null) {
            if (pegs[index].length > 0) setSelectedPeg(index);
            return;
        }

        if (selectedPeg === index) {
            setSelectedPeg(null);
            return;
        }

        const moving = pegs[selectedPeg][pegs[selectedPeg].length - 1];
        const targetTop = pegs[index][pegs[index].length - 1];
        if (!targetTop || moving < targetTop) {
            const next = pegs.map((peg) => [...peg]);
            next[selectedPeg].pop();
            next[index].push(moving);
            setPegs(next);
            setMoves((prev) => prev + 1);
        }
        setSelectedPeg(null);
    };

    const reset = () => {
        setPegs([initial, [], []]);
        setSelectedPeg(null);
        setMoves(0);
        celebratedRef.current = false;
    };

    const nextLevel = () => {
        setLevel((prev) => prev + 1);
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold">汉诺塔</h3>
                    <p className="mt-1 text-sm text-slate-700">第 {level} 关 · {diskCount} 层 · 最少 {minimumMoves} 步</p>
                </div>
                <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3">
                {pegs.map((peg, pegIndex) => (
                    <button
                        key={pegIndex}
                        type="button"
                        onClick={() => choosePeg(pegIndex)}
                        className={`relative flex flex-col-reverse items-center justify-start gap-1.5 overflow-hidden rounded-2xl border px-2 pb-8 pt-5 shadow-inner transition ${
                            selectedPeg === pegIndex
                                ? "border-emerald-500 bg-emerald-50 ring-2 ring-emerald-200"
                                : "border-slate-200 bg-gradient-to-b from-slate-50 to-slate-100 hover:border-slate-300"
                        }`}
                        style={{ minHeight: `${Math.max(232, diskCount * 36 + 76)}px` }}
                    >
                        <span className="pointer-events-none absolute bottom-5 left-4 right-4 h-3 rounded-full bg-slate-300 shadow-inner" />
                        <span className="pointer-events-none absolute bottom-8 top-12 w-3 rounded-full bg-gradient-to-b from-slate-300 to-slate-500 shadow-sm" />
                        {[...peg].map((disk) => (
                            <div
                                key={disk}
                                className={`relative z-10 flex h-8 items-center justify-center rounded-full bg-gradient-to-r ${diskColors[(disk - 1) % diskColors.length]} text-sm font-black text-white shadow-[inset_0_2px_4px_rgba(255,255,255,0.45),inset_0_-3px_5px_rgba(15,23,42,0.28),0_4px_10px_rgba(15,23,42,0.18)] ring-1 ring-white/55 transition-all`}
                                style={{ width: `${getDiskWidth(disk)}%` }}
                            >
                                <span className="rounded-full bg-slate-950/72 px-2 py-0.5 leading-none shadow-sm">
                                    {disk}
                                </span>
                            </div>
                        ))}
                        <span className="absolute bottom-1.5 left-0 right-0 text-center text-xs font-bold text-slate-700">柱 {pegIndex + 1}</span>
                    </button>
                ))}
            </div>
            <div className="mt-3 text-sm text-slate-800">步数 {moves}，圆盘编号越大表示越大，目标是把全部 {diskCount} 层圆盘移动到右侧，理论最少 {minimumMoves} 步。</div>
            {solved && (
                <div className="mt-4 space-y-3">
                    <GamePraiseCard
                        title={perfectSolved ? `完美完成，第 ${level} 关通过！` : `第 ${level} 关已完成`}
                        message={`你用了 ${moves} 步完成 ${diskCount} 层汉诺塔，理论最少是 ${minimumMoves} 步。`}
                        detail={perfectSolved
                            ? "你走出了这一关的最优解，规划、等待和执行都刚刚好。可以进入下一关了。"
                            : "这一关已经完成了，但想进入下一关需要刚好用理论最少步数完成。再来一次，把路线压到最优。"}
                    />
                    {perfectSolved ? (
                        <button
                            type="button"
                            onClick={nextLevel}
                            className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-emerald-600"
                        >
                            进入第 {level + 1} 关（{diskCount + 1} 层）
                        </button>
                    ) : (
                        <button
                            type="button"
                            onClick={reset}
                            className="w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800 shadow-sm hover:bg-amber-100"
                        >
                            重新挑战第 {level} 关，目标 {minimumMoves} 步
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

function MiniSudokuGame() {
    const puzzle = [
        [1, 0, 0, 4],
        [0, 4, 1, 0],
        [2, 0, 0, 3],
        [0, 3, 2, 0],
    ];
    const solution = [
        [1, 2, 3, 4],
        [3, 4, 1, 2],
        [2, 1, 4, 3],
        [4, 3, 2, 1],
    ];
    const [grid, setGrid] = useState(() => cloneGrid(puzzle));
    const [selectedCell, setSelectedCell] = useState<[number, number] | null>(null);
    const solved = JSON.stringify(grid) === JSON.stringify(solution);
    const celebratedRef = useRef(false);

    useEffect(() => {
        if (solved && !celebratedRef.current) {
            celebratedRef.current = true;
            playCelebrationSound("bright");
        }
    }, [solved]);

    const fill = (value: number) => {
        if (!selectedCell) return;
        const [row, col] = selectedCell;
        if (puzzle[row][col]) return;
        const next = cloneGrid(grid);
        next[row][col] = value;
        setGrid(next);
    };

    const reset = () => {
        setGrid(cloneGrid(puzzle));
        setSelectedCell(null);
        celebratedRef.current = false;
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">4x4 数独</h3>
                <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-1 rounded-xl bg-slate-300 p-1">
                {grid.map((row, rowIndex) => row.map((value, colIndex) => {
                    const fixed = puzzle[rowIndex][colIndex] !== 0;
                    const selected = selectedCell?.[0] === rowIndex && selectedCell?.[1] === colIndex;
                    return (
                        <button
                            key={`${rowIndex}-${colIndex}`}
                            type="button"
                            onClick={() => setSelectedCell([rowIndex, colIndex])}
                            className={`flex aspect-square items-center justify-center rounded-lg text-2xl font-bold ${fixed ? "bg-slate-950 text-white" : selected ? "bg-emerald-100 text-emerald-800" : "bg-white text-slate-950"}`}
                        >
                            {value || ""}
                        </button>
                    );
                }))}
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">
                {[1, 2, 3, 4].map((value) => (
                    <button key={value} type="button" onClick={() => fill(value)} className="rounded-xl bg-slate-950 px-4 py-3 font-bold text-white">{value}</button>
                ))}
            </div>
            <div className="mt-3 text-sm text-slate-800">{solved ? "完成了。" : "选择空格后点击数字填入。"}</div>
            {solved && (
                <GamePraiseCard
                    title="恭喜，数独完成！"
                    message="你把每个空格都放回了它该在的位置。"
                    detail="数独不需要急，它需要清晰、排除和确认。你刚刚做到了，很适合给自己一个小小的肯定。"
                />
            )}
        </div>
    );
}

function ColorLinkGame() {
    const colors = [
        { id: "emerald", label: "绿", className: "bg-emerald-500" },
        { id: "sky", label: "蓝", className: "bg-sky-500" },
        { id: "rose", label: "红", className: "bg-rose-500" },
    ];
    const nodes = [
        { id: "emerald-a", color: "emerald" },
        { id: "sky-a", color: "sky" },
        { id: "rose-a", color: "rose" },
        { id: "sky-b", color: "sky" },
        { id: "emerald-b", color: "emerald" },
        { id: "rose-b", color: "rose" },
    ];
    const [selectedColor, setSelectedColor] = useState<string | null>(null);
    const [completed, setCompleted] = useState<string[]>([]);
    const celebratedRef = useRef(false);

    useEffect(() => {
        if (completed.length === colors.length && !celebratedRef.current) {
            celebratedRef.current = true;
            playCelebrationSound("bright");
        }
    }, [completed.length, colors.length]);

    const clickNode = (color: string) => {
        if (completed.includes(color)) return;
        if (!selectedColor) {
            setSelectedColor(color);
            return;
        }
        if (selectedColor === color) {
            setCompleted((prev) => [...prev, color]);
        }
        setSelectedColor(null);
    };

    const reset = () => {
        setSelectedColor(null);
        setCompleted([]);
        celebratedRef.current = false;
    };

    return (
        <div>
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">颜色连线</h3>
                <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-slate-100 p-4">
                {nodes.map((node) => {
                    const color = colors.find((item) => item.id === node.color)!;
                    const done = completed.includes(node.color);
                    const active = selectedColor === node.color;
                    return (
                        <button
                            key={node.id}
                            type="button"
                            onClick={() => clickNode(node.color)}
                            className={`flex aspect-square items-center justify-center rounded-xl border-4 text-sm font-bold text-white ${color.className} ${active ? "border-slate-950" : done ? "border-emerald-200 opacity-55" : "border-white"}`}
                        >
                            {done ? "完成" : color.label}
                        </button>
                    );
                })}
            </div>
            <div className="mt-3 text-sm text-slate-800">点击两个同色节点完成配对：{completed.length} / {colors.length}</div>
            {completed.length === colors.length && (
                <GamePraiseCard
                    title="漂亮，全部连上了！"
                    message="你很快抓住了颜色之间的关系。"
                    detail="这份清晰感很舒服。你刚刚稳定地观察、判断、完成配对，可以把这种轻松的确定感带走。"
                />
            )}
        </div>
    );
}

function createMineBoard(rows = 8, cols = 8, mines = 10): MineCell[][] {
    const board: MineCell[][] = Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => ({ mine: false, open: false, flagged: false, adjacent: 0 }))
    );
    const positions = Array.from({ length: rows * cols }, (_, index) => index);
    for (let i = positions.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [positions[i], positions[j]] = [positions[j], positions[i]];
    }
    positions.slice(0, mines).forEach((position) => {
        const row = Math.floor(position / cols);
        const col = position % cols;
        board[row][col].mine = true;
    });
    const dirs = [-1, 0, 1];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (board[r][c].mine) continue;
            let count = 0;
            for (const dr of dirs) {
                for (const dc of dirs) {
                    if (dr === 0 && dc === 0) continue;
                    const nr = r + dr;
                    const nc = c + dc;
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && board[nr][nc].mine) {
                        count += 1;
                    }
                }
            }
            board[r][c].adjacent = count;
        }
    }
    return board;
}

const cloneMineBoard = (board: MineCell[][]) => board.map((row) => row.map((cell) => ({ ...cell })));

const createMineBoardState = (rows = 8, cols = 8, mines = 10): MineBoardState => {
    const cells = createMineBoard(rows, cols, mines);
    return { cells, opened: 0, flagged: 0 };
};

const mineDifficultySpecs = [
    { level: 1, rows: 8, cols: 8 },
    { level: 2, rows: 10, cols: 10 },
    { level: 3, rows: 12, cols: 12 },
    { level: 4, rows: 16, cols: 16 },
    { level: 5, rows: 20, cols: 20 },
    { level: 6, rows: 30, cols: 30 },
    { level: 7, rows: 40, cols: 40 },
    { level: 8, rows: 60, cols: 60 },
    { level: 9, rows: 80, cols: 80 },
    { level: 10, rows: 100, cols: 100 },
] as const;

const mineDifficultyLevels = mineDifficultySpecs.map((item, index) => {
    const startDensity = 10 / (8 * 8);
    const endDensity = 2000 / (100 * 100);
    const t = index / (mineDifficultySpecs.length - 1);
    const density = startDensity * Math.pow(endDensity / startDensity, t);
    const mines = Math.max(1, Math.round(item.rows * item.cols * density));
    return {
        ...item,
        mines: index === 0 ? 10 : index === mineDifficultySpecs.length - 1 ? 2000 : mines,
    };
});

function MinesweeperGame() {
    const [difficultyIndex, setDifficultyIndex] = useState(0);
    const difficulty = mineDifficultyLevels[difficultyIndex];
    const rows = difficulty.rows;
    const cols = difficulty.cols;
    const mineCount = difficulty.mines;
    const [boardState, setBoardState] = useState<MineBoardState>(() => createMineBoardState(rows, cols, mineCount));
    const [lost, setLost] = useState(false);
    const [won, setWon] = useState(false);
    const [immersive, setImmersive] = useState(false);
    const immersiveRef = useRef<HTMLDivElement | null>(null);
    const boardViewportRef = useRef<HTMLDivElement | null>(null);
    const celebratedRef = useRef(false);
    const [viewport, setViewport] = useState({ scrollTop: 0, scrollLeft: 0, width: 0, height: 0 });

    const board = boardState.cells;
    const openedCount = boardState.opened;
    const flaggedCount = boardState.flagged;
    const cellSize = cols >= 80 ? 18 : cols >= 60 ? 20 : cols >= 40 ? 22 : cols >= 20 ? 26 : 34;
    const boardGap = 1;
    const rowStride = cellSize + boardGap;
    const columnStride = cellSize + boardGap;
    const totalBoardWidth = cols * cellSize + Math.max(0, cols - 1) * boardGap;
    const totalBoardHeight = rows * cellSize + Math.max(0, rows - 1) * boardGap;
    const viewportPadding = 4;
    const visibleRows = Math.min(rows, Math.ceil(Math.max(viewport.height, 1) / rowStride) + viewportPadding);
    const visibleCols = Math.min(cols, Math.ceil(Math.max(viewport.width, 1) / columnStride) + viewportPadding);
    const startRow = Math.max(0, Math.floor(viewport.scrollTop / rowStride) - 2);
    const startCol = Math.max(0, Math.floor(viewport.scrollLeft / columnStride) - 2);
    const endRow = Math.min(rows, startRow + visibleRows);
    const endCol = Math.min(cols, startCol + visibleCols);

    const resetBoard = (nextDifficulty = difficulty) => {
        setBoardState(createMineBoardState(nextDifficulty.rows, nextDifficulty.cols, nextDifficulty.mines));
        setLost(false);
        setWon(false);
        celebratedRef.current = false;
    };

    const selectDifficulty = (index: number) => {
        setDifficultyIndex(index);
        resetBoard(mineDifficultyLevels[index]);
    };

    useEffect(() => {
        if (won && !celebratedRef.current) {
            celebratedRef.current = true;
            playCelebrationSound("bright");
        }
    }, [won]);

    useEffect(() => {
        if (lost) {
            celebratedRef.current = false;
        }
    }, [lost]);

    const openCell = (row: number, col: number) => {
        if (lost || won) return;
        setBoardState((prev) => {
            const next = cloneMineBoard(prev.cells);
            const cell = next[row][col];
            if (cell.open || cell.flagged) return prev;
            if (cell.mine) {
                next.forEach((line) => line.forEach((item) => { if (item.mine) item.open = true; }));
                setLost(true);
                let opened = 0;
                next.forEach((line) => line.forEach((item) => { if (item.open) opened += 1; }));
                return { cells: next, opened, flagged: prev.flagged };
            }

            const queue: Array<[number, number]> = [[row, col]];
            const queued = new Set<string>([`${row}-${col}`]);
            let queueIndex = 0;
            let openedDelta = 0;
            while (queueIndex < queue.length) {
                const [r, c] = queue[queueIndex];
                queueIndex += 1;
                const current = next[r][c];
                if (current.open || current.flagged) continue;
                current.open = true;
                openedDelta += 1;
                if (current.adjacent !== 0) continue;
                for (let dr = -1; dr <= 1; dr++) {
                    for (let dc = -1; dc <= 1; dc++) {
                        if (dr === 0 && dc === 0) continue;
                        const nr = r + dr;
                        const nc = c + dc;
                        if (nr >= 0 && nr < rows && nc >= 0 && nc < cols) {
                            const neighbor = next[nr][nc];
                            const key = `${nr}-${nc}`;
                            if (!neighbor.open && !neighbor.flagged && !neighbor.mine && !queued.has(key)) {
                                queued.add(key);
                                queue.push([nr, nc]);
                            }
                        }
                    }
                }
            }
            const opened = prev.opened + openedDelta;
            if (opened === rows * cols - mineCount) {
                setWon(true);
            }
            return { cells: next, opened, flagged: prev.flagged };
        });
    };

    const toggleFlag = (row: number, col: number) => {
        if (lost || won) return;
        setBoardState((prev) => {
            const next = cloneMineBoard(prev.cells);
            const cell = next[row][col];
            if (cell.open) return prev;
            cell.flagged = !cell.flagged;
            const flagged = prev.flagged + (cell.flagged ? 1 : -1);
            return { cells: next, opened: prev.opened, flagged };
        });
    };

    const reset = () => {
        resetBoard();
    };

    useEffect(() => {
        const handleFullscreenChange = () => {
            setImmersive(Boolean(document.fullscreenElement));
        };
        document.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
    }, []);

    useEffect(() => {
        const updateViewport = () => {
            const node = boardViewportRef.current;
            if (!node) return;
            setViewport({
                scrollTop: node.scrollTop,
                scrollLeft: node.scrollLeft,
                width: node.clientWidth,
                height: node.clientHeight,
            });
        };
        updateViewport();
        const node = boardViewportRef.current;
        if (!node) return;
        node.addEventListener("scroll", updateViewport, { passive: true });
        window.addEventListener("resize", updateViewport);
        return () => {
            node.removeEventListener("scroll", updateViewport);
            window.removeEventListener("resize", updateViewport);
        };
    }, [rows, cols, cellSize, immersive]);

    useEffect(() => {
        if (!immersive || !immersiveRef.current || document.fullscreenElement) return;
        immersiveRef.current.requestFullscreen().catch(() => {});
    }, [immersive]);

    const enterImmersive = () => {
        setImmersive(true);
    };

    const exitImmersive = () => {
        if (document.fullscreenElement) {
            document.exitFullscreen().catch(() => {});
        }
        setImmersive(false);
    };

    const mineBoard = (isImmersive = false) => (
        <div
            ref={boardViewportRef}
            className={`${isImmersive ? "h-[calc(100vh-148px)]" : "max-h-[62vh]"} overflow-auto rounded-xl border border-slate-300 bg-slate-300 p-2`}
            onScroll={() => {
                const node = boardViewportRef.current;
                if (!node) return;
                setViewport({
                    scrollTop: node.scrollTop,
                    scrollLeft: node.scrollLeft,
                    width: node.clientWidth,
                    height: node.clientHeight,
                });
            }}
        >
            <div style={{ width: totalBoardWidth, height: totalBoardHeight, position: "relative" }}>
                <div
                    className="grid"
                    style={{
                        gridTemplateColumns: `repeat(${Math.max(0, endCol - startCol)}, ${cellSize}px)`,
                        gap: `${boardGap}px`,
                        position: "absolute",
                        left: startCol * columnStride,
                        top: startRow * rowStride,
                    }}
                >
                    {board.slice(startRow, endRow).map((row, rowIndex) =>
                        row.slice(startCol, endCol).map((cell, colIndex) => {
                            const realRow = startRow + rowIndex;
                            const realCol = startCol + colIndex;
                            return (
                                <button
                                    key={`${realRow}-${realCol}`}
                                    type="button"
                                    onClick={() => openCell(realRow, realCol)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        toggleFlag(realRow, realCol);
                                    }}
                                    className={`flex items-center justify-center rounded-[4px] font-bold transition ${
                                        cell.open
                                            ? cell.mine
                                                ? "bg-rose-500 text-white"
                                                : "bg-white text-slate-950"
                                            : cell.flagged
                                                ? "bg-rose-100 text-rose-600"
                                                : "bg-slate-200 text-slate-700 hover:bg-slate-100"
                                    }`}
                                    style={{
                                        width: cellSize,
                                        height: cellSize,
                                        fontSize: cellSize <= 20 ? 10 : cellSize <= 26 ? 12 : 14,
                                    }}
                                    title={`第 ${realRow + 1} 行，第 ${realCol + 1} 列`}
                                >
                                    {cell.open ? (cell.mine ? "×" : cell.adjacent || "") : cell.flagged ? <FlagIcon className="h-3.5 w-3.5" /> : ""}
                                </button>
                            );
                        }),
                    )}
                </div>
            </div>
        </div>
    );

    return (
        <div>
            <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-xl font-bold">扫雷</h3>
                        <p className="mt-1 text-sm text-slate-700">难度 {difficulty.level} · {rows}x{cols} · {mineCount} 颗雷</p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={enterImmersive}
                            className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-3 py-2 text-sm font-bold text-white"
                        >
                            <ArrowsPointingOutIcon className="h-4 w-4" />
                            沉浸模式
                        </button>
                        <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
                    </div>
                </div>
                <div className="grid grid-cols-5 gap-2">
                    {mineDifficultyLevels.map((item, index) => {
                        const active = difficultyIndex === index;
                        return (
                            <button
                                key={item.level}
                                type="button"
                                onClick={() => selectDifficulty(index)}
                                className={`rounded-xl border px-2 py-2 text-xs font-bold transition ${
                                    active
                                        ? "border-slate-950 bg-slate-950 text-white"
                                        : "border-slate-200 bg-white text-slate-800 hover:border-slate-400"
                                }`}
                                title={`${item.rows}x${item.cols}，${item.mines} 颗雷`}
                            >
                                {item.level}
                            </button>
                        );
                    })}
                </div>
            </div>
            <div className="mt-3 text-sm text-slate-800">左键翻开，右键或长按标旗。打开所有安全格即可过关，雷密度已调高，越往后越像正常扫雷。</div>
            <div className="mt-4">{mineBoard()}</div>
            <div className="mt-3 text-sm text-slate-800">已打开 {openedCount} 格，已标旗 {flaggedCount} / {mineCount}。</div>
            {immersive && (
                <div ref={immersiveRef} className="fixed inset-0 z-[120] flex flex-col bg-slate-950 p-3 text-white md:p-5">
                    <div className="mb-3 flex flex-col gap-3 rounded-2xl border border-white/15 bg-white/10 p-3 shadow-2xl backdrop-blur md:flex-row md:items-center md:justify-between">
                        <div>
                            <h3 className="text-lg font-bold">扫雷沉浸模式</h3>
                            <p className="mt-1 text-sm text-white/95">难度 {difficulty.level} · {rows}x{cols} · {mineCount} 颗雷 · 已打开 {openedCount} · 标旗 {flaggedCount}</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            {mineDifficultyLevels.map((item, index) => (
                                <button
                                    key={item.level}
                                    type="button"
                                    onClick={() => selectDifficulty(index)}
                                    className={`h-9 min-w-9 rounded-lg border px-2 text-xs font-bold ${
                                        difficultyIndex === index
                                            ? "border-white bg-white text-slate-950"
                                            : "border-white/25 bg-white/10 text-white hover:bg-white/18"
                                    }`}
                                    title={`${item.rows}x${item.cols}，${item.mines} 颗雷`}
                                >
                                    {item.level}
                                </button>
                            ))}
                            <button type="button" onClick={reset} className="rounded-lg border border-white/25 bg-white/10 px-3 py-2 text-sm font-bold text-white hover:bg-white/18">重开</button>
                            <button
                                type="button"
                                onClick={exitImmersive}
                                className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-slate-950"
                            >
                                <XMarkIcon className="h-4 w-4" />
                                退出
                            </button>
                        </div>
                    </div>
                    {mineBoard(true)}
                </div>
            )}
            {lost && (
                <GamePraiseCard
                    title="不小心踩雷了"
                    message="没关系，扫雷本来就是靠试探和判断慢慢逼近答案。"
                    detail="你已经在观察周围数字和风险分布了，再来一次会更稳。"
                />
            )}
            {won && (
                <GamePraiseCard
                    title="扫雷完成！"
                    message="你把安全区和风险区都分出来了。"
                    detail="这份判断很利落，保持这种稳稳推进的感觉。"
                />
            )}
        </div>
    );
}

const TETRIS_WIDTH = 10;
const TETRIS_HEIGHT = 18;
const TETRIS_PIECES = [
    { shape: [[1, 1, 1, 1]], color: "bg-cyan-500" },
    { shape: [[1, 1], [1, 1]], color: "bg-yellow-400" },
    { shape: [[0, 1, 0], [1, 1, 1]], color: "bg-purple-500" },
    { shape: [[1, 0, 0], [1, 1, 1]], color: "bg-orange-500" },
    { shape: [[0, 0, 1], [1, 1, 1]], color: "bg-blue-500" },
    { shape: [[0, 1, 1], [1, 1, 0]], color: "bg-emerald-500" },
    { shape: [[1, 1, 0], [0, 1, 1]], color: "bg-rose-500" },
];

function rotateMatrix(matrix: number[][]): number[][] {
    const rows = matrix.length;
    const cols = matrix[0].length;
    return Array.from({ length: cols }, (_, col) =>
        Array.from({ length: rows }, (_, row) => matrix[rows - 1 - row][col])
    );
}

function buildTetrisBoard(active: TetrisPiece | null, locked: string[][]): string[][] {
    const board = locked.map((row) => [...row]);
    if (!active) return board;
    active.shape.forEach((row, r) => {
        row.forEach((cell, c) => {
            if (!cell) return;
            const br = active.row + r;
            const bc = active.col + c;
            if (br >= 0 && br < TETRIS_HEIGHT && bc >= 0 && bc < TETRIS_WIDTH) {
                board[br][bc] = active.color;
            }
        });
    });
    return board;
}

function TetrisGame() {
    const [locked, setLocked] = useState<string[][]>(() =>
        Array.from({ length: TETRIS_HEIGHT }, () => Array.from({ length: TETRIS_WIDTH }, () => ""))
    );
    const [active, setActive] = useState<TetrisPiece | null>(null);
    const [score, setScore] = useState(0);
    const [gameOver, setGameOver] = useState(false);
    const [dropMs, setDropMs] = useState(600);
    const celebratedRef = useRef(false);

    const spawnPiece = () => {
        const pick = TETRIS_PIECES[Math.floor(Math.random() * TETRIS_PIECES.length)];
        const piece: TetrisPiece = {
            shape: pick.shape.map((row) => [...row]),
            row: 0,
            col: Math.floor((TETRIS_WIDTH - pick.shape[0].length) / 2),
            color: pick.color,
        };
        return piece;
    };

    const canMove = (piece: TetrisPiece, lockedBoard: string[][], rowOffset: number, colOffset: number, shape = piece.shape) => {
        for (let r = 0; r < shape.length; r++) {
            for (let c = 0; c < shape[r].length; c++) {
                if (!shape[r][c]) continue;
                const nr = piece.row + rowOffset + r;
                const nc = piece.col + colOffset + c;
                if (nc < 0 || nc >= TETRIS_WIDTH || nr >= TETRIS_HEIGHT) return false;
                if (nr >= 0 && lockedBoard[nr][nc]) return false;
            }
        }
        return true;
    };

    const mergePiece = (piece: TetrisPiece, lockedBoard: string[][]) => {
        piece.shape.forEach((row, r) => {
            row.forEach((cell, c) => {
                if (!cell) return;
                const nr = piece.row + r;
                const nc = piece.col + c;
                if (nr >= 0 && nr < TETRIS_HEIGHT && nc >= 0 && nc < TETRIS_WIDTH) {
                    lockedBoard[nr][nc] = piece.color;
                }
            });
        });
    };

    const clearLines = (lockedBoard: string[][]) => {
        const remaining = lockedBoard.filter((row) => row.some((cell) => !cell));
        const cleared = TETRIS_HEIGHT - remaining.length;
        while (remaining.length < TETRIS_HEIGHT) {
            remaining.unshift(Array.from({ length: TETRIS_WIDTH }, () => ""));
        }
        return { board: remaining, cleared };
    };

    const lockAndContinue = (piece: TetrisPiece) => {
        const nextLocked = locked.map((row) => [...row]);
        mergePiece(piece, nextLocked);
        const { board, cleared } = clearLines(nextLocked);
        setLocked(board);
        if (cleared > 0) {
            setScore((prev) => prev + cleared * 100);
            setDropMs((prev) => Math.max(180, prev - cleared * 25));
        }
        const nextPiece = spawnPiece();
        if (!canMove(nextPiece, board, 0, 0)) {
            setGameOver(true);
            return;
        }
        setActive(nextPiece);
    };

    useEffect(() => {
        if (gameOver || !active) return;
        const timer = window.setInterval(() => {
            setActive((current) => {
                if (!current || gameOver) return current;
                if (canMove(current, locked, 1, 0)) {
                    return { ...current, row: current.row + 1 };
                }
                lockAndContinue(current);
                return null;
            });
        }, dropMs);
        return () => window.clearInterval(timer);
    }, [active, dropMs, gameOver, locked]);

    useEffect(() => {
        if (!active && !gameOver) {
            setActive(spawnPiece());
        }
    }, [active, gameOver]);

    const move = (rowOffset: number, colOffset: number) => {
        if (!active || gameOver) return;
        if (canMove(active, locked, rowOffset, colOffset)) {
            setActive({ ...active, row: active.row + rowOffset, col: active.col + colOffset });
        } else if (rowOffset === 1 && colOffset === 0) {
            lockAndContinue(active);
            setActive(null);
        }
    };

    const rotate = () => {
        if (!active || gameOver) return;
        const rotated = rotateMatrix(active.shape);
        if (canMove(active, locked, 0, 0, rotated)) {
            setActive({ ...active, shape: rotated });
        }
    };

    const hardDrop = () => {
        if (!active || gameOver) return;
        let next = { ...active };
        while (canMove(next, locked, 1, 0)) {
            next = { ...next, row: next.row + 1 };
        }
        setActive(next);
        lockAndContinue(next);
        setActive(null);
    };

    const reset = () => {
        setLocked(Array.from({ length: TETRIS_HEIGHT }, () => Array.from({ length: TETRIS_WIDTH }, () => "")));
        setActive(spawnPiece());
        setScore(0);
        setGameOver(false);
        setDropMs(600);
        celebratedRef.current = false;
    };

    useEffect(() => {
        if (gameOver && !celebratedRef.current) {
            celebratedRef.current = true;
        }
    }, [gameOver]);

    const board = buildTetrisBoard(active, locked);
    const filledCount = locked.flat().filter(Boolean).length;

    return (
        <div>
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-bold">俄罗斯方块</h3>
                <button type="button" onClick={reset} className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold">重开</button>
            </div>
            <div className="mt-3 text-sm text-slate-800">得分 {score}，已堆积 {filledCount} 格。方向键/按钮移动，空格可硬降。</div>
            <div className="mt-4 flex gap-4">
                <div className="grid grid-cols-10 gap-px rounded-xl bg-slate-300 p-2">
                    {board.map((row, rowIndex) => row.map((cell, colIndex) => (
                        <div
                            key={`${rowIndex}-${colIndex}`}
                            className={`h-5 w-5 rounded-sm ${cell || "bg-slate-100"}`}
                        />
                    )))}
                </div>
                <div className="flex flex-col gap-2">
                    <button type="button" onClick={() => move(0, -1)} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold">左</button>
                    <button type="button" onClick={rotate} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold">旋转</button>
                    <button type="button" onClick={() => move(0, 1)} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold">右</button>
                    <button type="button" onClick={() => move(1, 0)} className="rounded-lg border bg-white px-3 py-2 text-sm font-bold">下落</button>
                    <button type="button" onClick={hardDrop} className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-bold text-white">硬降</button>
                </div>
            </div>
            {gameOver && (
                <GamePraiseCard
                    title="方块到底了"
                    message={`本局得分 ${score}。`}
                    detail="方块游戏就是这样，越往后越需要提前留空。重新来一局，你会更快找到节奏。"
                />
            )}
        </div>
    );
}

function PlayableGamePanel({ selectedGame }: { selectedGame: GameEntry }) {
    if (selectedGame.id === "2048") return <Mini2048Game />;
    if (selectedGame.id === "memory") return <MemoryGame />;
    if (selectedGame.id === "tower") return <TowerGame />;
    if (selectedGame.id === "sudoku") return <MiniSudokuGame />;
    if (selectedGame.id === "link") return <ColorLinkGame />;
    if (selectedGame.id === "mines") return <MinesweeperGame />;
    if (selectedGame.id === "tetris") return <TetrisGame />;

    return (
        <div>
            <h3 className="text-xl font-bold">{selectedGame.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-800">这个游戏正在接入完整玩法。</p>
        </div>
    );
}

function GamesPanel() {
    const [selectedGame, setSelectedGame] = useState<GameEntry | null>(null);
    const [breathStep, setBreathStep] = useState(0);
    const [breathSecondsLeft, setBreathSecondsLeft] = useState(breathGamePhases[0].seconds);
    const [breathRound, setBreathRound] = useState(1);
    const [isBreathRunning, setIsBreathRunning] = useState(false);
    const [isBreathComplete, setIsBreathComplete] = useState(false);
    const breathCelebratedRef = useRef(false);
    const currentBreathPhase = breathGamePhases[breathStep];
    const breathProgress = Math.max(0, Math.min(100, ((currentBreathPhase.seconds - breathSecondsLeft) / currentBreathPhase.seconds) * 100));
    const gameTips: Record<string, string[]> = {
        "2048": ["滑动方向合并相同数字", "尽量把最大数字固定在角落", "每一步都给下一步留空间"],
        sudoku: ["每行、每列、每宫数字不重复", "先找唯一候选格", "遇到卡点时回到已确定数字"],
        memory: ["翻开两张图案寻找配对", "记住位置比速度更重要", "连续配对会提升专注感"],
        breath: ["跟随吸气、停留、呼气、放松四步", "每轮结束后观察身体变化", "不舒服时立即停止"],
        link: ["连接同色节点", "路径不能交叉", "先处理边角和距离最短的颜色"],
        tower: ["一次只能移动一个圆盘", "大圆盘不能放在小圆盘上", "目标是用更少步数完成"],
        mines: ["先根据数字判断安全区", "怀疑的位置先插旗", "从边角和低风险区域开始更稳"],
        tetris: ["尽量给长条保留空间", "把凹槽留成可消除的整行", "旋转和下落都要提前预判"],
    };

    useEffect(() => {
        if (!isBreathRunning) return;

        const timer = window.setInterval(() => {
            setBreathSecondsLeft((prev) => {
                if (prev > 1) return prev - 1;

                if (breathStep === breathGamePhases.length - 1 && breathRound >= 3) {
                    setIsBreathRunning(false);
                    setIsBreathComplete(true);
                    if (!breathCelebratedRef.current) {
                        breathCelebratedRef.current = true;
                        playCelebrationSound("soft");
                    }
                    return 0;
                }

                const nextStep = (breathStep + 1) % breathGamePhases.length;
                if (nextStep === 0) {
                    setBreathRound((round) => round + 1);
                }
                setBreathStep(nextStep);
                return breathGamePhases[nextStep].seconds;
            });
        }, 1000);

        return () => window.clearInterval(timer);
    }, [breathRound, breathStep, isBreathRunning]);

    const resetBreathGame = (autoStart = false) => {
        setIsBreathRunning(autoStart);
        setBreathStep(0);
        setBreathSecondsLeft(breathGamePhases[0].seconds);
        setBreathRound(1);
        setIsBreathComplete(false);
        breathCelebratedRef.current = false;
    };

    const openGame = (entry: GameEntry) => {
        setSelectedGame(entry);
        if (entry.id === "breath") {
            resetBreathGame(true);
        }
    };

    if (selectedGame) {
        const tips = gameTips[selectedGame.id] ?? ["点击开始进入训练", "保持轻松节奏", "完成后可以返回选择其它游戏"];

        return (
            <section className="relative min-h-[calc(100vh-220px)] overflow-hidden rounded-xl border border-white/40 bg-slate-950 text-white shadow-2xl shadow-slate-900/20">
                <img src={selectedGame.image} alt={selectedGame.title} className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-br from-slate-950/90 via-slate-950/58 to-slate-950/76" />
                <div className="relative grid min-h-[calc(100vh-220px)] gap-6 p-5 md:p-8 xl:grid-cols-[minmax(0,1fr)_360px]">
                    <div className="flex flex-col">
                        <div className="flex items-center justify-between gap-3">
                            <button
                                type="button"
                                onClick={() => {
                                    setSelectedGame(null);
                                    setIsBreathRunning(false);
                                }}
                                className="inline-flex items-center gap-2 rounded-xl border border-white/35 bg-white/14 px-4 py-2 text-sm font-semibold text-white backdrop-blur-md hover:bg-white/24"
                            >
                                <ArrowLeftIcon className="h-4 w-4" />
                                返回游戏列表
                            </button>
                            <span className="rounded-full border border-white/25 bg-white/14 px-3 py-1 text-xs font-semibold text-white/95 backdrop-blur-md">
                                {selectedGame.tag}
                            </span>
                        </div>

                        <div className="flex flex-1 flex-col justify-center py-10">
                            <h2 className="text-4xl font-bold leading-tight md:text-6xl">{selectedGame.title}</h2>
                            <p className="mt-4 max-w-2xl text-base leading-7 text-white/95 md:text-lg">{selectedGame.subtitle}</p>
                            <div className="mt-8 grid max-w-2xl gap-3 md:grid-cols-3">
                                {tips.map((tip, index) => (
                                    <div key={tip} className="rounded-xl border border-white/18 bg-white/10 p-4 backdrop-blur-md">
                                        <div className="text-2xl font-bold text-white">0{index + 1}</div>
                                        <div className="mt-2 text-sm leading-5 text-white/95">{tip}</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/35 bg-white/90 p-5 text-slate-950 shadow-xl backdrop-blur-xl">
                        {selectedGame.id === "breath" ? (
                            <>
                                <h3 className="text-xl font-bold">呼吸挑战进行中</h3>
                                <p className="mt-2 text-sm leading-6 text-slate-800">进入后自动开始，完成 3 轮后自然结束。你只需要跟随圆形和倒计时呼吸。</p>
                                <div className="mt-6 flex flex-col items-center">
                                    <div className="relative flex h-56 w-56 items-center justify-center rounded-full border border-emerald-200 bg-emerald-100 shadow-inner">
                                        <div className={`flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-all duration-700 ${currentBreathPhase.sizeClass}`}>
                                            <span className="text-2xl font-bold">{isBreathComplete ? "结束" : currentBreathPhase.label}</span>
                                        </div>
                                        <div className="absolute bottom-5 rounded-full bg-white/80 px-3 py-1 text-sm font-bold text-emerald-700">{isBreathComplete ? "已完成" : `${breathSecondsLeft}s`}</div>
                                    </div>
                                    <div className="mt-5 w-full">
                                        <div className="flex items-center justify-between text-xs font-semibold text-slate-700">
                                            <span>第 {breathRound} / 3 轮</span>
                                            <span>{isBreathComplete ? "做得不错，可以休息一下。" : currentBreathPhase.helper}</span>
                                        </div>
                                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                                            <div className="h-full rounded-full bg-emerald-500 transition-all duration-300" style={{ width: `${isBreathComplete ? 100 : breathProgress}%` }} />
                                        </div>
                                    </div>
                                    <div className="mt-6 grid w-full grid-cols-2 gap-3">
                                        <button
                                            type="button"
                                            onClick={() => isBreathComplete ? resetBreathGame(true) : setIsBreathRunning((prev) => !prev)}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                                        >
                                            {isBreathRunning ? <PauseIcon className="h-4 w-4" /> : <PlayIcon className="h-4 w-4" />}
                                            {isBreathComplete ? "再来一局" : isBreathRunning ? "暂停" : "继续"}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => resetBreathGame(true)}
                                            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-50"
                                        >
                                            <ArrowPathIcon className="h-4 w-4" />
                                            重开
                                        </button>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedGame(null)}
                                        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-50 px-5 py-3 text-sm font-semibold text-emerald-700 hover:bg-emerald-100"
                                    >
                                        完成并返回
                                    </button>
                                    {isBreathComplete && (
                                        <GamePraiseCard
                                            title="完成了，辛苦啦"
                                            message="你刚刚认真陪自己呼吸了三轮。"
                                            detail="这不是比赛，所以不需要多快多强。你愿意停下来照顾自己的节奏，这件事本身就很值得被肯定。"
                                        />
                                    )}
                                </div>
                            </>
                        ) : (
                            <PlayableGamePanel selectedGame={selectedGame} />
                        )}
                    </div>
                </div>
            </section>
        );
    }

    return (
        <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="flex flex-col gap-4">
                <div className="text-white">
                    <h2 className="text-2xl font-bold">游戏模块</h2>
                    <p className="mt-1 text-sm text-white/95">精选市面上高频流行的休闲、益智、注意力训练小游戏方向，先做入口聚合，后续可以逐个接入完整玩法。</p>
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {gameEntries.map((entry) => (
                        <button
                            key={entry.id}
                            type="button"
                            onClick={() => openGame(entry)}
                            className="group relative min-h-[190px] overflow-hidden rounded-xl border border-white/40 bg-slate-900/25 text-left shadow-xl shadow-slate-900/15 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/70 focus:outline-none focus:ring-2 focus:ring-white/85"
                        >
                            <img src={entry.image} alt={entry.title} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
                            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/84 via-slate-950/18 to-transparent" />
                            <div className="relative flex h-full min-h-[190px] flex-col justify-end p-5 text-white">
                                <span className="mb-3 w-fit rounded-full bg-white/18 px-3 py-1 text-xs font-semibold backdrop-blur-md">{entry.tag}</span>
                                <h3 className="text-xl font-bold leading-6">{entry.title}</h3>
                                <p className="mt-2 text-sm leading-5 text-white/95">{entry.subtitle}</p>
                            </div>
                        </button>
                    ))}
                </div>
            </div>

            <div className="rounded-xl border border-white/38 bg-white/88 p-5 text-slate-950 shadow-xl shadow-slate-900/12 backdrop-blur-xl">
                <h3 className="text-xl font-bold">呼吸节奏挑战</h3>
                <p className="mt-2 text-sm leading-6 text-slate-800">自动节奏小游戏，进入后点击开始，系统会自动推进吸气、停留、呼气和放松。</p>
                <div className="mt-6 flex flex-col items-center">
                    <div className="flex h-44 w-44 items-center justify-center rounded-full border border-emerald-200 bg-emerald-100 shadow-inner">
                        <div className={`flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg transition-all duration-500 ${currentBreathPhase.sizeClass}`}>
                            <span className="text-2xl font-bold">{currentBreathPhase.label}</span>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            const breathGame = gameEntries.find((entry) => entry.id === "breath");
                            if (breathGame) openGame(breathGame);
                        }}
                        className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-semibold text-white hover:bg-slate-800"
                    >
                        <PlayIcon className="h-4 w-4" />
                        进入挑战
                    </button>
                </div>
            </div>
        </section>
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
                <div className='contrast-safe w-full min-h-screen animated-gradient flex items-center justify-center' style={{ position: 'relative' }}>
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
            <div className='contrast-safe w-full min-h-screen animated-gradient' style={{ position: 'relative' }}>
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

