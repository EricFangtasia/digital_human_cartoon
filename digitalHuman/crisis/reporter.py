import logging
import asyncio
from .detector import CrisisDetector

logger = logging.getLogger(__name__)


class CrisisReporter:
    """危机上报器 - 供Agent在对话流程中调用的简化接口"""

    @staticmethod
    async def check_and_report(user_id: int, conversation_id: int, user_message: str) -> dict:
        """
        检查消息并上报（如有危机）

        Returns:
            {"has_crisis": False} 或
            {"has_crisis": True, "severity": "...", "suggested_response": "..."}
        """
        detector = CrisisDetector.get_instance()

        crisis_info = await detector.check(user_id, user_message)

        if not crisis_info:
            return {"has_crisis": False}

        # 异步处理上报（不阻塞对话）
        if user_id and user_id > 0:
            asyncio.create_task(detector.handle_crisis(user_id, conversation_id, crisis_info))
        else:
            logger.warning("Crisis detected without valid user_id; sending anonymous admin alert")
            asyncio.create_task(detector.handle_anonymous_crisis(crisis_info))

        return {
            "has_crisis": True,
            "severity": crisis_info.get("severity"),
            "suggested_response": crisis_info.get("suggested_response", ""),
            "category": crisis_info.get("category", "")
        }
