# -*- coding: utf-8 -*-
import aiomysql
import logging
import os

logger = logging.getLogger(__name__)

# MySQL 配置
MYSQL_CONFIG = {
    "host": os.getenv("DHC_DB_HOST", "127.0.0.1"),
    "port": int(os.getenv("DHC_DB_PORT", "3306")),
    "user": os.getenv("DHC_DB_USER", "root"),
    "password": os.getenv("DHC_DB_PASSWORD", ""),
    "db": os.getenv("DHC_DB_NAME", "digital_human_cartoon"),
    "charset": "utf8mb4",
    "init_command": f"SET time_zone = '{os.getenv('DHC_DB_TIME_ZONE', '+08:00')}'",
    "autocommit": True,
    "minsize": 2,
    "maxsize": 10
}


class Database:
    _instance = None
    _pool = None

    @classmethod
    async def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
            await cls._instance.initialize()
        return cls._instance

    async def initialize(self):
        """初始化 MySQL 连接池"""
        try:
            self._pool = await aiomysql.create_pool(**MYSQL_CONFIG)
            logger.info(
                f"MySQL connected: {MYSQL_CONFIG['host']}:{MYSQL_CONFIG['port']}/{MYSQL_CONFIG['db']}"
            )
        except Exception as e:
            logger.error(f"MySQL connection failed: {e}")
            raise

    @property
    def pool(self):
        return self._pool

    async def close(self):
        if self._pool:
            self._pool.close()
            await self._pool.wait_closed()


async def get_db():
    """获取数据库连接池"""
    instance = await Database.get_instance()
    return instance.pool
