import logging
import time
from pymilvus import connections, Collection, FieldSchema, CollectionSchema, DataType, utility

logger = logging.getLogger(__name__)


class MilvusStore:
    COLLECTION_NAME = "user_memories"
    DIMENSION = 768

    def __init__(self, host="192.168.0.97", port=19530, username="root", password="Milvus"):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self._connected = False
        self.collection = None

    async def connect(self):
        """连接 Milvus"""
        try:
            connections.connect(
                alias="default",
                host=self.host,
                port=self.port,
                user=self.username,
                password=self.password
            )
            self._connected = True
            logger.info(f"Connected to Milvus at {self.host}:{self.port}")
            self._ensure_collection()
        except Exception as e:
            logger.error(f"Failed to connect to Milvus: {e}")
            self._connected = False

    def _ensure_collection(self):
        """确保 collection 存在"""
        if utility.has_collection(self.COLLECTION_NAME):
            self.collection = Collection(self.COLLECTION_NAME)
            self.collection.load()
            logger.info(
                f"Collection '{self.COLLECTION_NAME}' loaded, entities: {self.collection.num_entities}"
            )
            return

        fields = [
            FieldSchema(name="id", dtype=DataType.INT64, is_primary=True, auto_id=True),
            FieldSchema(name="user_id", dtype=DataType.INT64),
            FieldSchema(name="memory_text", dtype=DataType.VARCHAR, max_length=2048),
            FieldSchema(name="category", dtype=DataType.VARCHAR, max_length=64),
            FieldSchema(name="created_at", dtype=DataType.INT64),
            FieldSchema(name="embedding", dtype=DataType.FLOAT_VECTOR, dim=self.DIMENSION)
        ]
        schema = CollectionSchema(fields, description="User therapy memories")
        self.collection = Collection(self.COLLECTION_NAME, schema)

        # 创建向量索引
        index_params = {
            "index_type": "IVF_FLAT",
            "metric_type": "IP",  # 内积（归一化后等价余弦相似度）
            "params": {"nlist": 128}
        }
        self.collection.create_index("embedding", index_params)
        self.collection.load()
        logger.info(f"Collection '{self.COLLECTION_NAME}' created with IVF_FLAT index")

    def insert_memory(self, user_id: int, memory_text: str, category: str, embedding: list[float]):
        """插入一条记忆"""
        if not self._connected or self.collection is None:
            logger.warning("Milvus not connected, skip insert")
            return

        data = [
            [user_id],
            [memory_text],
            [category],
            [int(time.time())],
            [embedding]
        ]
        self.collection.insert(data)
        self.collection.flush()
        logger.debug(f"Inserted memory for user {user_id}: {memory_text[:50]}...")

    def search_memories(self, user_id: int, query_embedding: list[float], top_k: int = 5) -> list[dict]:
        """检索用户相关记忆"""
        if not self._connected or self.collection is None:
            logger.warning("Milvus not connected, return empty")
            return []

        search_params = {"metric_type": "IP", "params": {"nprobe": 16}}

        results = self.collection.search(
            data=[query_embedding],
            anns_field="embedding",
            param=search_params,
            limit=top_k,
            expr=f"user_id == {user_id}",
            output_fields=["memory_text", "category", "created_at"]
        )

        memories = []
        for hits in results:
            for hit in hits:
                memories.append({
                    "text": hit.entity.get("memory_text"),
                    "category": hit.entity.get("category"),
                    "created_at": hit.entity.get("created_at"),
                    "score": hit.score
                })

        return memories

    def delete_user_memories(self, user_id: int) -> int:
        """删除指定用户的所有记忆向量，返回删除条数"""
        if not self._connected or self.collection is None:
            logger.warning(f"Milvus not connected, skip delete for user {user_id}")
            return 0
        try:
            expr = f"user_id == {user_id}"
            result = self.collection.delete(expr)
            self.collection.flush()
            count = result.delete_count if hasattr(result, 'delete_count') else 0
            logger.info(f"Deleted {count} memories for user {user_id} from Milvus")
            return count
        except Exception as e:
            logger.error(f"Failed to delete Milvus memories for user {user_id}: {e}")
            return 0

    @property
    def is_connected(self):
        return self._connected
