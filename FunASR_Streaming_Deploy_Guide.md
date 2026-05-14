# FunASR Streaming 实时语音识别服务部署指南

## 一、概述

本项目使用 FunASR（阿里巴巴达摩院开源的语音识别框架）作为实时语音识别引擎，通过 WebSocket 协议与前端通信。

## 二、部署方式选择

FunASR 提供两种部署方式：

| 方式 | 优点 | 缺点 | 推荐场景 |
|------|------|------|----------|
| **Python SDK** | 部署简单，快速上手 | 性能相对较低 | 开发测试 |
| **Runtime (C++)** | 性能高，支持并发 | 编译复杂 | 生产环境 |

本指南提供 **Python SDK 方式**（最简单），适合快速部署。

## 三、Python SDK 部署步骤

### 3.1 环境要求

- Python >= 3.8
- Linux (Ubuntu 20.04+ 推荐)
- 推荐使用虚拟环境

### 3.2 安装 FunASR

```bash
# 创建虚拟环境（推荐）
python -m venv funasr_env
source funasr_env/bin/activate

# 安装 FunASR
pip install funasr

# 如果需要 GPU 加速
pip install funasr[gpu]
```

### 3.3 启动 FunASR Streaming 服务

创建一个启动脚本 `start_funasr_stream.sh`：

```bash
#!/bin/bash

# FunASR Streaming WebSocket 服务启动脚本
# 默认监听端口: 10095

PORT=${1:-10095}
MODEL=${2:-"iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"}

echo "============================================"
echo "  FunASR Streaming 服务启动中..."
echo "  端口: $PORT"
echo "  模型: $MODEL"
echo "============================================"

python -m funasr_streaming.api_server \
    --port $PORT \
    --model-name $MODEL \
    --ncpu 4 \
    --ngpu 0

echo "FunASR 服务已启动，监听端口: $PORT"
```

启动服务：

```bash
# 添加执行权限
chmod +x start_funasr_stream.sh

# 启动服务（默认端口10095）
./start_funasr_stream.sh

# 或者指定端口
./start_funasr_stream.sh 10095
```

### 3.4 验证服务

```bash
# 检查端口是否监听
netstat -tlnp | grep 10095

# 或使用 curl 测试
curl -v http://localhost:10095
```

## 四、配置项目使用 FunASR

### 4.1 修改默认 ASR 引擎

编辑 `configs/config.yaml`：

```yaml
SERVER:
  ENGINES:
    ASR:
      SUPPORT_LIST: [ "funasrStreamingAPI.yaml", "difyAPI.yaml", "cozeAPI.yaml", "tencentAPI.yaml"]
      DEFAULT: "funasrStreamingAPI.yaml"  # 修改为 FunASR
```

### 4.2 配置 FunASR 参数

编辑 `configs/engines/asr/funasrStreamingAPI.yaml`：

```yaml
NAME: funasrStreaming
VERSION: "v0.0.1"
DESC: "接入Stream ASR"
META: {
  official: "https://github.com/modelscope/FunASR",
  tips: "支持本地部署的FunAsrStream应用",
  fee: "free",
  infer_type: "stream"
}
PARAMETERS: [
  {
    name: "api_url",
    description: "Funasr Streaming API URL",
    type: "string",
    required: false,
    choices: [],
    default: "ws://localhost:10095"  # 确保指向你的服务器IP
  },
  {
    name: "mode",
    description: "Funasr Streaming mode",
    type: "string",
    required: false,
    choices: ["2pass"],
    default: "2pass"
  }
]
```

### 4.3 前端配置（重要）

如果你的 FunASR 服务不在本机，需要修改前端的 WebSocket 连接地址：

编辑 `web/lib/api/websocket.ts` 中的 `getWsUrl` 函数：

```typescript
function getWsUrl(path: string): string {
    // 如果FunASR服务不在同一台服务器，修改这里
    const wsHost = process.env.NEXT_PUBLIC_ASR_WS_URL || window.location.host;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${wsHost}${path}`;
}
```

或在 `.env` 文件中配置：

```bash
# .env.local
NEXT_PUBLIC_ASR_WS_URL=192.168.0.97:10095
```

## 五、使用 Systemd 管理服务（推荐）

创建 systemd 服务文件 `/etc/systemd/system/funasr.service`：

```ini
[Unit]
Description=FunASR Streaming Service
After=network.target

[Service]
Type=simple
User=your_username
WorkingDirectory=/opt/python/test_cuda/digital_human_cartoon
ExecStart=/opt/python/test_cuda/digital_human_cartoon/funasr_env/bin/python -m funasr_streaming.api_server --port 10095 --model-name iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch --ncpu 4
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
# 重载 systemd
sudo systemctl daemon-reload

# 启用开机自启
sudo systemctl enable funasr

# 启动服务
sudo systemctl start funasr

# 查看状态
sudo systemctl status funasr

# 查看日志
sudo journalctl -u funasr -f
```

## 六、常见问题

### Q1: 服务启动报错 "Module not found"

```bash
# 确保已安装 funasr
pip install funasr

# 如果使用虚拟环境，确保激活了正确的环境
source funasr_env/bin/activate
```

### Q2: WebSocket 连接失败

1. 检查防火墙：
```bash
sudo firewall-cmd --add-port=10095/tcp --permanent
sudo firewall-cmd --reload
```

2. 检查端口是否被占用：
```bash
netstat -tlnp | grep 10095
```

### Q3: 识别效果不理想

调整模型参数：
```bash
# 使用更大的模型
--model-name iic/speech_paraformer-large-vad-punc_asr_nat-zh-cn-16k-common-vocab8404-pytorch
```

### Q4: 内存占用过高

```bash
# 限制 CPU 核心数
--ncpu 2

# 关闭 GPU
--ngpu 0
```

## 七、性能优化建议

### 7.1 使用 GPU 加速

```bash
pip install funasr[gpu]
pip install torch torchaudio
```

启动时指定 GPU：
```bash
python -m funasr_streaming.api_server --port 10095 --ngpu 1 --ncpu 2
```

### 7.2 使用更快的模型

对于实时场景，可以使用 paraformer 模型：
```bash
--model-name iic/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch
```

### 7.3 Docker 部署（可选）

创建 `Dockerfile.funasr`：

```dockerfile
FROM python:3.9-slim

WORKDIR /app

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    libopenblas-dev \
    libssl-dev \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# 安装 FunASR
RUN pip install funasr

# 复制启动脚本
COPY start_funasr.sh /app/
RUN chmod +x /app/start_funasr.sh

EXPOSE 10095

CMD ["/app/start_funasr.sh"]
```

构建并运行：
```bash
docker build -f Dockerfile.funasr -t funasr-streaming .
docker run -d --gpus all -p 10095:10095 funasr-streaming
```

## 八、日志查看

```bash
# 查看 FunASR 服务日志
journalctl -u funasr -f

# 或直接在终端查看
tail -f /var/log/funasr.log
```

## 九、快速验证

在浏览器控制台或使用 WebSocket 测试工具连接：

```
ws://your-server-ip:10095
```

发送音频数据后，应收到识别结果。

---

如有问题，请查看 FunASR 官方文档：https://github.com/modelscope/FunASR
