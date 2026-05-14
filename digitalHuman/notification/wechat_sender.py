import logging

logger = logging.getLogger(__name__)


class WechatSender:
    """
    企业微信机器人 Webhook 发送器
    
    config_json 格式:
    {
        "webhook_url": "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=your_key",
        "mentioned_list": ["@all"]   (可选，@某人，填写成员账号或 "@all" 通知所有人)
    }
    """

    async def send(self, contact: str, message: str, config: dict) -> None:
        """
        发送企业微信群机器人消息

        Args:
            contact: 忽略（企业微信机器人是群通知，不需要单独联系方式）
            message: 消息正文
            config: 企业微信机器人配置
        
        Raises:
            ValueError: 缺少必要配置项
            RuntimeError: 企业微信 API 返回错误
        """
        webhook_url = config.get("webhook_url", "").strip()
        if not webhook_url:
            msg = "WechatSender: missing required config key: webhook_url"
            logger.error(msg)
            raise ValueError(msg)

        try:
            import httpx
        except ImportError:
            raise ImportError("WechatSender: httpx not installed. Run: pip install httpx")

        # 构建 mentioned_list（可选，用于 @ 群成员）
        mentioned_list = config.get("mentioned_list", [])

        # 构建消息体
        payload = {
            "msgtype": "text",
            "text": {
                "content": message
            }
        }
        if mentioned_list:
            payload["text"]["mentioned_list"] = mentioned_list

        logger.info(
            f"WechatSender: posting to wechat webhook "
            f"(message_len={len(message)}, mentioned={mentioned_list})"
        )

        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                webhook_url,
                json=payload,
                headers={"Content-Type": "application/json"}
            )
            resp.raise_for_status()
            result = resp.json()

        errcode = result.get("errcode", -1)
        if errcode != 0:
            err_msg = (
                f"WechatSender: API error: errcode={errcode}, "
                f"errmsg={result.get('errmsg', 'unknown')}"
            )
            logger.error(err_msg)
            raise RuntimeError(err_msg)

        logger.info(f"WechatSender: message sent successfully (errcode=0)")
