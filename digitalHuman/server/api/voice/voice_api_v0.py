# -*- coding: utf-8 -*-

from fastapi import APIRouter, WebSocket

from digitalHuman.server.ws_voice_handler import handle_voice_dialogue_stream


router = APIRouter(prefix="/voice/v0")


@router.websocket("/dialogue/stream")
async def api_voice_dialogue_stream(websocket: WebSocket):
    await handle_voice_dialogue_stream(websocket)
