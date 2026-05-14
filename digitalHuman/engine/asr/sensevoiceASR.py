# -*- coding: utf-8 -*-
'''
@File    :   sensevoiceASR.py
@Author  :   集成SenseVoice本地ASR
'''

from ..builder import ASREngines
from ..engineBase import BaseASREngine
import io
import base64
import os
import sys
import tempfile
from digitalHuman.protocol import AudioMessage, TextMessage, AUDIO_TYPE
from digitalHuman.utils import logger

__all__ = ["SenseVoiceAsr"]


@ASREngines.register("SenseVoice")
class SenseVoiceAsr(BaseASREngine):
    def setup(self):
        """初始化SenseVoice模型"""
        # 添加agent/asr到Python路径
        asr_path = os.path.join(os.path.dirname(__file__), '../../../../../../asr')
        asr_path = os.path.abspath(asr_path)
        if asr_path not in sys.path:
            sys.path.insert(0, asr_path)
        
        # 获取模型路径配置
        model_path = self.cfg.get('model_path', '/opt/python/test_cuda/asr/SenseVoice/models/SenseVoiceSmall')
        
        logger.info(f"[SenseVoice] Initializing SenseVoice ASR with model path: {model_path}")
        
        # 导入并初始化SenseVoice
        try:
            from modelscope.pipelines import pipeline
            from modelscope.utils.constant import Tasks
            
            self.pipeline = pipeline(
                task=Tasks.auto_speech_recognition,
                model=model_path,
                model_revision='v1.0.0'
            )
            logger.info("[SenseVoice] Model loaded successfully")
        except Exception as e:
            logger.error(f"[SenseVoice] Failed to load model: {e}")
            raise

    def _clean_text(self, text: str) -> str:
        """清理SenseVoice输出的特殊标记和格式符号"""
        import re
        text = re.sub(r'<\|.*?\|>', '', text)
        text = ' '.join(text.split())
        text = text.strip()
        logger.debug(f"[SenseVoice] Cleaned text: {text}")
        return text
    
    async def run(self, input: AudioMessage, **kwargs) -> TextMessage:
        """执行语音识别"""
        try:
            audio_data = input.data
            
            if isinstance(audio_data, str):
                audio_data = base64.b64decode(audio_data)
            
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as tmp_file:
                tmp_file.write(audio_data)
                tmp_path = tmp_file.name
            
            try:
                logger.debug(f"[SenseVoice] Processing audio file: {tmp_path}")
                result = self.pipeline(tmp_path)
                
                if isinstance(result, dict):
                    text = result.get('text', '')
                else:
                    text = str(result)
                
                logger.debug(f"[SenseVoice] Raw recognition result: {text}")
                text = self._clean_text(text)
                message = TextMessage(data=text)
                return message
                
            finally:
                try:
                    os.unlink(tmp_path)
                except Exception as e:
                    logger.warning(f"[SenseVoice] Failed to delete temp file: {e}")
                    
        except Exception as e:
            logger.error(f"[SenseVoice] Recognition failed: {e}")
            return TextMessage(data="")
