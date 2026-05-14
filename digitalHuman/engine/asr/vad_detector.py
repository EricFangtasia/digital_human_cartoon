# -*- coding: utf-8 -*-
"""
Realtime VAD for duplex voice dialogue.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass, field


@dataclass
class VADDecision:
    has_speech: bool
    speech_started: bool
    speech_ended: bool
    forward_chunks: tuple[bytes, ...] = field(default_factory=tuple)


class VADDetector:
    """
    Lightweight VAD wrapper.

    Prefers WebRTC VAD when available and falls back to RMS energy gating.
    """

    def __init__(
        self,
        sample_rate: int = 16000,
        silence_duration: float = 0.35,
        chunk_duration_ms: int = 20,
        min_speech_duration: float = 0.08,
        energy_threshold: float = 0.010,
        pre_roll_chunks: int = 12,
    ):
        self.sample_rate = sample_rate
        self.chunk_duration_ms = chunk_duration_ms
        self.silence_threshold = max(1, int(math.ceil((silence_duration * 1000) / chunk_duration_ms)))
        self.min_speech_chunks = max(1, int(math.ceil((min_speech_duration * 1000) / chunk_duration_ms)))
        self.energy_threshold = energy_threshold
        self.pre_roll_chunks = max(1, pre_roll_chunks)
        self.vad = None
        self.vad_type = "energy"
        self._load_vad_model()
        self.reset()

    def _load_vad_model(self):
        try:
            import webrtcvad  # type: ignore

            self.vad = webrtcvad.Vad(2)
            self.vad_type = "webrtc"
        except Exception:
            self.vad = None
            self.vad_type = "energy"

    def reset(self):
        self.is_speaking = False
        self.silence_count = 0
        self.speech_count = 0
        self.pre_buffer: deque[bytes] = deque(maxlen=self.pre_roll_chunks)

    def _energy_is_speech(self, audio_chunk: bytes) -> bool:
        if not audio_chunk:
            return False

        sample_count = len(audio_chunk) // 2
        if sample_count <= 0:
            return False

        sum_squares = 0.0
        for index in range(0, len(audio_chunk), 2):
            sample = int.from_bytes(audio_chunk[index:index + 2], byteorder="little", signed=True)
            normalized = sample / 32768.0
            sum_squares += normalized * normalized
        rms = math.sqrt(sum_squares / sample_count)
        return rms >= self.energy_threshold

    def is_speech(self, audio_chunk: bytes) -> bool:
        if self.vad_type == "webrtc" and self.vad is not None:
            try:
                return bool(self.vad.is_speech(audio_chunk, self.sample_rate))
            except Exception:
                return self._energy_is_speech(audio_chunk)
        return self._energy_is_speech(audio_chunk)

    def process_chunk(self, audio_chunk: bytes) -> VADDecision:
        chunk_bytes = bytes(audio_chunk)
        self.pre_buffer.append(chunk_bytes)
        has_speech = self.is_speech(audio_chunk)
        speech_started = False
        speech_ended = False
        forward_chunks: list[bytes] = []

        if has_speech:
            self.speech_count += 1
            self.silence_count = 0

            if not self.is_speaking and self.speech_count >= self.min_speech_chunks:
                self.is_speaking = True
                speech_started = True
                forward_chunks.extend(self.pre_buffer)
            elif self.is_speaking:
                forward_chunks.append(chunk_bytes)
        else:
            if self.is_speaking:
                self.silence_count += 1
                if self.silence_count < self.silence_threshold:
                    forward_chunks.append(chunk_bytes)
                else:
                    speech_ended = True
                    self.is_speaking = False
                    self.silence_count = 0
                    self.speech_count = 0
                    self.pre_buffer.clear()
            else:
                self.speech_count = max(0, self.speech_count - 1)
                self.pre_buffer.clear()

        return VADDecision(
            has_speech=has_speech,
            speech_started=speech_started,
            speech_ended=speech_ended,
            forward_chunks=tuple(forward_chunks),
        )
