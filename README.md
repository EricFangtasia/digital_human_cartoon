# Digital Human Cartoon

2D Live2D digital human assistant with a web front end, Python backend, realtime voice chat, TTS playback, user management, and crisis alert workflows.

## Features

- Live2D character gallery and large character entry page after login.
- Hands-free realtime voice chat using browser speech recognition when available.
- Text chat, speech synthesis, opening greeting, and restart conversation flow.
- Crisis keyword monitoring for self-harm and violence-to-others risk phrases.
- Guardian/admin notification pages for high-risk conversation alerts.
- Configurable LLM, ASR, and TTS engines.

## Project Structure

```text
digital_human_cartoon/
  configs/        Engine and agent configuration files
  digitalHuman/   Python backend, agents, TTS/ASR engines, memory, alerts
  docs/           Deployment notes and voice troubleshooting history
  web/            Next.js frontend and Live2D assets
```

## Configuration

Do not commit real credentials. Copy `.env.example` to `.env` on the target server and fill in deployment-specific values.

Important environment variables:

- `DHC_DB_HOST`, `DHC_DB_PORT`, `DHC_DB_USER`, `DHC_DB_PASSWORD`, `DHC_DB_NAME`
- `DHC_DOUBAO_BASE_URL`, `DHC_DOUBAO_API_KEY`, `DHC_DOUBAO_MODEL`
- `DHC_LONGCAT_BASE_URL`, `DHC_LONGCAT_API_KEY`, `DHC_LONGCAT_MODEL`
- `DHC_MILVUS_HOST`, `DHC_MILVUS_PORT`, `DHC_MILVUS_USER`, `DHC_MILVUS_PASSWORD`
- `DHC_JWT_SECRET`

## Deployment Notes

The production/test deployment is expected to run on Linux with HTTPS enabled for browser microphone permissions. See:

- `docs/FunASR_Streaming_Deploy_Guide.md`
- `docs/语音问题排查与修改记录.md`

## Security

This repo should contain source code, public Live2D assets, and sanitized examples only. Rotate any credential that was ever committed before this cleanup, because deleting it in a later commit does not remove it from Git history.
