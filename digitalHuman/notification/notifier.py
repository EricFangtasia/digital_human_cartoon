import logging
import asyncio
from typing import Optional

logger = logging.getLogger(__name__)


class Notifier:
    """多渠道通知调度器"""
    _instance = None

    def __init__(self):
        self.channels = {}
        self._initialized = False

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def initialize(self):
        """初始化所有通知渠道"""
        from .sms_sender import SmsSender
        from .email_sender import EmailSender
        from .dingtalk_sender import DingtalkSender
        from .wechat_sender import WechatSender

        self.channels = {
            "sms": SmsSender(),
            "email": EmailSender(),
            "dingtalk": DingtalkSender(),
            "wechat": WechatSender()
        }
        self._initialized = True
        logger.info("Notifier initialized with channels: sms, email, dingtalk, wechat")

    async def send_crisis_alert(self, user_info: dict, guardians: list, severity: str, description: str):
        """
        发送危机告警通知

        Args:
            user_info: 用户信息 {"name": "xxx", "age": 18, ...}
            guardians: 监护人列表 [{"name": "xxx", "phone": "xxx", "email": "xxx", "dingtalk": "xxx", "wechat": "xxx"}, ...]
            severity: 严重程度 (低/中/高/紧急)
            description: 危机描述
        """
        if not self._initialized:
            logger.warning("Notifier not initialized")
            return {"success": False, "error": "Notifier not initialized"}

        # 获取通知配置（从数据库读取哪些渠道启用）
        enabled_channels = await self._get_enabled_channels()

        # 构建通知内容
        message = self._build_message(user_info, severity, description)

        # 并发向所有监护人发送
        results = []
        tasks = []

        # 群机器人类渠道（contact 可为空），只需发一次，不必对每个监护人重复发送
        point_to_point_channels = {"sms", "email"}
        broadcast_sent = set()  # 记录已发送的广播渠道

        for guardian in guardians:
            for channel_name, sender in self.channels.items():
                if channel_name not in enabled_channels:
                    continue

                # 获取该监护人的该渠道联系方式
                contact = self._get_contact(guardian, channel_name)

                if channel_name in point_to_point_channels:
                    # 点对点渠道：必须有联系方式
                    if not contact:
                        continue
                else:
                    # 广播渠道（钉钉群机器人等）：每个渠道只发一次
                    if channel_name in broadcast_sent:
                        continue
                    broadcast_sent.add(channel_name)

                config = enabled_channels[channel_name]
                tasks.append(self._send_with_retry(
                    sender, contact or "", message, config,
                    guardian["name"], channel_name
                ))

        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)

        success_count = sum(1 for r in results if r is True)
        fail_count = len(tasks) - success_count

        notified = [ch for ch in enabled_channels.keys()]
        logger.info(f"Crisis alert sent: {success_count} success, {fail_count} failed, channels: {notified}")

        return {
            "success": success_count > 0,
            "notified_channels": notified,
            "success_count": success_count,
            "fail_count": fail_count
        }

    async def _send_with_retry(self, sender, contact, message, config, guardian_name, channel_name, retries=2):
        """带重试的发送"""
        for attempt in range(retries + 1):
            try:
                await sender.send(contact, message, config)
                logger.info(f"Sent {channel_name} to {guardian_name} ({contact})")
                return True
            except Exception as e:
                logger.error(f"Failed to send {channel_name} to {guardian_name}, attempt {attempt + 1}: {e}")
                if attempt < retries:
                    await asyncio.sleep(1)
        return False

    async def _get_enabled_channels(self) -> dict:
        """从数据库读取启用的通知渠道及其配置"""
        try:
            import aiomysql
            import json
            from digitalHuman.database import get_db
            pool = await get_db()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        "SELECT channel, config_json FROM notification_config WHERE enabled = 1"
                    )
                    rows = await cur.fetchall()

            channels = {}
            for row in rows:
                config_val = row["config_json"]
                channels[row["channel"]] = json.loads(config_val) if config_val else {}
            return channels
        except Exception as e:
            logger.error(f"Failed to get notification config: {e}")
            return {}

    def _get_contact(self, guardian: dict, channel: str) -> Optional[str]:
        """获取监护人的指定渠道联系方式"""
        mapping = {
            "sms": "phone",
            "email": "email",
            "dingtalk": "dingtalk",
            "wechat": "wechat"
        }
        field = mapping.get(channel)
        return guardian.get(field) if field else None

    def _build_message(self, user_info: dict, severity: str, description: str) -> str:
        """构建通知消息"""
        severity_emoji = {"低": "⚠️", "中": "🟡", "高": "🔴", "紧急": "🚨"}
        emoji = severity_emoji.get(severity, "⚠️")

        return (
            f"{emoji} 心理疗愈系统告警\n"
            f"━━━━━━━━━━━━━━━\n"
            f"用户: {user_info.get('name', '未知')}\n"
            f"年龄: {user_info.get('age', '未知')}\n"
            f"风险等级: {severity}\n"
            f"详情: {description}\n"
            f"━━━━━━━━━━━━━━━\n"
            f"请及时关注该用户的心理健康状况。\n"
            f"全国24小时心理援助热线: 400-161-9995"
        )
