# -*- coding: utf-8 -*-
"""
Unified realtime voice dialogue websocket pipeline.
"""

from __future__ import annotations

import asyncio
import base64
import json
from contextlib import suppress
from dataclasses import dataclass
from typing import Any, Dict, Optional

import websockets
from fastapi import WebSocket, WebSocketDisconnect

from digitalHuman.agent import AgentPool
from digitalHuman.engine import EnginePool
from digitalHuman.engine.asr.vad_detector import VADDecision, VADDetector
from digitalHuman.protocol import ENGINE_TYPE, EVENT_TYPE, AudioMessage, TextMessage, UserDesc
from digitalHuman.utils import logger


SENTENCE_ENDINGS = {".", "!", "?", "\n", ";", "。", "！", "？", "；"}


def parse_event_stream_message(message: str) -> tuple[str, str]:
    event = ""
    data_parts: list[str] = []
    for line in message.splitlines():
        if line.startswith("event:"):
            event = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_parts.append(line.split(":", 1)[1].lstrip())
    data = "\n".join(data_parts).replace("\\n", "\n")
    return event, data


def extract_ready_sentences(buffer: str, minimum_length: int = 6) -> tuple[list[str], str]:
    ready: list[str] = []
    last_cut = 0
    for index, char in enumerate(buffer):
        if char in SENTENCE_ENDINGS and (index + 1 - last_cut) >= minimum_length:
            sentence = buffer[last_cut:index + 1].strip()
            if sentence:
                ready.append(sentence)
            last_cut = index + 1
    return ready, buffer[last_cut:]


@dataclass
class VoiceRuntimeConfig:
    asr_engine: str
    asr_config: Dict[str, Any]
    tts_engine: str
    tts_config: Dict[str, Any]
    agent_engine: str
    agent_config: Dict[str, Any]


class FunASRDialogueSession:
    def __init__(
        self,
        api_url: str,
        mode: str = "2pass",
        chunk_size: list[int] | None = None,
        chunk_interval: int = 5,
        encoder_chunk_look_back: int = 4,
        decoder_chunk_look_back: int = 0,
        itn: bool = True,
    ):
        self.api_url = api_url
        self.mode = mode
        self.chunk_size = chunk_size or [5, 10, 5]
        self.chunk_interval = chunk_interval
        self.encoder_chunk_look_back = encoder_chunk_look_back
        self.decoder_chunk_look_back = decoder_chunk_look_back
        self.itn = itn
        self.websocket: Optional[websockets.ClientConnection] = None
        self.recv_task: Optional[asyncio.Task] = None
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.online_text = ""
        self.offline_text = ""
        self.simple_text = ""
        self.final_wait_task: Optional[asyncio.Task] = None

    async def connect(self):
        self.websocket = await websockets.connect(self.api_url, subprotocols=["binary"], ping_interval=None)
        await self.websocket.send(
            json.dumps(
                {
                    "mode": self.mode,
                    "chunk_size": self.chunk_size,
                    "chunk_interval": self.chunk_interval,
                    "encoder_chunk_look_back": self.encoder_chunk_look_back,
                    "decoder_chunk_look_back": self.decoder_chunk_look_back,
                    "wav_name": "adh-voice-dialogue",
                    "is_speaking": True,
                    "hotwords": "",
                    "itn": self.itn,
                }
            )
        )
        self.recv_task = asyncio.create_task(self._recv_loop())

    async def _reset_sentence(self):
        if self.websocket is None:
            return
        await self.websocket.send(json.dumps({"is_speaking": False}))
        await self.websocket.send(json.dumps({"is_speaking": True}))

    def _clear_text_cache(self):
        self.online_text = ""
        self.offline_text = ""
        self.simple_text = ""

    async def _recv_loop(self):
        try:
            assert self.websocket is not None
            async for raw_message in self.websocket:
                message = json.loads(raw_message)
                text = str(message.get("text") or "")
                is_final = bool(message.get("is_final", False))
                mode = str(message.get("mode") or "")
                if not mode:
                    continue

                if mode == "online":
                    self.simple_text = text or self.simple_text
                    await self.queue.put({"type": "partial", "text": self.simple_text})
                    continue

                if mode == "offline":
                    self._cancel_final_wait()
                    self.simple_text = text or self.simple_text
                    await self.queue.put({"type": "final", "text": self.simple_text.strip()})
                    self._clear_text_cache()
                    await self._reset_sentence()
                    continue

                if mode == "2pass-online":
                    self.online_text = text or self.online_text
                    partial_text = (self.offline_text + self.online_text).strip()
                    await self.queue.put({"type": "partial", "text": partial_text})
                    continue

                if mode.startswith("2pass"):
                    self._cancel_final_wait()
                    final_text = (text or self.online_text or self.offline_text).strip()
                    if final_text or is_final:
                        await self.queue.put({"type": "final", "text": final_text})
                    self._clear_text_cache()
                    await self._reset_sentence()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"[RealtimeVoice] FunASR recv loop error: {exc}", exc_info=True)
            await self.queue.put({"type": "error", "message": str(exc)})

    async def send_partial(self, chunk: bytes):
        if self.websocket is not None:
            await self.websocket.send(chunk)

    async def send_final(self):
        if self.websocket is not None:
            await self.websocket.send(json.dumps({"is_speaking": False}))
            # The deployed FunASR websocket server evaluates is_speaking=False
            # while handling the next binary frame. Send one silent frame so the
            # offline 2pass recognizer flushes immediately instead of waiting.
            await self.websocket.send(bytes(640))
            self._start_final_wait()

    def _cancel_final_wait(self):
        if self.final_wait_task is not None:
            self.final_wait_task.cancel()
            self.final_wait_task = None

    def _start_final_wait(self, timeout_seconds: float = 1.2):
        self._cancel_final_wait()
        self.final_wait_task = asyncio.create_task(self._final_wait_timeout(timeout_seconds))

    async def _final_wait_timeout(self, timeout_seconds: float):
        try:
            await asyncio.sleep(timeout_seconds)
            fallback_text = (self.simple_text or self.online_text or self.offline_text).strip()
            if fallback_text:
                logger.warning("[RealtimeVoice] FunASR final timeout, using partial text: %s", fallback_text)
            else:
                logger.warning("[RealtimeVoice] FunASR final timeout with no text")
            await self.queue.put({"type": "final", "text": fallback_text})
            self._clear_text_cache()
            await self._reset_sentence()
        except asyncio.CancelledError:
            raise
        finally:
            if asyncio.current_task() is self.final_wait_task:
                self.final_wait_task = None

    async def restart_sentence(self):
        self._clear_text_cache()
        await self._reset_sentence()

    async def next_event(self) -> dict[str, Any]:
        return await self.queue.get()

    async def close(self):
        self._cancel_final_wait()
        if self.recv_task is not None:
            self.recv_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.recv_task
            self.recv_task = None
        if self.websocket is not None:
            await self.websocket.close()
            self.websocket = None


class RealtimeVoiceDialogueSession:
    def __init__(self, websocket: WebSocket, user: UserDesc):
        self.websocket = websocket
        self.user = user
        self.engine_pool = EnginePool()
        self.agent_pool = AgentPool()
        self.vad = VADDetector(
            sample_rate=16000,
            silence_duration=0.45,
            chunk_duration_ms=20,
            min_speech_duration=0.06,
            energy_threshold=0.006,
        )
        self.runtime = self._default_runtime_config()
        self.asr_session: Optional[FunASRDialogueSession] = None
        self.asr_reader_task: Optional[asyncio.Task] = None
        self.agent_task: Optional[asyncio.Task] = None
        self.tts_worker_task: Optional[asyncio.Task] = None
        self.tts_queue: asyncio.Queue[tuple[int, Optional[str]]] = asyncio.Queue()
        self.current_response_id = 0
        self.conversation_id = ""
        self.pending_partial_text = ""
        self.listening_enabled = True
        self.finalizing_utterance = False
        self.responding = False
        self.closed = False
        self.audio_chunk_count = 0
        self.forwarded_chunk_count = 0

    def _default_runtime_config(self) -> VoiceRuntimeConfig:
        return VoiceRuntimeConfig(
            asr_engine="funasrStreaming",
            asr_config={},
            tts_engine="EdgeTTS",
            tts_config={},
            agent_engine="LongCat",
            agent_config={
                "model": "LongCat-Flash-Chat",
                "base_url": "https://api.longcat.chat/openai/v1",
            },
        )

    async def send_json(self, payload: dict[str, Any]):
        await self.websocket.send_text(json.dumps(payload, ensure_ascii=False))

    async def initialize(self):
        await self.send_json({"type": "ready"})
        self.tts_worker_task = asyncio.create_task(self._tts_worker())

    async def configure(self, payload: dict[str, Any]):
        asr = payload.get("asr") or {}
        tts = payload.get("tts") or {}
        agent = payload.get("agent") or {}
        agent_engine = str(agent.get("engine") or self.runtime.agent_engine)
        agent_config = dict(agent.get("config") or {})

        if agent_engine == "OpenAI":
            logger.warning("[RealtimeVoice] Legacy OpenAI request detected, routing request to LongCat-Flash-Chat")
            agent_engine = "LongCat"
            agent_config = {
                "model": "LongCat-Flash-Chat",
                "base_url": "https://api.longcat.chat/openai/v1",
                "api_key": agent_config.get("api_key") or "",
            }

        self.runtime = VoiceRuntimeConfig(
            asr_engine=str(asr.get("engine") or self.runtime.asr_engine),
            asr_config=dict(asr.get("config") or {}),
            tts_engine=str(tts.get("engine") or self.runtime.tts_engine),
            tts_config=dict(tts.get("config") or {}),
            agent_engine=agent_engine,
            agent_config=agent_config,
        )

        await self._reset_asr_session()
        await self.send_json(
            {
                "type": "configured",
                "asr_engine": self.runtime.asr_engine,
                "tts_engine": self.runtime.tts_engine,
                "agent_engine": self.runtime.agent_engine,
            }
        )

    async def _reset_asr_session(self):
        if self.asr_reader_task is not None:
            self.asr_reader_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.asr_reader_task
            self.asr_reader_task = None
        if self.asr_session is not None:
            await self.asr_session.close()
            self.asr_session = None

        asr_engine = self.engine_pool.getEngine(ENGINE_TYPE.ASR, self.runtime.asr_engine)
        asr_params = asr_engine.checkParameter(**self.runtime.asr_config)
        self.asr_session = FunASRDialogueSession(
            api_url=asr_params["api_url"],
            mode=str(asr_params.get("mode", "2pass")),
            chunk_size=list(asr_params.get("chunk_size", [5, 10, 5])),
            chunk_interval=int(asr_params.get("chunk_interval", 5)),
            encoder_chunk_look_back=int(asr_params.get("encoder_chunk_look_back", 4)),
            decoder_chunk_look_back=int(asr_params.get("decoder_chunk_look_back", 0)),
            itn=bool(asr_params.get("itn", True)),
        )
        await self.asr_session.connect()
        self.asr_reader_task = asyncio.create_task(self._pump_asr_events())
        self.vad.reset()
        self.pending_partial_text = ""
        self.finalizing_utterance = False

    async def _pump_asr_events(self):
        try:
            assert self.asr_session is not None
            while True:
                event = await self.asr_session.next_event()
                event_type = event.get("type")
                if event_type == "partial":
                    if not self.listening_enabled:
                        continue
                    text = str(event.get("text") or "").strip()
                    self.pending_partial_text = text
                    if text:
                        logger.debug(f"[RealtimeVoice] ASR partial: {text}")
                    await self.send_json({"type": "asr_partial", "text": text})
                    continue
                if event_type == "final":
                    self.finalizing_utterance = False
                    text = str(event.get("text") or "").strip() or self.pending_partial_text.strip()
                    self.pending_partial_text = ""
                    logger.info(f"[RealtimeVoice] ASR final: {text}")
                    await self.send_json({"type": "asr_final", "text": text})
                    if text:
                        await self._handle_user_text(text, source="asr")
                    elif self.listening_enabled:
                        self.vad.reset()
                    continue
                if event_type == "error":
                    await self.send_json({"type": "error", "message": event.get("message", "ASR error")})
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"[RealtimeVoice] ASR pump error: {exc}", exc_info=True)
            await self.send_json({"type": "error", "message": str(exc)})

    async def handle_audio_chunk(self, chunk: bytes):
        if not chunk:
            return
        if not self.listening_enabled or self.finalizing_utterance:
            return
        if self.asr_session is None:
            await self._reset_asr_session()

        decision: VADDecision = self.vad.process_chunk(chunk)
        self.audio_chunk_count += 1
        if self.audio_chunk_count == 1 or self.audio_chunk_count % 100 == 0 or decision.speech_started or decision.speech_ended:
            logger.info(
                "[RealtimeVoice] audio chunks=%s bytes=%s vad=%s speaking=%s forward_chunks=%s",
                self.audio_chunk_count,
                len(chunk),
                decision.has_speech,
                self.vad.is_speaking,
                len(decision.forward_chunks),
            )
        if decision.speech_started:
            await self.send_json({"type": "vad_state", "speaking": True})

        if self.asr_session is not None:
            for forward_chunk in decision.forward_chunks:
                self.forwarded_chunk_count += 1
                await self.asr_session.send_partial(forward_chunk)

        if decision.speech_ended and self.asr_session is not None:
            self.finalizing_utterance = True
            await self.asr_session.send_final()
            await self.send_json({"type": "vad_state", "speaking": False})

    async def handle_control_message(self, payload: dict[str, Any]):
        message_type = payload.get("type")
        if message_type == "start":
            await self.configure(payload)
            return
        if message_type == "stop":
            await self.interrupt(notify=True)
            self.vad.reset()
            self.pending_partial_text = ""
            self.listening_enabled = True
            self.finalizing_utterance = False
            await self.send_json({"type": "stopped"})
            return
        if message_type == "interrupt":
            await self.interrupt(notify=True)
            return
        if message_type == "user_text":
            text = str(payload.get("text") or "").strip()
            if text:
                await self._handle_user_text(text, source="text")

    async def interrupt(self, notify: bool = False):
        self.current_response_id += 1
        self.responding = False
        self.listening_enabled = True
        self.finalizing_utterance = False
        self.pending_partial_text = ""
        self.vad.reset()
        if self.asr_session is not None:
            await self.asr_session.restart_sentence()
        if self.agent_task is not None:
            self.agent_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.agent_task
            self.agent_task = None
        self._reset_tts_queue()
        if notify:
            await self.send_json({"type": "interrupted"})

    def _reset_tts_queue(self):
        while not self.tts_queue.empty():
            try:
                self.tts_queue.get_nowait()
                self.tts_queue.task_done()
            except Exception:
                break

    async def _handle_user_text(self, text: str, source: str):
        logger.info(f"[RealtimeVoice] User text from {source}: {text}")
        await self.interrupt(notify=False)
        self.listening_enabled = False
        self.responding = True
        self.vad.reset()
        self.pending_partial_text = ""
        self.finalizing_utterance = False
        response_id = self.current_response_id
        await self.send_json({"type": "user_text", "text": text, "source": source})
        self.agent_task = asyncio.create_task(self._run_agent_pipeline(text, response_id))

    async def _run_agent_pipeline(self, text: str, response_id: int):
        try:
            agent = self.agent_pool.get(self.runtime.agent_engine)
            stream = agent.run(
                user=self.user,
                input=TextMessage(data=text),
                streaming=True,
                conversation_id=self.conversation_id,
                **self.runtime.agent_config,
            )
            pending_sentence = ""

            async for raw_chunk in stream:
                if response_id != self.current_response_id:
                    return

                event, data = parse_event_stream_message(raw_chunk)
                if not event:
                    continue
                if event == EVENT_TYPE.CONVERSATION_ID:
                    self.conversation_id = data
                    await self.send_json({"type": "conversation_id", "conversation_id": data})
                    continue
                if event == EVENT_TYPE.MESSAGE_ID:
                    await self.send_json({"type": "message_id", "message_id": data})
                    continue
                if event == EVENT_TYPE.THINK:
                    await self.send_json({"type": "assistant_think", "text": data})
                    continue
                if event == EVENT_TYPE.TEXT:
                    if not pending_sentence:
                        logger.info("[RealtimeVoice] Agent first text chunk received")
                    await self.send_json({"type": "assistant_text", "text": data})
                    pending_sentence += data
                    ready_sentences, pending_sentence = extract_ready_sentences(pending_sentence)
                    for sentence in ready_sentences:
                        await self.tts_queue.put((response_id, sentence))
                    continue
                if event == EVENT_TYPE.ERROR:
                    await self.send_json({"type": "error", "message": data})
                    return
                if event == EVENT_TYPE.DONE:
                    break

            if pending_sentence.strip():
                await self.tts_queue.put((response_id, pending_sentence.strip()))
            await self.tts_queue.put((response_id, None))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error(f"[RealtimeVoice] Agent pipeline error: {exc}", exc_info=True)
            self.responding = False
            self.listening_enabled = True
            self.finalizing_utterance = False
            self.pending_partial_text = ""
            self.vad.reset()
            if self.asr_session is not None:
                await self.asr_session.restart_sentence()
            await self.send_json({"type": "error", "message": str(exc)})

    async def _tts_worker(self):
        while True:
            response_id, sentence = await self.tts_queue.get()
            try:
                if response_id != self.current_response_id:
                    continue
                if sentence is None:
                    if response_id == self.current_response_id:
                        self.responding = False
                        self.listening_enabled = True
                        self.finalizing_utterance = False
                        self.pending_partial_text = ""
                        self.vad.reset()
                        if self.asr_session is not None:
                            await self.asr_session.restart_sentence()
                    await self.send_json({"type": "assistant_done"})
                    continue

                tts_engine = self.engine_pool.getEngine(ENGINE_TYPE.TTS, self.runtime.tts_engine)
                audio_message: AudioMessage = await tts_engine.run(
                    user=self.user,
                    input=TextMessage(data=sentence),
                    **self.runtime.tts_config,
                )
                audio_data = audio_message.data
                if not audio_data:
                    continue

                if isinstance(audio_data, bytes):
                    audio_bytes = audio_data
                else:
                    audio_bytes = base64.b64decode(str(audio_data))

                if response_id == self.current_response_id:
                    await self.websocket.send_bytes(audio_bytes)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.error(f"[RealtimeVoice] TTS worker error: {exc}", exc_info=True)
                await self.send_json({"type": "error", "message": str(exc)})
            finally:
                self.tts_queue.task_done()

    async def close(self):
        if self.closed:
            return
        self.closed = True
        await self.interrupt(notify=False)
        if self.tts_worker_task is not None:
            self.tts_worker_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.tts_worker_task
            self.tts_worker_task = None
        if self.asr_reader_task is not None:
            self.asr_reader_task.cancel()
            with suppress(asyncio.CancelledError):
                await self.asr_reader_task
            self.asr_reader_task = None
        if self.asr_session is not None:
            await self.asr_session.close()
            self.asr_session = None


async def run_realtime_voice_dialogue(websocket: WebSocket, user: UserDesc):
    await websocket.accept()
    session = RealtimeVoiceDialogueSession(websocket=websocket, user=user)
    await session.initialize()
    try:
        while True:
            message = await websocket.receive()
            message_type = message.get("type")
            if message_type == "websocket.disconnect":
                break

            text = message.get("text")
            if text is not None:
                try:
                    payload = json.loads(text)
                except json.JSONDecodeError:
                    await session.send_json({"type": "error", "message": "Invalid control message"})
                    continue
                await session.handle_control_message(payload)
                continue

            data = message.get("bytes")
            if data is not None:
                await session.handle_audio_chunk(data)
    except WebSocketDisconnect:
        pass
    finally:
        await session.close()
