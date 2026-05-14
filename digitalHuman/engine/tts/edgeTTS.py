# -*- coding: utf-8 -*-
'''
@File    :   edgeTTS.py
@Author  :   一力辉 
'''

from ..builder import TTSEngines
from ..engineBase import BaseTTSEngine
import edge_tts
import base64
from typing import List
from digitalHuman.protocol import *
from digitalHuman.utils import logger, mp3ToWav

__all__ = ["EdgeApiTts"]

VOICE_LIST = [
    VoiceDesc(name="zh-HK-HiuGaaiNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-HK-HiuMaanNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-HK-WanLungNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-CN-XiaoxiaoNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-CN-XiaoyiNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-CN-YunjianNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-CN-YunxiNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-CN-YunxiaNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-CN-YunyangNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-CN-liaoning-XiaobeiNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-TW-HsiaoChenNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-TW-YunJheNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="zh-TW-HsiaoYuNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="zh-CN-shaanxi-XiaoniNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="en-AU-NatashaNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="en-AU-WilliamNeural", gender=GENDER_TYPE.MALE),
    VoiceDesc(name="en-US-JennyNeural", gender=GENDER_TYPE.FEMALE),
    VoiceDesc(name="en-US-GuyNeural", gender=GENDER_TYPE.MALE),
]

@TTSEngines.register("EdgeTTS")
class EdgeApiTts(BaseTTSEngine):
    async def voices(self, **kwargs) -> List[VoiceDesc]:
        return VOICE_LIST

    async def run(self, input: TextMessage, **kwargs) -> AudioMessage:
        for paramter in self.parameters():
            if paramter.name == "voice":
                voice = paramter.default if paramter.name not in kwargs else kwargs[paramter.name]
            if paramter.name == "rate":
                rate = paramter.default if paramter.name not in kwargs else kwargs[paramter.name]
            if paramter.name == "volume":
                volume = paramter.default if paramter.name not in kwargs else kwargs[paramter.name]
            if paramter.name == "pitch":
                pitch = paramter.default if paramter.name not in kwargs else kwargs[paramter.name]
        if not voice:
            raise KeyError("EdgeTTS voice is required")
        logger.debug(f"[TTS] Engine input[{voice}]: {input.data}")
        rate = "+" + str(rate) + "%" if rate >= 0 else "" + str(rate) + "%"
        volume = "+" + str(volume) + "%" if volume >= 0 else "" + str(volume) + "%"
        pitch = "+" + str(pitch) + "Hz" if pitch >= 0 else "" + str(pitch) + "HZ"
        communicate = edge_tts.Communicate(
            text=input.data, 
            voice=voice,
            rate=rate,
            volume=volume,
            pitch=pitch
        )
        data = b''
        async for message in communicate.stream():
            if message["type"] == "audio":
                data += message["data"]
        message = AudioMessage(
            data=base64.b64encode(data).decode('utf-8'),
            sampleRate=16000,
            sampleWidth=2,
        )
        return message
