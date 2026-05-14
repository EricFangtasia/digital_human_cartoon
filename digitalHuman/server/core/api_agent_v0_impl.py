# -*- coding: utf-8 -*-
'''
@File    :   api_agent_v0_impl.py
@Author  :   一力辉
'''

from typing import List, Dict
from digitalHuman.agent import AgentPool
from digitalHuman.utils import config, logger
from digitalHuman.protocol import *
from digitalHuman.server.models import AgentEngineInput

agentPool = AgentPool()


def get_agent_list() -> List[EngineDesc]:
    agents = agentPool.list()
    return [agentPool.get(agent).desc() for agent in agents]


def get_agent_default() -> EngineDesc:
    return agentPool.get(config.SERVER.AGENTS.DEFAULT).desc()


def get_agent_param(name: str) -> List[ParamDesc]:
    engine = agentPool.get(name)
    return engine.parameters()


async def create_agent_conversation(name: str, param: Dict) -> str:
    engine = agentPool.get(name)
    id = await engine.createConversation(**param)
    return id


def agent_infer_stream(user: UserDesc, items: AgentEngineInput):
    input = TextMessage(data=items.data)
    engine = items.engine
    agent_config = items.config

    if engine == "LongCat":
        logger.warning("[AgentAPI] LongCat is slow/unreliable for realtime voice, routing request to OpenAI/Doubao")
        engine = "OpenAI"
        agent_config = {}

    streamContent = agentPool.get(engine).run(
        input=input,
        user=user,
        streaming=True,
        conversation_id=items.conversation_id,
        **agent_config
    )
    return streamContent
