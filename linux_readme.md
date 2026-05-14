交付总结
已完成功能
1. LongCat 心理疗愈对话
接入 LongCat-Flash-Chat（免费，每天 500 万 tokens）
专业心理疗愈系统提示词（温暖共情、非诊断、引导倾诉）
流式对话输出
2. 用户登录系统
SQLite 数据库，6 张表（用户、监护人、对话、消息、危机记录、通知配置）
JWT 认证，用户 CRUD，监护人管理
登录后数字人"认识"用户，个性化问候
默认管理员：admin / admin123
3. Milvus 长记忆
对话结束后 LLM 自动提取记忆点 → 向量化存入 Milvus
下次对话自动检索相关记忆注入 prompt
测试验证：记忆存储和检索均正常（相似度 0.78）
4. 危机检测与上报
两层检测：35 个关键词初筛 + LLM 深度分析（低/中/高/紧急）
中级累计 3 次自动升级为高级
高/紧急级别异步通知监护人，不阻塞对话
5. 多渠道通知服务
短信（阿里云预留）、邮箱（SMTP）、钉钉（Webhook+加签）、企业微信（Webhook）
数据库管理启用/禁用和配置
6. 管理后台前端
仪表盘、用户管理、监护人管理、通知配置、危机上报记录、对话记录
Next.js 15 + HeroUI + Tailwind CSS，构建通过
访问方式
对话页面: http://192.168.0.97:8880
管理后台: http://192.168.0.97:8880/admin
关键文件
ssh连接192.168.0.97的账户是wrcf，密码是123.com，su的密码是123.com
项目根目录: /opt/python/test_cuda/digital_human_cartoon/
核心 Agent: longcatAgent.py
用户 API: user/router.py
长记忆: memory/memory_manager.py
危机检测: crisis/detector.py
通知服务: notification/notifier.py
待你操作
通知渠道配置 — 在管理后台 /admin/notifications 中配置你实际的钉钉 Webhook / 企业微信 Webhook / 邮箱 SMTP 等信息
添加真实用户和监护人 — 在 /admin/users 中创建
短信功能 — 需要配置阿里云 AccessKey 后才能启用
风险提示
LongCat API 是公测免费，未来可能调整额度策略
危机检测基于关键词 + LLM 分析，非医学诊断，建议作为辅助手段
Milvus 记忆依赖服务器上的 Milvus 实例持续运行



Jimmy 正在将用户数据存储从 SQLite 迁移到 MySQL（192.168.0.97/digital_human_cartoon），包括建表、改写所有数据库操作代码。
MySQL 迁移完成。用户数据现在全部存储在 MySQL（digital_human_cartoon 数据库）中：
6 张表已建好：users、guardians、conversations、messages、crisis_reports、notification_config
所有数据库操作代码已从 SQLite 改为 aiomysql 连接池 + DictCursor
默认管理员 admin/admin123 已写入 MySQL
API 测试全部通过
你现在可以刷新 http://192.168.0.97:8880 试试看整个系统了。


