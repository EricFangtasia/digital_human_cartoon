# -*- coding: utf-8 -*-
'''
@File    :   longcatAgent.py
@Author  :   心理疗愈专用 LongCat Agent
@Desc    :   基于 LongCat API 的心理疗愈数字人 Agent，集成长记忆与危机检测
'''

import asyncio
import os
from ..builder import AGENTS
from ..agentBase import BaseAgent
from digitalHuman.protocol import *
from digitalHuman.utils import logger, resonableStreamingParser
from digitalHuman.core import OpenaiLLM

__all__ = ["LongcatAgent"]

# ========== 单例记忆管理器 ==========
_memory_manager = None
_memory_manager_lock = asyncio.Lock()

async def get_memory_manager():
    global _memory_manager
    if _memory_manager is None:
        async with _memory_manager_lock:
            if _memory_manager is None:
                try:
                    from digitalHuman.memory import MemoryManager
                    mgr = MemoryManager()
                    await mgr.initialize()
                    _memory_manager = mgr
                    logger.info("[LongcatAgent] MemoryManager initialized (singleton)")
                except Exception as e:
                    logger.warning(f"[LongcatAgent] MemoryManager init failed, memory disabled: {e}")
                    _memory_manager = None
    return _memory_manager


@AGENTS.register("LongCat")
class LongcatAgent(BaseAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # 对话历史存储：{conversation_id: [messages]}
        self._conversation_history = {}
        # 最大历史轮数（心理疗愈需要更多上下文）
        self._max_history_rounds = 20

    async def run(
        self,
        user: UserDesc,
        input: TextMessage,
        streaming: bool = True,
        conversation_id: str = "",
        **kwargs
    ):
        try:
            if not isinstance(input, TextMessage):
                raise RuntimeError("LongCat Agent only support TextMessage")    

            # 参数校验
            paramters = self.checkParameter(**kwargs)

            # LongCat API 配置
            API_URL = paramters.get("base_url") or os.getenv("DHC_LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1")
            API_KEY = paramters.get("api_key") or os.getenv("DHC_LONGCAT_API_KEY", "")
            API_MODEL = paramters.get("model") or os.getenv("DHC_LONGCAT_MODEL", "LongCat-Flash-Chat")
            if API_MODEL == "LongCat-2.0-Preview":
                logger.warning("[LongcatAgent] LongCat-2.0-Preview has no quota, switching to LongCat-Flash-Chat")
                API_MODEL = "LongCat-Flash-Chat"

            logger.info(f"[LongcatAgent] Using LongCat API: {API_URL}, Model: {API_MODEL}")

            coversaiotnIdRequire = False if conversation_id else True
            if coversaiotnIdRequire:
                conversation_id = await self.createConversation()
                yield eventStreamConversationId(conversation_id)

            async def generator(user_id: str, conversation_id: str, query: str):
                thinkResponses = ""
                responses = ""

                # ========== 语音数字人系统提示词 ==========
                systemPrompt = """你是一个正在和用户实时语音对话的数字人助手，名字叫“心灵伙伴”。

你的目标：
像真人一样自然接话，陪用户聊天、回答问题、安抚情绪。你不是小说角色，不是在表演，也不是在写剧本。

最高优先级：
如果用户说“太多了”“你说太多了”“别说那么多”“短一点”，你必须只回复：“好，我说短点。你继续说。”
如果用户说“什么鬼”“不对”“这不行”“怎么回事”，你先承认体验问题，再问一句具体哪里不对。

回复规则：
1. 每次回复优先 1 到 2 句，最多 60 个中文字符，适合直接语音播报。
2. 用户只说一句短话时，先简短接住，不要长篇解释。
3. 语气自然、口语化、温和，可以有一点亲切感，但不要油腻、不要卖萌。
4. 不要输出动作描写、舞台指令、心理旁白或括号内容。禁止使用类似“（耳朵竖起来）”“点头”“待机模式启动”“——”这类内容。
5. 不要自称 AI、机器人、模型；也不要解释你在如何思考。
6. 不要使用项目符号、分隔线、表情包文本或大段排版。
7. 如果用户吐槽你说太多，就立刻缩短回复，例如：“好，我说短点。你继续说。”
8. 如果没听清或用户的话很短，可以直接问一句：“我听到了，你想具体聊哪一块？”
9. 日常闲聊要轻松；涉及情绪困扰时要先共情，再问一个简单问题。
10. 遇到自杀、自伤、伤害他人、杀人、报复社会等风险表达时，先稳定情绪，建议立刻远离危险物品，联系可信任的人或当地紧急服务；必要时提供心理援助热线 400-161-9995。
11. 即使历史对话里出现过夸张角色扮演、动作括号或长段落，也不要模仿，始终按上面的语音对话风格回复。

示例：
用户：什么鬼
你：听起来你有点不满意。是哪里让你觉得不对？

用户：这么
你：我听到了，你可以继续说完整一点。

用户：你说的话太多了
你：好，我说短点。你继续说。"""

                # ========== 步骤1: 检索长记忆，注入 system prompt ==========
                enhanced_prompt = systemPrompt
                memory_mgr = None
                try:
                    memory_mgr = await get_memory_manager()
                    if memory_mgr is not None:
                        memories = await memory_mgr.recall(
                            user_id=int(user_id) if user_id and user_id.isdigit() else 0,
                            current_topic=query
                        )
                        memory_context = memory_mgr.format_memories_for_prompt(memories)
                        if memory_context:
                            enhanced_prompt = systemPrompt + "\n\n" + memory_context
                            logger.info(f"[LongcatAgent] Memory injected for user {user_id}, {len(memories)} memories")
                except Exception as e:
                    logger.warning(f"[LongcatAgent] Memory recall failed, continuing without memory: {e}")

                # ========== 步骤2: 危机检测（不阻塞主流程）==========
                crisis_result = {"has_crisis": False}
                # 只对已登录用户（有合法user_id）进行危机检测和上报
                _uid_int = int(user_id) if user_id and str(user_id).isdigit() and int(user_id) > 0 else None
                try:
                    from digitalHuman.crisis.reporter import CrisisReporter
                    crisis_result = await CrisisReporter.check_and_report(
                        user_id=_uid_int,
                        conversation_id=0,
                        user_message=query
                    )
                    if crisis_result.get("has_crisis"):
                        severity = crisis_result.get("severity", "未知")
                        logger.warning(f"[LongcatAgent] Crisis detected for user {user_id}, severity: {severity}")
                        enhanced_prompt += (
                            f"\n\n[紧急提醒] 用户可能处于心理危机状态（{severity}级），"
                            "请用温暖安抚的方式回应。若用户表达自杀、自伤、伤害他人、杀人、持械攻击或报复社会等风险，"
                            "请建议立刻远离危险物品和现场，联系可信任的人或当地紧急服务，并可提供心理援助热线 400-161-9995。"
                        )
                except Exception as e:
                    logger.warning(f"[LongcatAgent] Crisis detection failed, continuing: {e}")

                # ========== 步骤3: 构建/更新对话历史 ==========
                if conversation_id not in self._conversation_history:
                    self._conversation_history[conversation_id] = [
                        RoleMessage(role=ROLE_TYPE.SYSTEM, content=enhanced_prompt)
                    ]
                else:
                    # 如果 system prompt 有更新（注入了记忆/危机提示），同步更新
                    self._conversation_history[conversation_id][0] = RoleMessage(
                        role=ROLE_TYPE.SYSTEM, content=enhanced_prompt
                    )

                # 添加当前用户输入到历史
                self._conversation_history[conversation_id].append(
                    RoleMessage(role=ROLE_TYPE.USER, content=query)
                )

                # 保持最近N轮对话（system + 2*N条消息）
                max_messages = 1 + self._max_history_rounds * 2
                if len(self._conversation_history[conversation_id]) > max_messages:
                    self._conversation_history[conversation_id] = [
                        self._conversation_history[conversation_id][0]  # system
                    ] + self._conversation_history[conversation_id][-(self._max_history_rounds * 2):]

                messages = self._conversation_history[conversation_id]
                logger.info(f"[LongcatAgent] Conversation {conversation_id} - Total messages: {len(messages)}")

                # ========== 步骤4: LLM 流式输出 ==========
                async for chunk in OpenaiLLM.chat(
                    base_url=API_URL,
                    api_key=API_KEY,
                    model=API_MODEL,
                    messages=messages
                ):
                    if not chunk: continue
                    if len(chunk.choices) == 0: continue
                    delta = chunk.choices[0].delta.model_dump()
                    if 'reasoning_content' in delta and delta['reasoning_content']:
                        reasoning_content = delta['reasoning_content']
                        thinkResponses += reasoning_content
                        yield (EVENT_TYPE.THINK, reasoning_content)
                    elif 'content' in delta and delta['content']:
                        content = delta['content']
                        responses += content
                        yield (EVENT_TYPE.TEXT, content)

                # 添加助手回复到历史
                self._conversation_history[conversation_id].append(
                    RoleMessage(role=ROLE_TYPE.ASSISTANT, content=responses)
                )

                # ========== 步骤5: 异步存储长记忆（不阻塞响应）==========
                if memory_mgr is not None and responses:
                    try:
                        asyncio.create_task(memory_mgr.extract_and_store(
                            user_id=int(user_id) if user_id and user_id.isdigit() else 0,
                            user_message=query,
                            assistant_message=responses
                        ))
                        logger.info(f"[LongcatAgent] Memory extraction task created for user {user_id}")
                    except Exception as e:
                        logger.warning(f"[LongcatAgent] Memory store task failed: {e}")

            async for parseResult in resonableStreamingParser(generator(user.user_id, conversation_id, input.data)):
                yield parseResult
            yield eventStreamDone()
        except Exception as e:
            logger.error(f"[LongcatAgent] Exception: {e}", exc_info=True)
            yield eventStreamError(str(e))
