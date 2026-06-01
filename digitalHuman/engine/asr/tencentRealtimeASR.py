import asyncio
import base64
import hashlib
import hmac
import json
import os
import random
import time
import uuid
from urllib.parse import urlencode

import websockets
from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from digitalHuman.engine.builder import ASREngines
from digitalHuman.engine.engineBase import StreamBaseEngine
from digitalHuman.protocol import (
    WS_RECV_ACTION_TYPE,
    WS_SEND_ACTION_TYPE,
    WebSocketHandler,
)
from digitalHuman.utils import logger

__all__ = ["TencentRealtimeAsr"]


@ASREngines.register("tencentRealtime")
class TencentRealtimeAsr(StreamBaseEngine):
    async def _safe_send_to_adh(self, adh_websocket: WebSocket, action: str, message: str | bytes = b"") -> bool:
        if adh_websocket.client_state != WebSocketState.CONNECTED:
            return False
        try:
            await WebSocketHandler.send_message(adh_websocket, action, message)
            return True
        except (RuntimeError, WebSocketDisconnect):
            return False

    def _get_param(self, parameters: dict, name: str, env_name: str, default: str = "") -> str:
        value = str(parameters.get(name) or "").strip()
        if value:
            return value
        return os.getenv(env_name, default).strip()

    def _build_url(self, parameters: dict) -> str:
        app_id = self._get_param(parameters, "app_id", "TENCENT_ASR_APP_ID")
        secret_id = self._get_param(parameters, "secret_id", "TENCENT_ASR_SECRET_ID")
        secret_key = self._get_param(parameters, "secret_key", "TENCENT_ASR_SECRET_KEY")
        if not app_id or not secret_id or not secret_key:
            raise RuntimeError(
                "Missing Tencent realtime ASR credentials. Set TENCENT_ASR_APP_ID, "
                "TENCENT_ASR_SECRET_ID and TENCENT_ASR_SECRET_KEY on the backend."
            )

        host = "asr.cloud.tencent.com"
        path = f"/asr/v2/{app_id}"
        timestamp = int(time.time())
        query = {
            "engine_model_type": str(parameters.get("engine_model_type") or "16k_zh"),
            "expired": int(parameters.get("expired") or (timestamp + 24 * 60 * 60)),
            "filter_dirty": int(parameters.get("filter_dirty") or 0),
            "filter_empty_result": int(parameters.get("filter_empty_result") or 1),
            "filter_modal": int(parameters.get("filter_modal") or 0),
            "filter_punc": int(parameters.get("filter_punc") or 0),
            "needvad": int(parameters.get("needvad") if parameters.get("needvad") != "" else 1),
            "nonce": random.randint(100000, 999999999),
            "secretid": secret_id,
            "timestamp": timestamp,
            "voice_format": int(parameters.get("voice_format") or 1),
            "voice_id": str(uuid.uuid4()),
        }

        hotword_list = str(parameters.get("hotword_list") or "").strip()
        if hotword_list:
            query["hotword_list"] = hotword_list

        sorted_query = sorted(query.items(), key=lambda item: item[0])
        sign_query = "&".join(f"{key}={value}" for key, value in sorted_query)
        sign_source = f"{host}{path}?{sign_query}"
        signature = base64.b64encode(
            hmac.new(secret_key.encode("utf-8"), sign_source.encode("utf-8"), hashlib.sha1).digest()
        ).decode("utf-8")
        query["signature"] = signature
        return f"wss://{host}{path}?{urlencode(query)}"

    async def _task_recv(self, adh_websocket: WebSocket, tencent_websocket: websockets.ClientConnection):
        pending_audio = bytearray()
        last_send_at = 0.0
        target_chunk_bytes = 6400
        target_interval_seconds = 0.2

        async def send_audio(force: bool = False):
            nonlocal last_send_at
            while len(pending_audio) >= target_chunk_bytes or (force and len(pending_audio) > 0):
                chunk_size = min(len(pending_audio), target_chunk_bytes)
                chunk = bytes(pending_audio[:chunk_size])
                del pending_audio[:chunk_size]

                elapsed = time.monotonic() - last_send_at if last_send_at else target_interval_seconds
                if elapsed < target_interval_seconds:
                    await asyncio.sleep(target_interval_seconds - elapsed)
                await tencent_websocket.send(chunk)
                last_send_at = time.monotonic()

        try:
            await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ENGINE_STARTED)
            while True:
                action, payload = await WebSocketHandler.recv_message(adh_websocket)
                if action == WS_RECV_ACTION_TYPE.PING:
                    await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.PONG.value, b"")
                elif action == WS_RECV_ACTION_TYPE.ENGINE_START:
                    raise RuntimeError("TencentRealtimeAsr has already started")
                elif action == WS_RECV_ACTION_TYPE.ENGINE_PARTIAL_INPUT:
                    pending_audio.extend(payload)
                    await send_audio(False)
                elif action == WS_RECV_ACTION_TYPE.ENGINE_FINAL_INPUT:
                    pending_audio.extend(payload)
                    await send_audio(True)
                    await tencent_websocket.send(json.dumps({"type": "end"}, ensure_ascii=False))
                elif action == WS_RECV_ACTION_TYPE.ENGINE_STOP:
                    await send_audio(True)
                    await tencent_websocket.send(json.dumps({"type": "end"}, ensure_ascii=False))
                    await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ENGINE_STOPPED)
                    return
                else:
                    raise RuntimeError(f"TencentRealtimeAsr task_recv error: {action} not found")
        except WebSocketDisconnect:
            logger.debug("adh websocket closed, TencentRealtimeAsr recv task exit")
        except websockets.ConnectionClosed:
            logger.debug("Tencent ASR websocket closed, recv task exit")
        except Exception as error:
            logger.error(f"TencentRealtimeAsr task_recv error: {error}")
            await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ERROR, str(error))

    async def _task_send(self, adh_websocket: WebSocket, tencent_websocket: websockets.ClientConnection):
        last_partial_text = ""
        try:
            async for raw_message in tencent_websocket:
                if isinstance(raw_message, bytes):
                    continue
                data = json.loads(raw_message)
                code = int(data.get("code", 0))
                if code != 0:
                    message = data.get("message") or f"Tencent realtime ASR error: {code}"
                    await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ERROR, message)
                    return

                result = data.get("result") or {}
                text = str(result.get("voice_text_str") or "").strip()
                slice_type = int(result.get("slice_type", -1)) if "slice_type" in result else -1
                if text:
                    if slice_type == 2:
                        last_partial_text = ""
                        logger.info(f"TencentRealtimeAsr final: {text}")
                        if not await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ENGINE_FINAL_OUTPUT, text):
                            return
                    elif text != last_partial_text:
                        last_partial_text = text
                        logger.debug(f"TencentRealtimeAsr partial: {text}")
                        if not await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ENGINE_PARTIAL_OUTPUT, text):
                            return

                if int(data.get("final", 0)) == 1:
                    await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ENGINE_STOPPED)
                    return
        except WebSocketDisconnect:
            logger.debug("adh websocket closed, TencentRealtimeAsr send task exit")
        except websockets.ConnectionClosed:
            logger.debug("Tencent ASR websocket closed, send task exit")
        except Exception as error:
            logger.error(f"TencentRealtimeAsr task_send error: {error}")
            await self._safe_send_to_adh(adh_websocket, WS_SEND_ACTION_TYPE.ERROR, str(error))

    async def run(self, websocket: WebSocket, **kwargs) -> None:
        parameters = self.checkParameter(**kwargs)
        url = self._build_url(parameters)
        await self._safe_send_to_adh(websocket, WS_SEND_ACTION_TYPE.ENGINE_INITIALZING)
        async with websockets.connect(url, ping_interval=None, max_size=2 * 1024 * 1024) as tencent_websocket:
            task_recv = asyncio.create_task(self._task_recv(websocket, tencent_websocket))
            task_send = asyncio.create_task(self._task_send(websocket, tencent_websocket))
            done, pending = await asyncio.wait(
                {task_recv, task_send},
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
            for task in done:
                task.result()
