# -*- coding: utf-8 -*-
'''
@File    :   cozeTTS.py
@Author  :   一力辉
'''

from ..builder import TTSEngines
from ..engineBase import BaseTTSEngine
import base64
from digitalHuman.protocol import *
from digitalHuman.utils import logger, httpxAsyncClient, checkResponse

__all__ = ["CozeApiTts"]


@TTSEngines.register("Coze")
class CozeApiTts(BaseTTSEngine):
    def setup(self):
        self.url = "https://api.coze.cn/v1/audio/speech"

    async def run(self, input: TextMessage, **kwargs) -> AudioMessage:
        paramters = self.checkParameter(**kwargs)
        token = paramters["token"]
        bot_id = paramters["bot_id"]

        headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

        response = await httpxAsyncClient.get(f"https://api.coze.cn/v1/bots/{bot_id}", headers=headers)
        resp = checkResponse(response, "CozeApiTts", "get bot info")
        voice_id = resp['data']['voice_info_list'][0]['voice_id']

        payload = {
            'input': input.data,
            'voice_id': voice_id,
            'speed': 1.0,
            'response_format': 'mp3',
            'sample_rate': 16000,
        }

        logger.debug(f"[TTS] Engine input: {input.data}")
        response = await httpxAsyncClient.post(self.url, json=payload, headers=headers)
        if response.status_code != 200:
            raise RuntimeError(f"CozeAPI tts api error: {response.text}")

        message = AudioMessage(
            data=base64.b64encode(response.content).decode('utf-8'),
            sampleRate=16000,
            sampleWidth=2,
        )
        return message
