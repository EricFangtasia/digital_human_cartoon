# -*- coding: utf-8 -*-
'''
@File    :   azureSpeechASR.py
@Author  :   Codex
'''

from ..builder import ASREngines
from ..engineBase import BaseASREngine
import base64
from urllib.parse import urlencode
from digitalHuman.protocol import AudioMessage, TextMessage, AUDIO_TYPE
from digitalHuman.utils import logger, httpxAsyncClient, mp3ToWav

__all__ = ["AzureSpeechAsr"]


@ASREngines.register("Azure-Speech")
class AzureSpeechAsr(BaseASREngine):
    async def run(self, input: AudioMessage, **kwargs) -> TextMessage:
        paramters = self.checkParameter(**kwargs)
        speech_key = str(paramters.get("speech_key", "")).strip()
        speech_region = str(paramters.get("speech_region", "")).strip()
        language = str(paramters.get("language", "zh-CN")).strip() or "zh-CN"
        response_format = str(paramters.get("response_format", "simple")).strip() or "simple"
        profanity = str(paramters.get("profanity", "raw")).strip() or "raw"

        if not speech_key:
            raise RuntimeError("Azure Speech missing parameter: speech_key")
        if not speech_region:
            raise RuntimeError("Azure Speech missing parameter: speech_region")

        audio_data = input.data
        if isinstance(audio_data, str):
            audio_data = base64.b64decode(audio_data)

        if input.type == AUDIO_TYPE.MP3:
            audio_data = mp3ToWav(audio_data)

        query = urlencode({
            "language": language,
            "format": response_format,
            "profanity": profanity,
        })
        url = f"https://{speech_region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?{query}"
        headers = {
            "Ocp-Apim-Subscription-Key": speech_key,
            "Content-Type": "audio/wav",
            "Accept": "application/json",
        }

        response = await httpxAsyncClient.post(url, headers=headers, content=audio_data)
        if response.status_code != 200:
            raise RuntimeError(f"Azure Speech API error: {response.status_code} {response.text}")

        result = response.json()
        logger.debug(f"[ASR] Azure Speech response: {result}")

        text = ""
        if isinstance(result, dict):
            text = result.get("DisplayText", "") or result.get("Display", "")
            if not text and isinstance(result.get("NBest"), list) and len(result["NBest"]) > 0:
                text = result["NBest"][0].get("Display", "") or result["NBest"][0].get("Lexical", "")

        return TextMessage(data=text.strip())
