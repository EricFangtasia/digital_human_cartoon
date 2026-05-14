# -*- coding: utf-8 -*-
'''
@File    :   api.py
@Author  :   一力辉 
'''

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from digitalHuman.database import Database
from digitalHuman.server.api.common.common_api_v0 import router as commonRouter
from digitalHuman.server.api.asr.asr_api_v0 import router as asrRouter
from digitalHuman.server.api.tts.tts_api_v0 import router as ttsRouter
from digitalHuman.server.api.llm.llm_api_v0 import router as llmRouter
from digitalHuman.server.api.agent.agent_api_v0 import router as agentRouter
from digitalHuman.server.api.voice.voice_api_v0 import router as voiceRouter
from digitalHuman.server.api.user.router import router as userRouter
from digitalHuman.utils import config


__all__ = ["app"]

app = FastAPI(
    title=config.COMMON.NAME, 
    description=f"This is a cool set of apis for {config.COMMON.NAME}",
    version=config.COMMON.VERSION
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GLOABLE_PREFIX = "/adh"
# 路由
app.include_router(commonRouter, prefix=GLOABLE_PREFIX, tags=["COMMON"])
app.include_router(asrRouter, prefix=GLOABLE_PREFIX, tags=["ASR"])
app.include_router(ttsRouter, prefix=GLOABLE_PREFIX, tags=["TTS"])
app.include_router(llmRouter, prefix=GLOABLE_PREFIX, tags=["LLM"])
app.include_router(agentRouter, prefix=GLOABLE_PREFIX, tags=["AGENT"])
app.include_router(voiceRouter, prefix=GLOABLE_PREFIX, tags=["VOICE"])
app.include_router(userRouter, prefix=GLOABLE_PREFIX, tags=["USER"])


@app.on_event("startup")
async def startup_event():
    await Database.get_instance()
    from digitalHuman.server.api.user.router import ensure_default_admin
    await ensure_default_admin()
    # 初始化引擎池
    from digitalHuman.engine import EnginePool
    from digitalHuman.agent import AgentPool
    enginePool = EnginePool()
    enginePool.setup(config.SERVER.ENGINES)
    agentPool = AgentPool()
    agentPool.setup(config.SERVER.AGENTS)
    # 初始化通知服务
    try:
        from digitalHuman.notification import Notifier
        notifier = Notifier.get_instance()
        await notifier.initialize()
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Notifier init failed: {e}")
