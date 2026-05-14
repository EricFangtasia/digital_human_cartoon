import logging
import asyncio
import json
import os
import httpx
from typing import Optional

logger = logging.getLogger(__name__)

# 危机关键词（第一层快速筛查）
CRISIS_KEYWORDS = [
    # 自杀相关
    "不想活", "自杀", "想死", "活着没意义", "结束生命", "了结", "跳楼", "割腕",
    "吃药自杀", "上吊", "不如死了", "死了算了", "去死", "活不下去", "不想活了",
    "人间不值得", "这个世界不需要我", "没有我会更好", "我消失了",
    # 重度抑郁相关
    "活着好累", "生不如死", "行尸走肉", "没有希望", "绝望", "看不到未来",
    "每天都很痛苦", "痛不欲生", "崩溃了", "撑不住了", "受不了了",
    # 自伤相关
    "伤害自己", "划手腕", "自残", "打自己", "惩罚自己",
    # 对他人暴力/极端攻击相关
    "要杀人", "我要杀人", "想杀人", "杀了他", "杀了她", "杀了你", "弄死他", "弄死她", "弄死你",
    "打死他", "打死她", "打死你", "砍人", "捅人", "砍死", "捅死", "拿刀砍", "拿刀捅",
    "伤害别人", "伤害他人", "伤害任何人", "攻击别人", "攻击他人", "报复社会", "同归于尽",
    "炸学校", "炸公司", "放火烧", "我要报复", "我要伤害"
]

VIOLENCE_TO_OTHERS_KEYWORDS = [
    "要杀人", "我要杀人", "想杀人", "杀了他", "杀了她", "杀了你", "弄死他", "弄死她", "弄死你",
    "打死他", "打死她", "打死你", "砍人", "捅人", "砍死", "捅死", "拿刀砍", "拿刀捅",
    "伤害别人", "伤害他人", "伤害任何人", "攻击别人", "攻击他人", "报复社会", "同归于尽",
    "炸学校", "炸公司", "放火烧", "我要报复", "我要伤害"
]

# LLM二次分析prompt
CRISIS_ANALYSIS_PROMPT = """你是一个专业的心理危机评估专家。请分析以下对话内容，
判断用户是否存在心理危机风险。
用户消息: "{user_message}"

请严格按照以下JSON格式返回评估结果，不要输出其他内容：
{{
    "has_crisis": true/false,
    "severity": "低/中/高/紧急",
    "category": "自杀倾向/重度抑郁/自伤行为/伤害他人风险/极端暴力风险/其他",
    "description": "简要描述危机情况",
    "suggested_response": "建议的安抚回复（温暖、专业、引导求助）"
}}

评估标准：
- 紧急：明确表达自杀计划、正在实施自杀/自伤行为，或明确表示即将伤害/杀害他人、实施报复社会/持械攻击/纵火爆炸等行为
- 高：表达强烈的自杀意念、极度绝望，或表达明确的杀人、伤害他人、攻击他人、报复社会等暴力意图
- 中：表达生活无望、持续痛苦但未提及具体自杀计划
- 低：表达消极情绪但尚在可控范围

只输出JSON，不要其他文字。"""


class CrisisDetector:
    """心理危机检测器"""
    _instance = None

    def __init__(self,
                 llm_base_url=None,
                 llm_api_key=None,
                 llm_model=None):
        llm_base_url = llm_base_url or os.getenv("DHC_LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1")
        llm_api_key = llm_api_key or os.getenv("DHC_LONGCAT_API_KEY", "")
        llm_model = llm_model or os.getenv("DHC_LONGCAT_MODEL", "LongCat-Flash-Chat")
        self.llm_base_url = llm_base_url
        self.llm_api_key = llm_api_key
        self.llm_model = llm_model
        # 用户中级危机累计计数 {user_id: count}
        self._medium_crisis_count = {}

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def check(self, user_id: int, user_message: str) -> Optional[dict]:
        """
        检查用户消息是否存在危机

        Returns:
            None: 无危机
            dict: {"severity": "...", "category": "...", "description": "...", "suggested_response": "..."}
        """
        # 第一层：关键词快速筛查
        if not self._keyword_check(user_message):
            return None

        has_violence_to_others = self._violence_to_others_keyword_check(user_message)
        logger.warning(f"Crisis keyword detected for user {user_id}: {user_message[:50]}...")
        # 第二层：LLM深度分析
        analysis = await self._llm_analysis(user_message)
        if has_violence_to_others and (not analysis or not analysis.get("has_crisis")):
            analysis = self._build_violence_to_others_alert(user_message)
        if not analysis or not analysis.get("has_crisis"):
            logger.info(f"LLM analysis: no crisis for user {user_id}")
            return None

        severity = analysis.get("severity", "低")
        if has_violence_to_others and severity in ("低", "中"):
            severity = "高"
            analysis["severity"] = "高"
            analysis["category"] = analysis.get("category") or "伤害他人风险"
            analysis["description"] = analysis.get("description") or f"检测到可能伤害他人的高风险表达: {user_message[:100]}"

        # 中级危机累计逻辑
        if severity == "中":
            self._medium_crisis_count[user_id] = self._medium_crisis_count.get(user_id, 0) + 1
            if self._medium_crisis_count[user_id] >= 3:
                severity = "高"
                analysis["severity"] = "高"
                analysis["description"] += "（中级危机累计3次，升级为高级）"
                self._medium_crisis_count[user_id] = 0
                logger.warning(f"User {user_id} medium crisis escalated to HIGH")

        logger.warning(f"Crisis detected for user {user_id}: severity={severity}")
        return analysis

    async def handle_crisis(self, user_id: int, conversation_id: int, crisis_info: dict):
        """
        处理危机：记录到数据库 + 通知监护人
        仅高/紧急级别触发通知
        """
        severity = crisis_info.get("severity", "低")

        # 1. 记录到数据库
        await self._save_crisis_report(user_id, conversation_id, crisis_info)

        # 2. 高/紧急级别 → 通知监护人
        if severity in ("高", "紧急"):
            await self._notify_guardians(user_id, crisis_info)

    def _keyword_check(self, text: str) -> bool:
        """关键词快速筛查"""
        text_lower = text.lower()
        return any(kw in text_lower for kw in CRISIS_KEYWORDS)

    def _violence_to_others_keyword_check(self, text: str) -> bool:
        """对他人暴力风险关键词快速筛查"""
        text_lower = text.lower()
        return any(kw in text_lower for kw in VIOLENCE_TO_OTHERS_KEYWORDS)

    def _build_violence_to_others_alert(self, user_message: str) -> dict:
        return {
            "has_crisis": True,
            "severity": "高",
            "category": "伤害他人风险",
            "description": f"检测到可能伤害他人或实施极端暴力的高风险表达: {user_message[:100]}",
            "suggested_response": "我听到你提到可能伤害别人，这很危险。请先远离可能造成伤害的物品和现场，立刻联系身边可信任的人；如果有人正处于危险中，请马上拨打当地紧急电话。"
        }

    async def _llm_analysis(self, user_message: str) -> Optional[dict]:
        """调用LLM进行二次分析"""
        prompt = CRISIS_ANALYSIS_PROMPT.format(user_message=user_message)

        try:
            async with httpx.AsyncClient(timeout=15) as client:
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
                        "max_tokens": 300
                    }
                )

                if response.status_code == 200:
                    data = response.json()
                    content = data["choices"][0]["message"]["content"].strip()
                    # 清理markdown代码块
                    if content.startswith("```"):
                        content = content.split("\n", 1)[1]
                        content = content.rsplit("```", 1)[0]
                    return json.loads(content)
        except Exception as e:
            logger.error(f"LLM crisis analysis failed: {e}")
            # 分析失败时，关键词已命中，保守处理返回中级
            return {
                "has_crisis": True,
                "severity": "中",
                "category": "待确认",
                "description": f"关键词命中但LLM分析失败: {user_message[:100]}",
                "suggested_response": "我注意到你说了一些让我担心的话。你现在安全吗？如果你正在经历困难，请拨打24小时心理援助热线 400-161-9995。"
            }
        return None

    async def _save_crisis_report(self, user_id: int, conversation_id: int, crisis_info: dict):
        """保存危机报告到数据库"""
        if not user_id or user_id <= 0:
            logger.warning(f"Skipping crisis report save: invalid user_id={user_id}")
            return
        try:
            import aiomysql
            from digitalHuman.database import get_db
            pool = await get_db()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """INSERT INTO crisis_reports (user_id, conversation_id, severity, description, notified_channels)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (user_id, conversation_id,
                         crisis_info.get("severity"),
                         crisis_info.get("description"),
                         "")
                    )
            logger.info(f"Crisis report saved for user {user_id}")
        except Exception as e:
            logger.error(f"Failed to save crisis report: {e}")

    async def _notify_guardians(self, user_id: int, crisis_info: dict):
        """通知监护人 — 查询用户和监护人信息后委托 Notifier 发送"""
        if not user_id or user_id <= 0:
            logger.warning(f"Skipping guardian notification: invalid user_id={user_id}")
            return
        try:
            import aiomysql
            from digitalHuman.database import get_db

            # 1. 查询用户信息
            pool = await get_db()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        "SELECT id, username, name, age, gender, address FROM users WHERE id = %s",
                        (user_id,)
                    )
                    user_row = await cur.fetchone()
                    if not user_row:
                        logger.error(f"User {user_id} not found for crisis notification")
                        return

                    # 2. 查询该用户的监护人列表
                    await cur.execute(
                        "SELECT id, name, phone, email, relationship, dingtalk, wechat "
                        "FROM guardians WHERE user_id = %s",
                        (user_id,)
                    )
                    guardians = await cur.fetchall()

            if not guardians:
                logger.warning(f"No guardians found for user {user_id}, notifying all super_admins instead")
                # 兜底：查询所有超级管理员，给管理员发通知
                async with pool.acquire() as conn:
                    async with conn.cursor(aiomysql.DictCursor) as cur:
                        await cur.execute(
                            "SELECT id, username, name FROM users WHERE role = 'super_admin'"
                        )
                        admins = await cur.fetchall()
                if not admins:
                    logger.error("No super_admins found either, cannot send crisis notification")
                    return
                # 将管理员构造成监护人格式（无手机/邮件等，使用广播渠道如钉钉）
                guardians = [
                    {"id": a["id"], "name": a["name"], "phone": None,
                     "email": None, "relationship": "管理员",
                     "dingtalk": None, "wechat": None}
                    for a in admins
                ]
                logger.info(f"Notifying {len(guardians)} super_admin(s) as fallback for user {user_id}")

            # 3. 准备参数
            user_info = dict(user_row)
            severity = crisis_info.get("severity", "中")
            description = crisis_info.get("description", crisis_info.get("message", "检测到危机信号"))

            # 4. 确保 Notifier 已初始化
            from digitalHuman.notification import Notifier
            notifier = Notifier.get_instance()
            if not notifier._initialized:
                logger.warning("Notifier not initialized, initializing now...")
                await notifier.initialize()

            result = await notifier.send_crisis_alert(
                user_info=user_info,
                guardians=list(guardians),
                severity=severity,
                description=description
            )
            logger.info(f"Guardian notification result for user {user_id}: {result}")

        except Exception as e:
            logger.error(f"Failed to notify guardians for user {user_id}: {e}", exc_info=True)
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
