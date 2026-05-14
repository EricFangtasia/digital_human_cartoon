import logging
import ssl
import asyncio

logger = logging.getLogger(__name__)


class EmailSender:
    """
    邮件发送器 — 基于 aiosmtplib (SMTP / SSL)
    
    config_json 格式:
    {
        "smtp_host": "smtp.qq.com",
        "smtp_port": 465,
        "username": "your_email@qq.com",
        "password": "your_smtp_password",
        "from_name": "心理疗愈系统"
    }
    """

    async def send(self, contact: str, message: str, config: dict) -> None:
        """
        发送邮件

        Args:
            contact: 接收方邮箱地址
            message: 消息正文
            config: SMTP 配置
        
        Raises:
            ValueError: 缺少必要配置项
            Exception: 发送失败
        """
        required_keys = ["smtp_host", "smtp_port", "username", "password"]
        missing = [k for k in required_keys if not config.get(k)]
        if missing:
            msg = f"EmailSender: missing required config keys: {missing}"
            logger.error(msg)
            raise ValueError(msg)

        if not contact:
            raise ValueError("EmailSender: contact (email address) is empty")

        try:
            import aiosmtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart
            from email.header import Header
        except ImportError as e:
            raise ImportError(f"EmailSender: aiosmtplib not installed. Run: pip install aiosmtplib. Error: {e}")

        smtp_host = config["smtp_host"]
        smtp_port = int(config.get("smtp_port", 465))
        username = config["username"]
        password = config["password"]
        from_name = config.get("from_name", "心理疗愈系统")

        # 构建邮件
        msg = MIMEMultipart("alternative")
        msg["Subject"] = Header("【紧急】心理疗愈系统危机告警通知", "utf-8")
        msg["From"] = f"{from_name} <{username}>"
        msg["To"] = contact

        # 纯文本正文
        text_part = MIMEText(message, "plain", "utf-8")
        msg.attach(text_part)

        # HTML 正文（格式化显示）
        html_content = message.replace("\n", "<br>").replace("━", "─")
        html_body = f"""
        <html>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <div style="border: 2px solid #e74c3c; border-radius: 8px; padding: 20px; max-width: 600px;">
              <p style="white-space: pre-line; line-height: 1.8; font-size: 14px;">
                {html_content}
              </p>
            </div>
          </body>
        </html>
        """
        html_part = MIMEText(html_body, "html", "utf-8")
        msg.attach(html_part)

        # 判断是否使用 SSL（465 端口默认 SSL，587 使用 STARTTLS）
        use_tls = smtp_port == 465

        logger.info(f"EmailSender: sending to {contact} via {smtp_host}:{smtp_port} (TLS={use_tls})")

        await aiosmtplib.send(
            msg,
            hostname=smtp_host,
            port=smtp_port,
            username=username,
            password=password,
            use_tls=use_tls,
            timeout=15,
        )

        logger.info(f"EmailSender: successfully sent to {contact}")
