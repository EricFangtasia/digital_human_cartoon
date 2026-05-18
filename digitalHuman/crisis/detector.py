import asyncio
import json
import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

SELF_HARM_KEYWORDS = [
    "想自杀", "我要自杀", "自杀", "不想活了", "不想活", "想死", "我要去死",
    "活不下去", "结束生命", "了结自己", "跳楼", "上吊", "割腕", "吃药自杀",
    "自残", "伤害自己", "惩罚自己",
]

VIOLENCE_TO_OTHERS_KEYWORDS = [
    "想杀人", "我要杀人", "我想杀人", "杀人", "杀了他", "杀了她", "杀了你",
    "弄死他", "弄死她", "弄死你", "打死他", "打死她", "打死你",
    "砍人", "捅人", "砍死", "捅死", "拿刀砍", "拿刀捅",
    "伤害别人", "伤害他人", "伤害任何人", "攻击别人", "攻击他人",
    "报复社会", "同归于尽", "炸学校", "炸公司", "放火烧", "我要报复",
]

DISTRESS_KEYWORDS = [
    "绝望", "没有希望", "撑不住了", "受不了了", "崩溃了", "痛不欲生",
    "生不如死", "每天都很痛苦", "人间不值得", "这个世界不需要我",
]

ILLEGAL_CRIME_KEYWORDS = [
    "我要抢劫", "我想抢劫", "准备抢劫", "去抢劫",
    "我要绑架", "我想绑架", "准备绑架", "去绑架",
    "我要勒索", "我想勒索", "敲诈勒索", "准备敲诈",
    "我要诈骗", "我想诈骗", "准备诈骗",
    "我要贩毒", "我想贩毒", "准备贩毒", "我要制毒", "我想制毒",
    "我要投毒", "我想投毒", "准备投毒",
    "我要纵火", "我想纵火", "准备纵火", "我要放火", "我想放火",
    "我要爆炸", "我想爆炸", "准备爆炸", "放炸弹", "做炸弹",
    "我要劫持", "我想劫持", "准备劫持", "我要劫机", "我想劫机",
    "恐怖袭击", "破坏公共安全", "危害公共安全",
    "我要袭警", "我想袭警", "准备袭警",
]

HIGH_SEVERITIES = {"高", "紧急"}

CRISIS_ANALYSIS_PROMPT = """你是一个心理危机评估专家。请判断用户消息是否存在自杀、自伤、伤害他人、违法犯罪倾向或极端暴力/公共安全风险。

用户消息: "{user_message}"

只返回 JSON:
{{
  "has_crisis": true/false,
  "severity": "低/中/高/紧急",
  "category": "自杀风险/自伤风险/伤害他人风险/违法犯罪风险/公共安全风险/极端暴力风险/重度抑郁/其他",
  "description": "简要说明",
  "suggested_response": "给数字人的安全回应建议"
}}
"""


class CrisisDetector:
    """Crisis detector and notifier bridge."""

    _instance = None

    def __init__(
        self,
        llm_base_url: Optional[str] = None,
        llm_api_key: Optional[str] = None,
        llm_model: Optional[str] = None,
    ):
        self.llm_base_url = llm_base_url or os.getenv("DHC_LONGCAT_BASE_URL", "https://api.longcat.chat/openai/v1")
        self.llm_api_key = llm_api_key or os.getenv("DHC_LONGCAT_API_KEY", "")
        self.llm_model = llm_model or os.getenv("DHC_LONGCAT_MODEL", "LongCat-Flash-Chat")
        self._medium_crisis_count = {}

    @classmethod
    def get_instance(cls):
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def check(self, user_id: int, user_message: str) -> Optional[dict]:
        direct_alert = self._direct_keyword_alert(user_message)
        if direct_alert:
            logger.warning("Direct crisis keyword detected for user %s: %s", user_id, user_message[:80])
            return direct_alert

        if not self._keyword_check(user_message):
            return None

        logger.warning("Crisis keyword detected for user %s: %s", user_id, user_message[:80])
        analysis = await self._llm_analysis(user_message)
        if not analysis or not analysis.get("has_crisis"):
            logger.info("LLM analysis returned no crisis for user %s", user_id)
            return None

        severity = str(analysis.get("severity") or "中")
        if severity == "中":
            self._medium_crisis_count[user_id] = self._medium_crisis_count.get(user_id, 0) + 1
            if self._medium_crisis_count[user_id] >= 3:
                analysis["severity"] = "高"
                analysis["description"] = f"{analysis.get('description', '')}（中风险累计 3 次，升级为高风险）"
                self._medium_crisis_count[user_id] = 0

        return analysis

    async def handle_crisis(self, user_id: int, conversation_id: int, crisis_info: dict):
        severity = str(crisis_info.get("severity") or "低")
        if user_id and user_id > 0:
            await self._save_crisis_report(user_id, conversation_id, crisis_info)
            if severity in HIGH_SEVERITIES:
                await self._notify_guardians(user_id, crisis_info)
        elif severity in HIGH_SEVERITIES:
            await self.handle_anonymous_crisis(crisis_info)

    async def handle_anonymous_crisis(self, crisis_info: dict):
        severity = str(crisis_info.get("severity") or "高")
        if severity not in HIGH_SEVERITIES:
            return
        try:
            from digitalHuman.notification import Notifier

            notifier = Notifier.get_instance()
            if not notifier._initialized:
                await notifier.initialize()
            await notifier.send_crisis_alert(
                user_info={"id": 0, "username": "anonymous", "name": "未识别用户"},
                guardians=[{"id": 0, "name": "管理员", "phone": None, "email": None, "dingtalk": None, "wechat": None}],
                severity=severity,
                description=crisis_info.get("description", "检测到高危表达"),
            )
        except Exception as exc:
            logger.error("Failed to send anonymous crisis alert: %s", exc, exc_info=True)

    def _direct_keyword_alert(self, text: str) -> Optional[dict]:
        text_lower = (text or "").lower()
        if any(keyword in text_lower for keyword in ILLEGAL_CRIME_KEYWORDS):
            return {
                "has_crisis": True,
                "severity": "高",
                "category": "违法犯罪/公共安全风险",
                "description": f"检测到可能违法犯罪或危害公共安全的高风险表达: {text[:100]}",
                "suggested_response": (
                    "我听到你提到可能违法犯罪或危害公共安全的想法，这很危险。"
                    "请先停下来，远离可能造成伤害或违法后果的物品和现场，立刻联系可信任的人或当地紧急服务。"
                ),
            }
        if any(keyword in text_lower for keyword in VIOLENCE_TO_OTHERS_KEYWORDS):
            return {
                "has_crisis": True,
                "severity": "高",
                "category": "伤害他人风险",
                "description": f"检测到可能伤害他人或实施极端暴力的高风险表达: {text[:100]}",
                "suggested_response": (
                    "我听到你提到可能伤害别人，这很危险。请先远离可能造成伤害的物品和现场，"
                    "立刻联系身边可信任的人；如果有人正处于危险中，请马上拨打当地紧急电话。"
                ),
            }
        if any(keyword in text_lower for keyword in SELF_HARM_KEYWORDS):
            return {
                "has_crisis": True,
                "severity": "高",
                "category": "自伤/自杀风险",
                "description": f"检测到可能自伤或自杀的高风险表达: {text[:100]}",
                "suggested_response": (
                    "我很担心你的安全。请先远离可能伤害自己的物品，马上联系身边可信任的人，"
                    "也可以拨打心理援助热线 400-161-9995 或当地紧急电话。"
                ),
            }
        return None

    def _keyword_check(self, text: str) -> bool:
        text_lower = (text or "").lower()
        keywords = SELF_HARM_KEYWORDS + VIOLENCE_TO_OTHERS_KEYWORDS + ILLEGAL_CRIME_KEYWORDS + DISTRESS_KEYWORDS
        return any(keyword in text_lower for keyword in keywords)

    async def _llm_analysis(self, user_message: str) -> Optional[dict]:
        if not self.llm_api_key:
            return {
                "has_crisis": True,
                "severity": "中",
                "category": "待确认",
                "description": f"关键词命中但未配置 LLM 二次分析: {user_message[:100]}",
                "suggested_response": "我注意到你说了一些让我担心的话。你现在安全吗？如果有危险，请立刻联系可信任的人或紧急服务。",
            }

        prompt = CRISIS_ANALYSIS_PROMPT.format(user_message=user_message)
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.post(
                    f"{self.llm_base_url}/chat/completions",
                    headers={
                        "Authorization": f"Bearer {self.llm_api_key}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": self.llm_model,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.1,
                        "max_tokens": 300,
                    },
                )
                response.raise_for_status()
                content = response.json()["choices"][0]["message"]["content"].strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[1].rsplit("```", 1)[0]
                return json.loads(content)
        except Exception as exc:
            logger.error("LLM crisis analysis failed: %s", exc)
            return {
                "has_crisis": True,
                "severity": "中",
                "category": "待确认",
                "description": f"关键词命中但 LLM 分析失败: {user_message[:100]}",
                "suggested_response": "我注意到你说了一些让我担心的话。你现在安全吗？如果有危险，请立刻联系可信任的人或紧急服务。",
            }

    async def _save_crisis_report(self, user_id: int, conversation_id: int, crisis_info: dict):
        if not user_id or user_id <= 0:
            logger.warning("Skipping crisis report save: invalid user_id=%s", user_id)
            return
        try:
            from digitalHuman.database import get_db

            pool = await get_db()
            async with pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(
                        """INSERT INTO crisis_reports (user_id, conversation_id, severity, description, notified_channels)
                           VALUES (%s, %s, %s, %s, %s)""",
                        (
                            user_id,
                            conversation_id,
                            crisis_info.get("severity"),
                            crisis_info.get("description"),
                            "",
                        ),
                    )
            logger.info("Crisis report saved for user %s", user_id)
        except Exception as exc:
            logger.error("Failed to save crisis report: %s", exc, exc_info=True)

    async def _notify_guardians(self, user_id: int, crisis_info: dict):
        if not user_id or user_id <= 0:
            await self.handle_anonymous_crisis(crisis_info)
            return
        try:
            import aiomysql
            from digitalHuman.database import get_db
            from digitalHuman.notification import Notifier

            pool = await get_db()
            async with pool.acquire() as conn:
                async with conn.cursor(aiomysql.DictCursor) as cur:
                    await cur.execute(
                        "SELECT id, username, name, age, gender, address FROM users WHERE id = %s",
                        (user_id,),
                    )
                    user_row = await cur.fetchone()
                    if not user_row:
                        logger.warning("User %s not found for crisis notification; sending anonymous alert", user_id)
                        await self.handle_anonymous_crisis(crisis_info)
                        return

                    await cur.execute(
                        "SELECT id, name, phone, email, dingtalk, wechat FROM guardians WHERE user_id = %s",
                        (user_id,),
                    )
                    guardians = await cur.fetchall()

                    if not guardians:
                        await cur.execute("SELECT id, username, name FROM users WHERE role = 'super_admin'")
                        admins = await cur.fetchall()
                        guardians = [
                            {
                                "id": admin["id"],
                                "name": admin.get("name") or admin.get("username") or "管理员",
                                "phone": None,
                                "email": None,
                                "dingtalk": None,
                                "wechat": None,
                            }
                            for admin in admins
                        ]

            if not guardians:
                logger.warning("No guardians or super_admins found; sending anonymous broadcast alert")
                await self.handle_anonymous_crisis(crisis_info)
                return

            notifier = Notifier.get_instance()
            if not notifier._initialized:
                await notifier.initialize()
            result = await notifier.send_crisis_alert(
                user_info=dict(user_row),
                guardians=list(guardians),
                severity=crisis_info.get("severity", "高"),
                description=crisis_info.get("description", "检测到高危表达"),
            )
            logger.info("Guardian notification result for user %s: %s", user_id, result)
        except Exception as exc:
            logger.error("Failed to notify guardians for user %s: %s", user_id, exc, exc_info=True)
