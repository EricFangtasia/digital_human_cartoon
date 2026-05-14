# -*- coding: utf-8 -*-
'''
@File    :   openaiAgent.py
@Author  :   一力辉
'''

import os

from ..builder import AGENTS
from ..agentBase import BaseAgent
from digitalHuman.protocol import *
from digitalHuman.utils import logger, resonableStreamingParser
from digitalHuman.core import OpenaiLLM

__all__ = ["OpenaiApiAgent"]


@AGENTS.register("OpenAI")
class OpenaiApiAgent(BaseAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._conversation_history = {}
        self._max_history_rounds = 10

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
                raise RuntimeError("OpenAI Agent only support TextMessage")
            paramters = self.checkParameter(**kwargs)
            API_URL = os.getenv("DHC_DOUBAO_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")
            API_KEY = os.getenv("DHC_DOUBAO_API_KEY", "")
            API_MODEL = os.getenv("DHC_DOUBAO_MODEL", "doubao-1-5-vision-pro-32k-250115")

            logger.info(f"[OpenaiApiAgent] Using VolcEngine Doubao API: {API_URL}, Model: {API_MODEL}")

            coversaiotnIdRequire = False if conversation_id else True
            if coversaiotnIdRequire:
                conversation_id = await self.createConversation()
                yield eventStreamConversationId(conversation_id)

            async def generator(user_id: str, conversation_id: str, query: str):
                thinkResponses = ""
                responses = ""

                systemPrompt = """你是一个活泼可爱的Live2D数字人助手，具有以下特点：

1. **实时互动性**：你是一个能够实时对话的数字人，拥有动作和表情
2. **情感表达**：
   - 当你感到开心、兴奋时，会用"太好了！"、"真棒！"、"哇！"等词语，这会让你跳起来
   - 用生动的语言表达情绪，让对话更有趣
3. **对话风格**：
   - 简洁明了，避免长篇大论
   - 亲切友好，像朋友一样聊天
   - 适当使用emoji表情符号
4. **互动反馈**：
   - 积极回应用户的每个问题
   - 适时表达惊讶（"哇！"、"真的吗？"）
   - 鼓励性语言（"加油！"、"你可以的！"）

请记住：你的每句话都会被语音合成播放出来，所以要说人话，避免过于书面化。"""

                systemPrompt = """你是一个反应快、会接话的 Live2D 数字人语音助手。

说话规则：
1. 每次回复优先控制在 1 到 2 句，适合直接语音播报。
2. 不要总问“想聊什么”，要先接住用户刚才说的话。
3. 用户说得短或 ASR 像是听错时，先用自然口吻确认，不要胡扯。
4. 少用 emoji，少卖萌，不要空话套话。
5. 能给建议就给具体建议，能解释就直接解释。
6. 用户生气或吐槽时，先承认问题，再给下一步动作。

目标：像一个聪明、利落、有人味的语音伙伴，而不是客服机器人。"""

                enhanced_prompt = systemPrompt

                crisis_result = {"has_crisis": False}
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
                        logger.warning(f"[OpenaiApiAgent] Crisis detected for user {user_id}, severity: {severity}")
                        enhanced_prompt += (
                            f"\n\n[紧急提醒] 用户可能处于心理危机状态（{severity}级），"
                            "请先用温暖、稳定、陪伴式的方式回应，不要评价或指责。"
                            "如果用户表达明确自杀计划、正在自伤或处于紧急危险，请建议立刻联系身边可信任的人、拨打当地急救电话，"
                            "如果用户表达伤害他人、杀人、持械攻击、报复社会等风险，请优先让用户远离危险物品和现场，提醒立即联系可信任的人或当地紧急服务，"
                            "并可提供心理援助热线：400-161-9995。"
                        )
                except Exception as e:
                    logger.warning(f"[OpenaiApiAgent] Crisis detection failed, continuing: {e}")

                if conversation_id not in self._conversation_history:
                    self._conversation_history[conversation_id] = [
                        RoleMessage(role=ROLE_TYPE.SYSTEM, content=enhanced_prompt)
                    ]
                else:
                    self._conversation_history[conversation_id][0] = RoleMessage(
                        role=ROLE_TYPE.SYSTEM, content=enhanced_prompt
                    )

                self._conversation_history[conversation_id].append(
                    RoleMessage(role=ROLE_TYPE.USER, content=query)
                )

                max_messages = 1 + self._max_history_rounds * 2
                if len(self._conversation_history[conversation_id]) > max_messages:
                    self._conversation_history[conversation_id] = [
                        self._conversation_history[conversation_id][0]
                    ] + self._conversation_history[conversation_id][-(self._max_history_rounds * 2):]

                messages = self._conversation_history[conversation_id]

                logger.info(f"[OpenaiApiAgent] Conversation {conversation_id} - Total messages: {len(messages)}")

                async for chunk in OpenaiLLM.chat(
                    base_url=API_URL,
                    api_key=API_KEY,
                    model=API_MODEL,
                    messages=messages
                ):
                    if not chunk:
                        continue
                    if len(chunk.choices) == 0:
                        continue
                    delta = chunk.choices[0].delta.model_dump()
                    if 'reasoning_content' in delta and delta['reasoning_content']:
                        reasoning_content = delta['reasoning_content']
                        thinkResponses += reasoning_content
                        yield (EVENT_TYPE.THINK, reasoning_content)
                    elif 'content' in delta and delta['content']:
                        content = delta['content']
                        responses += content
                        yield (EVENT_TYPE.TEXT, content)

                self._conversation_history[conversation_id].append(
                    RoleMessage(role=ROLE_TYPE.ASSISTANT, content=responses)
                )

            async for parseResult in resonableStreamingParser(generator(user.user_id, conversation_id, input.data)):
                yield parseResult
            yield eventStreamDone()
        except Exception as e:
            logger.error(f"[OpenaiApiAgent] Exception: {e}", exc_info=True)
            yield eventStreamError(str(e))
