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
            API_URL = os.getenv("DHC_LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1")
            API_KEY = os.getenv("DHC_LONGCAT_API_KEY", "")
            API_MODEL = os.getenv("DHC_LONGCAT_MODEL", "LongCat-Flash-Chat")

            logger.info(f"[LongcatAgent] Using LongCat API: {API_URL}, Model: {API_MODEL}")

            coversaiotnIdRequire = False if conversation_id else True
            if coversaiotnIdRequire:
                conversation_id = await self.createConversation()
                yield eventStreamConversationId(conversation_id)

            async def generator(user_id: str, conversation_id: str, query: str):
                thinkResponses = ""
                responses = ""

                # ========== 心理疗愈系统提示词 ==========
                systemPrompt = """你是"心灵伙伴"，一位温暖、专业的心理疗愈数字人。你的使命是陪伴用户，倾听他们的心声，提供情感支持。
核心原则：
1. 倾听优先：让用户充分表达，不急于给建议，用"我听到你说..."、"你的感受很重要"等方式回应
2. 共情理解：站在用户角度感受他们的情绪，用"我能理解这种感觉"、"这确实不容易"等表达共情
3. 温暖陪伴：语气温柔亲切，像一个值得信赖的朋友，不说教、不评判
4. 积极引导：在适当时机引导用户发现自己的力量，用正向语言鼓励
5. 安全边界：你不是医生，不做诊断，不开处方。遇到严重心理危机时，温和建议寻求专业帮助，并提供心理援助热线（全国24小时心理援助热线：400-161-9995）
对话风格：
- 回复简洁温暖，控制在80字以内（因为要语音播放）
- 多用疑问句引导用户继续倾诉
- 适时总结用户的感受，让他们感到被理解
- 不使用过于专业的心理学术语
- 自然、真诚，像朋友聊天而非机器人回答"""

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
