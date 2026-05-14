import logging
import asyncio

logger = logging.getLogger(__name__)


class SmsSender:
    """
    短信发送器 — 阿里云短信预留接口
    
    config_json 格式:
    {
        "access_key_id": "your_access_key_id",
        "access_key_secret": "your_access_key_secret",
        "sign_name": "心理疗愈",
        "template_code": "SMS_XXXXXXXX"
    }
    
    NOTE: 当前版本仅记录日志，不实际发送短信。
          需配置阿里云 AccessKey 后启用实际发送逻辑。
    """

    async def send(self, contact: str, message: str, config: dict) -> None:
        """
        发送短信

        Args:
            contact: 接收方手机号
            message: 消息正文
            config: 阿里云短信配置
        
        Raises:
            ValueError: 缺少必要配置项
        """
        # 校验必要配置
        required_keys = ["access_key_id", "access_key_secret", "sign_name", "template_code"]
        missing = [k for k in required_keys if not config.get(k)]
        if missing:
            msg = f"SmsSender: missing required config keys: {missing}"
            logger.error(msg)
            raise ValueError(msg)

        if not contact:
            raise ValueError("SmsSender: contact (phone number) is empty")

        # TODO: 启用阿里云短信实际发送
        # 取消注释以下代码以激活真实短信发送功能
        # -------------------------------------------------------
        # import hmac
        # import hashlib
        # import base64
        # import urllib.parse
        # import uuid
        # import time
        # import httpx
        #
        # access_key_id = config["access_key_id"]
        # access_key_secret = config["access_key_secret"]
        # sign_name = config["sign_name"]
        # template_code = config["template_code"]
        #
        # # 构建模板参数（将 message 作为内容传入）
        # template_param = '{"content": "' + message[:70] + '"}'
        #
        # params = {
        #     "Action": "SendSms",
        #     "Version": "2017-05-25",
        #     "Format": "JSON",
        #     "AccessKeyId": access_key_id,
        #     "SignatureMethod": "HMAC-SHA1",
        #     "Timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        #     "SignatureVersion": "1.0",
        #     "SignatureNonce": str(uuid.uuid4()),
        #     "PhoneNumbers": contact,
        #     "SignName": sign_name,
        #     "TemplateCode": template_code,
        #     "TemplateParam": template_param,
        # }
        # sorted_params = sorted(params.items())
        # query = "&".join(f"{urllib.parse.quote(k, safe='')}={urllib.parse.quote(str(v), safe='')}" for k, v in sorted_params)
        # string_to_sign = "GET&%2F&" + urllib.parse.quote(query, safe='')
        # key = (access_key_secret + "&").encode("utf-8")
        # signature = base64.b64encode(hmac.new(key, string_to_sign.encode("utf-8"), hashlib.sha1).digest()).decode()
        # params["Signature"] = signature
        # url = "https://dysmsapi.aliyuncs.com/?" + urllib.parse.urlencode(params)
        #
        # async with httpx.AsyncClient(timeout=10) as client:
        #     resp = await client.get(url)
        #     resp.raise_for_status()
        #     result = resp.json()
        #     if result.get("Code") != "OK":
        #         raise RuntimeError(f"Aliyun SMS error: {result}")
        # -------------------------------------------------------

        # 当前版本: 仅记录日志（预留模式）
        logger.info(
            f"[SMS-STUB] Would send SMS to {contact} | "
            f"sign={config['sign_name']} | template={config['template_code']} | "
            f"message_len={len(message)}"
        )
        logger.debug(f"[SMS-STUB] Full message:\n{message}")
