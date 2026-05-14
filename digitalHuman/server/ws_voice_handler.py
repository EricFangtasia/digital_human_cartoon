# -*- coding: utf-8 -*-

from fastapi import WebSocket

from digitalHuman.protocol import UserDesc
from digitalHuman.server.core.streaming_handler import run_realtime_voice_dialogue


async def handle_voice_dialogue_stream(websocket: WebSocket):
    user = UserDesc(user_id="anonymous", request_id="voice-stream", cookie="")
    await run_realtime_voice_dialogue(websocket, user)
