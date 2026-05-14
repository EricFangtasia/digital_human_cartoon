import { useState, useEffect, useRef } from "react";

const EXPRESSIONS = {
  idle:    { eyeOpen: 1,   browY: 0,    mouthCurve: 0.3,  blushOp: 0.2, eyeScale: 1    },
  happy:   { eyeOpen: 0.6, browY: -3,   mouthCurve: 0.8,  blushOp: 0.5, eyeScale: 1.05 },
  thinking:{ eyeOpen: 0.9, browY: -2,   mouthCurve: 0.1,  blushOp: 0.1, eyeScale: 0.95 },
  surprised:{ eyeOpen:1.4, browY: -6,   mouthCurve: 0.0,  blushOp: 0.3, eyeScale: 1.1  },
  talking: { eyeOpen: 0.85,browY: -1,   mouthCurve: 0.5,  blushOp: 0.3, eyeScale: 1    },
  sad:     { eyeOpen: 0.7, browY: 4,    mouthCurve: -0.4, blushOp: 0.15,eyeScale: 0.9  },
};

function lerp(a, b, t) { return a + (b - a) * t; }

function CartoonFace({ expr, blinkT, talkT, headBob }) {
  const e = expr;
  const eyeLid = 18 * (1 - e.eyeOpen * Math.abs(Math.cos(blinkT * Math.PI)));
  const mouthY = 282 + talkT * 4;
  const mouthH = 6 + talkT * 10;

  return (
    <svg viewBox="0 0 200 240" width="200" height="240" style={{ overflow: "visible" }}>
      {/* Head shadow */}
      <ellipse cx="100" cy="220" rx="58" ry="10" fill="rgba(0,0,0,0.08)" />
      {/* Neck */}
      <rect x="85" y="185" width="30" height="30" rx="6" fill="#FDDBB4" />
      {/* Hair back */}
      <ellipse cx="100" cy="75" rx="62" ry="68" fill="#4A2E0A" />
      {/* Face */}
      <ellipse cx="100" cy="115" rx="58" ry="65" fill="#FDDBB4" />
      {/* Ears */}
      <ellipse cx="42" cy="115" rx="12" ry="16" fill="#FDDBB4" />
      <ellipse cx="158" cy="115" rx="12" ry="16" fill="#FDDBB4" />
      <ellipse cx="42" cy="115" rx="7" ry="10" fill="#f5c89a" />
      <ellipse cx="158" cy="115" rx="7" ry="10" fill="#f5c89a" />
      {/* Hair front */}
      <path d="M40 88 Q46 48 100 42 Q154 48 160 88 Q150 60 100 58 Q50 60 40 88Z" fill="#5C3610" />
      <path d="M40 88 Q35 100 38 118 Q44 82 55 78Z" fill="#5C3610" />
      <path d="M160 88 Q165 100 162 118 Q156 82 145 78Z" fill="#5C3610" />
      {/* Bangs */}
      <path d="M62 68 Q70 50 100 48 Q130 50 138 68 Q125 56 100 54 Q75 56 62 68Z" fill="#6B4218" />

      {/* Blush */}
      <ellipse cx="65" cy="138" rx="16" ry="9" fill="#FF9AB0" opacity={e.blushOp} />
      <ellipse cx="135" cy="138" rx="16" ry="9" fill="#FF9AB0" opacity={e.blushOp} />

      {/* Eyebrows */}
      <path d={`M68 ${96 + e.browY} Q78 ${90 + e.browY} 88 ${94 + e.browY}`} stroke="#4A2E0A" strokeWidth="3" fill="none" strokeLinecap="round" />
      <path d={`M112 ${94 + e.browY} Q122 ${90 + e.browY} 132 ${96 + e.browY}`} stroke="#4A2E0A" strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* Left eye */}
      <ellipse cx="78" cy="115" rx="13" ry={13 * e.eyeOpen * e.eyeScale} fill="white" />
      <ellipse cx="78" cy="115" rx="9" ry={Math.max(1, 9 * e.eyeOpen * e.eyeScale)} fill="#3B2510" />
      <ellipse cx="78" cy="115" rx="5" ry={Math.max(0.5, 5 * e.eyeOpen * e.eyeScale)} fill="#1a0a00" />
      <circle cx="81" cy="111" r="3" fill="white" opacity={e.eyeOpen > 0.3 ? 1 : 0} />
      <rect x="65" y={115 - eyeLid / 2} width="26" height={eyeLid} rx="3" fill="#FDDBB4" />

      {/* Right eye */}
      <ellipse cx="122" cy="115" rx="13" ry={13 * e.eyeOpen * e.eyeScale} fill="white" />
      <ellipse cx="122" cy="115" rx="9" ry={Math.max(1, 9 * e.eyeOpen * e.eyeScale)} fill="#3B2510" />
      <ellipse cx="122" cy="115" rx="5" ry={Math.max(0.5, 5 * e.eyeOpen * e.eyeScale)} fill="#1a0a00" />
      <circle cx="125" cy="111" r="3" fill="white" opacity={e.eyeOpen > 0.3 ? 1 : 0} />
      <rect x="109" y={115 - eyeLid / 2} width="26" height={eyeLid} rx="3" fill="#FDDBB4" />

      {/* Nose */}
      <path d="M97 138 Q100 144 103 138" stroke="#d4956a" strokeWidth="1.5" fill="none" strokeLinecap="round" />

      {/* Mouth */}
      {e.mouthCurve >= 0 ? (
        <>
          <path
            d={`M82 ${mouthY} Q100 ${mouthY + e.mouthCurve * 18} 118 ${mouthY}`}
            stroke="#c47a8a" strokeWidth="2.5" fill="none" strokeLinecap="round"
          />
          {talkT > 0.3 && (
            <ellipse cx="100" cy={mouthY + e.mouthCurve * 10 + mouthH / 2} rx="12" ry={mouthH / 2} fill="#a03050" opacity="0.7" />
          )}
          {talkT > 0.3 && (
            <ellipse cx="100" cy={mouthY + e.mouthCurve * 10 + mouthH / 2 + 3} rx="10" ry={mouthH / 2 - 2} fill="#f5c0c0" opacity="0.5" />
          )}
        </>
      ) : (
        <path
          d={`M82 ${mouthY + 8} Q100 ${mouthY + 8 + e.mouthCurve * 18} 118 ${mouthY + 8}`}
          stroke="#c47a8a" strokeWidth="2.5" fill="none" strokeLinecap="round"
        />
      )}
    </svg>
  );
}

const SYSTEM_PROMPT = `你是一个可爱的卡通数字人助手，外形是一个日系卡通少女形象（根据用户照片生成）。
你的名字叫"小晴"。你性格活泼、温柔、有趣，喜欢用轻松的语气交流。
每条回复请在最后一行单独输出表情指令，格式：[EXPR:表情名]
可选表情：happy（开心）、thinking（思考）、surprised（惊讶）、talking（说话）、sad（难过）、idle（平静）
根据对话情绪选择合适的表情。回复要简洁，100字以内。`;

export default function CartoonDigitalHuman() {
  const [messages, setMessages] = useState([
    { role: "assistant", content: "你好呀！我是小晴 ✨ 你的专属卡通数字人！有什么想聊的吗？\n[EXPR:happy]" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [currentExpr, setCurrentExpr] = useState("happy");
  const [targetExpr, setTargetExpr] = useState("happy");
  const [lerpExpr, setLerpExpr] = useState(EXPRESSIONS.happy);
  const [blinkT, setBlinkT] = useState(0);
  const [talkT, setTalkT] = useState(0);
  const [headBob, setHeadBob] = useState(0);
  const [uploaded, setUploaded] = useState(false);
  const [tab, setTab] = useState("chat");
  const chatRef = useRef(null);
  const animRef = useRef(null);
  const timeRef = useRef(0);
  const talkRef = useRef(false);

  // Animation loop
  useEffect(() => {
    let raf;
    let last = performance.now();
    function tick(now) {
      const dt = (now - last) / 1000;
      last = now;
      timeRef.current += dt;
      const t = timeRef.current;

      // Blink every ~4s
      const blinkPhase = (t % 4) / 4;
      const blinkVal = blinkPhase > 0.95 ? Math.sin((blinkPhase - 0.95) / 0.05 * Math.PI) : 0;
      setBlinkT(blinkVal);

      // Talking animation
      if (talkRef.current) {
        setTalkT(Math.abs(Math.sin(t * 8)) * 0.9 + 0.1);
      } else {
        setTalkT(v => Math.max(0, v - dt * 4));
      }

      // Head bob
      setHeadBob(Math.sin(t * 0.8) * 2);

      // Lerp expression
      setLerpExpr(prev => {
        const target = EXPRESSIONS[targetExpr] || EXPRESSIONS.idle;
        const speed = 6 * dt;
        const next = {};
        for (const k of Object.keys(target)) {
          next[k] = lerp(prev[k] ?? target[k], target[k], Math.min(1, speed));
        }
        return next;
      });

      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [targetExpr]);

  // Auto-scroll chat
  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [messages]);

  function extractExpr(text) {
    const m = text.match(/\[EXPR:(\w+)\]/);
    return m ? m[1] : null;
  }
  function stripExpr(text) {
    return text.replace(/\[EXPR:\w+\]/g, "").trim();
  }

  async function sendMessage() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    const newMessages = [...messages, { role: "user", content: userMsg }];
    setMessages(newMessages);
    setLoading(true);
    setTargetExpr("thinking");

    try {
      const apiMessages = newMessages.map(m => ({
        role: m.role,
        content: stripExpr(m.content)
      }));

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: SYSTEM_PROMPT,
          messages: apiMessages
        })
      });
      const data = await res.json();
      const reply = data.content?.[0]?.text || "哎，我有点没听清，再说一次？";
      const expr = extractExpr(reply) || "talking";
      setTargetExpr(expr);
      talkRef.current = true;
      setMessages(prev => [...prev, { role: "assistant", content: reply }]);
      setTimeout(() => { talkRef.current = false; setTargetExpr("idle"); }, 3500);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "网络好像出问题了，稍后再试吧～\n[EXPR:sad]" }]);
      setTargetExpr("sad");
    }
    setLoading(false);
  }

  const PRESETS = ["你好！自我介绍一下", "今天天气怎么样？", "给我讲个笑话 😄", "你有什么特别的技能？"];

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "620px", gap: 0, fontFamily: "var(--font-sans)" }}>
      {/* Header */}
      <div style={{ padding: "14px 20px 10px", borderBottom: "0.5px solid var(--color-border-tertiary)", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: "#4ADE80" }} />
        <span style={{ fontWeight: 500, fontSize: 15, color: "var(--color-text-primary)" }}>卡通数字人 · 小晴</span>
        <span style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginLeft: "auto" }}>由您的照片生成</span>
        <div style={{ display: "flex", gap: 6 }}>
          {["chat", "setup"].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              fontSize: 12, padding: "4px 10px", borderRadius: 6, cursor: "pointer",
              background: tab === t ? "var(--color-background-info)" : "transparent",
              color: tab === t ? "var(--color-text-info)" : "var(--color-text-secondary)",
              border: "0.5px solid " + (tab === t ? "var(--color-border-info)" : "var(--color-border-tertiary)")
            }}>
              {t === "chat" ? "💬 对话" : "⚙️ 配置"}
            </button>
          ))}
        </div>
      </div>

      {tab === "chat" ? (
        <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
          {/* Avatar panel */}
          <div style={{
            width: 220, flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center",
            padding: "20px 0 16px", borderRight: "0.5px solid var(--color-border-tertiary)",
            background: "var(--color-background-secondary)"
          }}>
            <div style={{
              transform: `translateY(${headBob}px)`,
              transition: "transform 0.1s ease",
              marginBottom: 8,
              filter: "drop-shadow(0 4px 16px rgba(0,0,0,0.10))"
            }}>
              <CartoonFace expr={lerpExpr} blinkT={blinkT} talkT={talkT} headBob={headBob} />
            </div>
            <div style={{
              fontSize: 12, color: "var(--color-text-secondary)", marginTop: 4,
              background: "var(--color-background-primary)", borderRadius: 8,
              padding: "4px 12px", border: "0.5px solid var(--color-border-tertiary)"
            }}>
              {loading ? "🤔 思考中…" : currentExpr === "happy" ? "😊 开心" : currentExpr === "thinking" ? "🤔 思考" : currentExpr === "surprised" ? "😲 惊讶" : currentExpr === "sad" ? "😢 难过" : "💬 聊天中"}
            </div>
            {/* Expression presets */}
            <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 5, padding: "0 12px", justifyContent: "center" }}>
              {Object.keys(EXPRESSIONS).map(ex => (
                <button key={ex} onClick={() => { setCurrentExpr(ex); setTargetExpr(ex); }} style={{
                  fontSize: 11, padding: "3px 8px", borderRadius: 6, cursor: "pointer",
                  background: targetExpr === ex ? "var(--color-background-info)" : "var(--color-background-primary)",
                  color: targetExpr === ex ? "var(--color-text-info)" : "var(--color-text-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)"
                }}>
                  {ex === "idle" ? "平静" : ex === "happy" ? "开心" : ex === "thinking" ? "思考" : ex === "surprised" ? "惊讶" : ex === "talking" ? "说话" : "难过"}
                </button>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 11, color: "var(--color-text-tertiary)", textAlign: "center", padding: "0 12px" }}>
              表情由 AI 自动驱动<br />也可手动切换预览
            </div>
          </div>

          {/* Chat panel */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {/* Messages */}
            <div ref={chatRef} style={{
              flex: 1, overflowY: "auto", padding: "16px 16px 8px",
              display: "flex", flexDirection: "column", gap: 10
            }}>
              {messages.map((m, i) => (
                <div key={i} style={{
                  display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start",
                  gap: 8, alignItems: "flex-end"
                }}>
                  {m.role === "assistant" && (
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "linear-gradient(135deg, #FFD6E0, #FFAFCC)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 14, flexShrink: 0
                    }}>✨</div>
                  )}
                  <div style={{
                    maxWidth: "72%", padding: "8px 12px",
                    borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                    background: m.role === "user" ? "var(--color-background-info)" : "var(--color-background-primary)",
                    color: m.role === "user" ? "var(--color-text-info)" : "var(--color-text-primary)",
                    border: m.role === "assistant" ? "0.5px solid var(--color-border-tertiary)" : "none",
                    fontSize: 14, lineHeight: 1.6
                  }}>
                    {stripExpr(m.content)}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "linear-gradient(135deg, #FFD6E0, #FFAFCC)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>✨</div>
                  <div style={{ padding: "10px 14px", background: "var(--color-background-primary)", borderRadius: "14px 14px 14px 4px", border: "0.5px solid var(--color-border-tertiary)", display: "flex", gap: 5 }}>
                    {[0, 0.2, 0.4].map(d => (
                      <div key={d} style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--color-text-tertiary)", animation: `bounce 1s ${d}s infinite` }} />
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Quick replies */}
            <div style={{ padding: "6px 12px", display: "flex", gap: 6, flexWrap: "wrap" }}>
              {PRESETS.map(p => (
                <button key={p} onClick={() => { setInput(p); }} style={{
                  fontSize: 12, padding: "4px 10px", borderRadius: 12, cursor: "pointer",
                  background: "var(--color-background-secondary)", color: "var(--color-text-secondary)",
                  border: "0.5px solid var(--color-border-tertiary)", whiteSpace: "nowrap"
                }}>{p}</button>
              ))}
            </div>

            {/* Input */}
            <div style={{ padding: "8px 12px 12px", display: "flex", gap: 8, borderTop: "0.5px solid var(--color-border-tertiary)" }}>
              <input
                value={input} onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendMessage()}
                placeholder="和小晴说点什么…"
                style={{ flex: 1, fontSize: 14, borderRadius: 10, padding: "8px 12px" }}
                disabled={loading}
              />
              <button onClick={sendMessage} disabled={loading || !input.trim()} style={{
                padding: "8px 18px", borderRadius: 10, cursor: loading ? "not-allowed" : "pointer",
                background: loading ? "var(--color-background-secondary)" : "var(--color-background-info)",
                color: loading ? "var(--color-text-tertiary)" : "var(--color-text-info)",
                border: "0.5px solid var(--color-border-info)", fontWeight: 500, fontSize: 14
              }}>
                发送 ↗
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Setup tab */
        <div style={{ flex: 1, padding: 20, overflowY: "auto" }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 16 }}>照片转卡通数字人 · 技术流程</div>

          {/* Upload zone */}
          <div style={{
            border: "1.5px dashed var(--color-border-secondary)", borderRadius: 12,
            padding: "28px 20px", textAlign: "center", marginBottom: 16, cursor: "pointer",
            background: uploaded ? "var(--color-background-success)" : "var(--color-background-secondary)",
            transition: "background 0.3s"
          }} onClick={() => setUploaded(true)}>
            {uploaded ? (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontSize: 14, color: "var(--color-text-success)", fontWeight: 500 }}>照片已上传，正在生成卡通形象…</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>（Demo模式：使用预设形象）</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 32, marginBottom: 8 }}>📸</div>
                <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>点击上传您的照片</div>
                <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 4 }}>支持 JPG / PNG，正脸效果最佳</div>
              </>
            )}
          </div>

          {/* Pipeline steps */}
          {[
            { icon: "🔍", title: "人脸检测 & 关键点", desc: "MediaPipe 提取 468 个面部特征点，识别五官比例", done: uploaded, tool: "MediaPipe FaceMesh" },
            { icon: "🎨", title: "扩散模型卡通化", desc: "Stable Diffusion + IP-Adapter 保持人物特征，生成卡通风格", done: false, tool: "SD 1.5 + ControlNet" },
            { icon: "😄", title: "多表情素材生成", desc: "生成平静/开心/思考/惊讶/悲伤等表情序列", done: false, tool: "ComfyUI 批量生成" },
            { icon: "🤖", title: "口型 & 动作绑定", desc: "SadTalker 驱动表情动画，实现实时口型同步", done: false, tool: "SadTalker" },
            { icon: "💬", title: "LLM 对话接入", desc: "Claude API 提供智能对话，根据情绪自动切换表情", done: false, tool: "Claude Sonnet" },
          ].map((step, i) => (
            <div key={i} style={{
              display: "flex", gap: 12, padding: "12px 14px", borderRadius: 10,
              background: step.done ? "var(--color-background-success)" : "var(--color-background-primary)",
              border: "0.5px solid " + (step.done ? "var(--color-border-success)" : "var(--color-border-tertiary)"),
              marginBottom: 8
            }}>
              <div style={{ fontSize: 20, flexShrink: 0 }}>{step.done ? "✅" : step.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 500, color: "var(--color-text-primary)" }}>{step.title}</div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>{step.desc}</div>
                <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 3 }}>工具：{step.tool}</div>
              </div>
              <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", alignSelf: "center" }}>步骤 {i + 1}</div>
            </div>
          ))}

          <div style={{
            marginTop: 16, padding: "12px 16px", borderRadius: 10,
            background: "var(--color-background-info)", border: "0.5px solid var(--color-border-info)"
          }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-info)", marginBottom: 4 }}>💡 当前 Demo 说明</div>
            <div style={{ fontSize: 12, color: "var(--color-text-info)", lineHeight: 1.7 }}>
              此 Demo 使用预设的 SVG 卡通形象演示完整交互流程。<br />
              真实项目中，需部署 Stable Diffusion 服务器（推荐 RTX 3090+）<br />
              或接入 Replicate / Stability AI 云端 API 进行实际的照片卡通化。
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
      `}</style>
    </div>
  );
}
