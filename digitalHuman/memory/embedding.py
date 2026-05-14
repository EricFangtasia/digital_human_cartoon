import os
import logging

# 设置 HuggingFace 镜像，避免国内网络超时
os.environ.setdefault('HF_ENDPOINT', 'https://hf-mirror.com')

from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)


class EmbeddingService:
    _instance = None
    _model = None

    MODEL_PATH = "shibing624/text2vec-base-chinese"
    CACHE_DIR = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        "models", "text2vec"
    )
    DIMENSION = 768

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
            cls._instance._load_model()
        return cls._instance

    def _load_model(self):
        logger.info("Loading text2vec-base-chinese model...")
        self._model = SentenceTransformer(self.MODEL_PATH, cache_folder=self.CACHE_DIR)
        logger.info("Embedding model loaded successfully")

    def encode(self, texts: list[str]) -> list[list[float]]:
        """将文本列表转为向量"""
        embeddings = self._model.encode(texts, normalize_embeddings=True)
        return embeddings.tolist()

    def encode_single(self, text: str) -> list[float]:
        """单文本向量化"""
        return self.encode([text])[0]
