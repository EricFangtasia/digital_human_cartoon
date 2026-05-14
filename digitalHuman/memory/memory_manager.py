import logging
import asyncio
import json
import os
import httpx

logger = logging.getLogger(__name__)

# 记忆提取的 prompt
MEMORY_EXTRACT_PROMPT = """请从以下对话中提取值得记住的关键信息。只提取与用户个人情况、情感状态、重要事件、偏好相关的信息。

对话内容：
用户: {user_message}
助手: {assistant_message}

请以JSON数组格式返回，每条记忆包含text和category字段。category取值: emotion(情感状态), event(重要事件), preference(偏好习惯), relation(人际关系), health(健康状况)。
如果没有值得记忆的信息，返回空数组 []。

示例输出:
[{{"text": "用户最近因为工作压力大经常失眠", "category": "health"}}, {{"text": "用户养了一只叫小橘的猫", "category": "preference"}}]

只输出JSON，不要其他文字。"""


class MemoryManager:
    """长记忆管理器"""

    def __init__(
        self,
        milvus_host=None,
        milvus_port=None,
        milvus_user=None,
        milvus_password=None,
        llm_base_url=None,
        llm_api_key=None,
        llm_model=None
    ):
        milvus_host = milvus_host or os.getenv("DHC_MILVUS_HOST", "127.0.0.1")
        milvus_port = int(milvus_port or os.getenv("DHC_MILVUS_PORT", "19530"))
        milvus_user = milvus_user or os.getenv("DHC_MILVUS_USER", "root")
        milvus_password = milvus_password or os.getenv("DHC_MILVUS_PASSWORD", "")
        llm_base_url = llm_base_url or os.getenv("DHC_LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1")
        llm_api_key = llm_api_key or os.getenv("DHC_LONGCAT_API_KEY", "")
        llm_model = llm_model or os.getenv("DHC_LONGCAT_MODEL", "LongCat-Flash-Chat")
        self.llm_base_url = llm_base_url
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model

        from .milvus_store import MilvusStore
        self.store = MilvusStore(milvus_host, milvus_port, milvus_user, milvus_password)
        self.embedding_service = None  # 延迟加载
        self._initialized = False

    async def initialize(self):
        """初始化连接"""
        try:
            await self.store.connect()
            self._initialized = True
            logger.info("MemoryManager initialized successfully")
        except Exception as e:
            logger.error(f"MemoryManager initialization failed: {e}")
            self._initialized = False

    def _get_embedding_service(self):
        """延迟加载 embedding 服务"""
        if self.embedding_service is None:
            from .embedding import EmbeddingService
            self.embedding_service = EmbeddingService.get_instance()
        return self.embedding_service

    async def extract_and_store(self, user_id: int, user_message: str, assistant_message: str):
        """从对话中提取记忆并存储"""
        if not self._initialized:
            return

        try:
            # 1. 调用 LLM 提取记忆点
            memories = await self._extract_memories(user_message, assistant_message)
            if not memories:
                return

            # 2. 向量化并存储
            emb_service = await asyncio.to_thread(self._get_embedding_service)
            for mem in memories:
                text = mem.get("text", "")
                category = mem.get("category", "general")
                if text:
                    embedding = await asyncio.to_thread(emb_service.encode_single, text)
                    await asyncio.to_thread(
                        self.store.insert_memory, user_id, text, category, embedding
                    )

            logger.info(f"Stored {len(memories)} memories for user {user_id}")
        except Exception as e:
            logger.error(f"Memory extraction/storage failed: {e}")

    async def recall(self, user_id: int, current_topic: str, top_k: int = 5) -> list[dict]:
        """根据当前话题检索相关记忆"""
        if not self._initialized or not self.store.is_connected:
            return []

        try:
            emb_service = await asyncio.to_thread(self._get_embedding_service)
            query_embedding = await asyncio.to_thread(emb_service.encode_single, current_topic)
            memories = await asyncio.to_thread(
                self.store.search_memories, user_id, query_embedding, top_k
            )
            return memories
        except Exception as e:
            logger.error(f"Memory recall failed: {e}")
            return []

    def format_memories_for_prompt(self, memories: list[dict]) -> str:
        """将记忆格式化为 prompt 可用的文本"""
        if not memories:
            return ""

        lines = ["[历史记忆]以下是你对这位用户的了解："]
        for mem in memories:
            lines.append(f"- {mem['text']}")
        return "\n".join(lines)

    async def _extract_memories(self, user_message: str, assistant_message: str) -> list[dict]:
        """调用 LLM 提取记忆"""
        prompt = MEMORY_EXTRACT_PROMPT.format(
            user_message=user_message,
            assistant_message=assistant_message
        )

        try:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    f"{self.llm_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.llm_api_key}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.llm_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 500
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    # 清理可能的 markdown 代码块
                    if content.startswith("```"):
                        content = content.split("\n", 1)[1]
                        content = content.rsplit("```", 1)[0]
                    memories = json.loads(content)
                    if isinstance(memories, list):
                        return memories
                return []
        except Exception as e:
            logger.error(f"LLM memory extraction failed: {e}")
            return []

    async def cleanup(self):
        """清理资源"""
        self._initialized = False
