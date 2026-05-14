import logging
import time
import hmac
import hashlib
import base64
import urllib.parse

logger = logging.getLogger(__name__)


class DingtalkSender:
    """
    钉钉机器人 Webhook 发送器（支持加签验证）
    
    config_json 格式:
    {
        "webhook_url": "https://oapi.dingtalk.com/robot/send?access_token=your_token",
        "secret": "your_secret_key"   (可选，若配置了加签安全则填写)
    }
    """

    async def send(self, contact: str, message: str, config: dict) -> None:
        """
        发送钉钉群机器人消息

        Args:
            contact: 忽略（钉钉是群通知，不需要单独联系方式）
            message: 消息正文
            config: 钉钉机器人配置
        
        Raises:
            ValueError: 缺少必要配置项
            RuntimeError: 钉钉 API 返回错误
        """
        webhook_url = config.get("webhook_url", "").strip()
        if not webhook_url:
            msg = "DingtalkSender: missing required config key: webhook_url"
            logger.error(msg)
            raise ValueError(msg)

        try:
            import httpx
        except ImportError:
            raise ImportError("DingtalkSender: httpx not installed. Run: pip install httpx")

        # 加签验证（如果配置了 secret）
        secret = config.get("secret", "").strip()
        if secret:
            webhook_url = self._sign_url(webhook_url, secret)

        # 构建消息体
        payload = {
            "msgtype": "text",
            "text": {
                "content": message
            }
        }

        logger.info(f"DingtalkSender: posting to dingtalk webhook (message_len={len(message)})")

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            resp.raise_for_status()
            result = resp.json()

        if result.get("errcode") != 0:
            err_msg = f"DingtalkSender: API error: errcode={result.get('errcode')}, errmsg={result.get('errmsg')}"
            logger.error(err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"DingtalkSender: message sent successfully (errcode=0)")

    def _sign_url(self, webhook_url: str, secret: str) -> str:
        """
        生成带签名的钉钉 Webhook URL

        钉钉加签算法：
        1. timestamp + "\n" + secret 组合字符串
        2. HMAC-SHA256 + Base64 编码
        3. URL 编码追加到 webhook_url
        """
        timestamp = str(round(time.time() * 1000))
        string_to_sign = f"{timestamp}\n{secret}"
        hmac_code = hmac.new(
            secret.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            digestmod=hashlib.sha256
        ).digest()
        sign = urllib.parse.quote_plus(base64.b64encode(hmac_code))
        return f"{webhook_url}&timestamp={timestamp}&sign={sign}"
