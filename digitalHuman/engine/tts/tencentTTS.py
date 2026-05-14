# -*- coding: utf-8 -*-
'''
@File    :   tencentTTS.py
@Author  :   一力辉
'''

from ..builder import TTSEngines
from ..engineBase import BaseTTSEngine
import hashlib
import hmac
import time
import json
from uuid import uuid4
from datetime import datetime, timezone
from typing import Tuple, Dict, List, Optional
from decimal import Decimal
from digitalHuman.protocol import *
from digitalHuman.utils import logger, httpxAsyncClient
from pydantic import BaseModel

__all__ = ["TencentApiTts"]

MAX_INPUT_LENGTH = 150

class TencentVoiceEmotion(StrEnum):
    NEUTRAL = "neutral"
    SAD = "sad"
    HAPPY = "happy"
    ANGRY = "angry"
    FEAR = "fear"
    SAJIAO = "sajiao"
    AMAZE = "amaze"
    DISGUSTED = "disgusted"
    PEACEFUL = "peaceful"

class TencentVoiceDesc(BaseModel):
    id: int
    name: str
    gender: GENDER_TYPE
    language: str
    multi_emotional: bool

VOICE_LIST = [
    TencentVoiceDesc(id=501000, name="智斌", gender=GENDER_TYPE.MALE, language="中文", multi_emotional=False),
    TencentVoiceDesc(id=501001, name="智兰", gender=GENDER_TYPE.FEMALE, language="中文", multi_emotional=False),
    TencentVoiceDesc(id=501004, name="月华", gender=GENDER_TYPE.FEMALE, language="中文", multi_emotional=False),
    TencentVoiceDesc(id=601000, name="爱小溪", gender=GENDER_TYPE.FEMALE, language="中文", multi_emotional=True),
    TencentVoiceDesc(id=601001, name="爱小洛", gender=GENDER_TYPE.FEMALE, language="中文", multi_emotional=True),
    TencentVoiceDesc(id=601002, name="爱小辰", gender=GENDER_TYPE.MALE, language="中文", multi_emotional=True),
]

class TencentCloudApiKey(BaseModel):
    secret_id: str
    secret_key: str

def findVoice(name: str) -> Optional[TencentVoiceDesc]:
    for voice in VOICE_LIST:
        if voice.name == name:
            return voice
    return None

def sign(key, msg: str):
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()

@TTSEngines.register("Tencent-API")
class TencentApiTts(BaseTTSEngine): 
    def setup(self):
        self._url = "https://tts.tencentcloudapi.com"
    
    def _buildRequest(self, input: TextMessage, tencentApiKey: TencentCloudApiKey, voice: str, volume: float, speed: float, emotionCategory: str = TencentVoiceEmotion.NEUTRAL) -> Tuple[Dict, str]:
        service = "tts"
        host = "tts.tencentcloudapi.com"
        version = "2019-08-23"
        action = "TextToVoice"
        algorithm = "TC3-HMAC-SHA256"
        timestamp = int(time.time())
        date = datetime.fromtimestamp(timestamp, timezone.utc).strftime("%Y-%m-%d")
        tencentVoice = findVoice(voice)
        if not tencentVoice:
            raise ValueError("voice not found")
        params = {
            "Text": input.data,
            "SessionId": str(uuid4()),
            "VoiceType": tencentVoice.id,
            "Codec": "mp3",
            "Volume": volume,
            "Speed": speed,
            "EmotionCategory": emotionCategory
        }
        payload = json.dumps(params)
        http_request_method = "POST"
        canonical_uri = "/"
        canonical_querystring = ""
        ct = "application/json; charset=utf-8"
        canonical_headers = "content-type:%s\nhost:%s\nx-tc-action:%s\n" % (ct, host, action.lower())
        signed_headers = "content-type;host;x-tc-action"
        hashed_request_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        canonical_request = (http_request_method + "\n" + canonical_uri + "\n" + canonical_querystring + "\n" +
                            canonical_headers + "\n" + signed_headers + "\n" + hashed_request_payload)
        credential_scope = date + "/" + service + "/" + "tc3_request"
        hashed_canonical_request = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest()
        string_to_sign = (algorithm + "\n" + str(timestamp) + "\n" + credential_scope + "\n" + hashed_canonical_request)
        secret_date = sign(("TC3" + tencentApiKey.secret_key).encode("utf-8"), date)
        secret_service = sign(secret_date, service)
        secret_signing = sign(secret_service, "tc3_request")
        signature = hmac.new(secret_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        authorization = (algorithm + " " + "Credential=" + tencentApiKey.secret_id + "/" + credential_scope + ", " +
                        "SignedHeaders=" + signed_headers + ", " + "Signature=" + signature)
        headers = {
            "Authorization": authorization,
            "Content-Type": "application/json; charset=utf-8",
            "Host": host,
            "X-TC-Action": action,
            "X-TC-Timestamp": str(timestamp),
            "X-TC-Version": version
        }
        return (headers, payload)

    async def voices(self, **kwargs) -> List[VoiceDesc]:
        return [VoiceDesc(name=v.name, gender=v.gender) for v in VOICE_LIST]
    
    async def run(self, input: TextMessage, **kwargs) -> AudioMessage:
        paramters = self.checkParameter(**kwargs)
        voice = paramters["voice"]
        speed = paramters["speed"]
        volume = paramters["volume"]
        SECRECT_ID = paramters["secret_id"]
        SECRECT_KEY = paramters["secret_key"]
        tencentCloudApiKey = TencentCloudApiKey(secret_id=SECRECT_ID, secret_key=SECRECT_KEY)
        headers, payload = self._buildRequest(input, tencentCloudApiKey, voice, volume, speed) 
        logger.debug(f"[TTS] Engine input: {input.data}")
        response = await httpxAsyncClient.post(self._url, headers=headers, data=payload)
        if response.status_code != 200:
            raise RuntimeError(f"Builtin tts api error: {response.status_code}")
        audio = response.json()["Response"]["Audio"]
        message = AudioMessage(
            data=audio,
            sampleRate=16000,
            sampleWidth=2,
        )
        return message
