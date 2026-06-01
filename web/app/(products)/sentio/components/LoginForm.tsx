"use client";

import { useState } from "react";
import { Button, Card, CardBody, CardHeader, Input } from "@heroui/react";
import { getWechatOAuthUrl, login, register } from "@/lib/api/adh";
import { useAuthStore } from "@/lib/store/auth";

interface LoginFormProps {
  onSuccess: () => void;
}

type AuthMode = "login" | "register" | "wechat";

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { setAuth } = useAuthStore();

  const finishLogin = (res: Awaited<ReturnType<typeof login>>) => {
    setAuth(res.token, res.user);
    onSuccess();
  };

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await login({ username: username.trim(), password });
      finishLogin(res);
    } catch (e: any) {
      setError(e.message || "登录失败，请检查用户名或密码");
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }
    if (username.trim().length < 3) {
      setError("用户名至少需要 3 个字符");
      return;
    }
    if (password.length < 6) {
      setError("密码至少需要 6 位");
      return;
    }
    if (password !== confirmPassword) {
      setError("两次输入的密码不一致");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await register({
        username: username.trim(),
        password,
        name: name.trim() || username.trim(),
      });
      finishLogin(res);
    } catch (e: any) {
      setError(e.message || "注册失败，请稍后再试");
    } finally {
      setLoading(false);
    }
  };

  const handleWechatOAuth = async () => {
    setLoading(true);
    setError("");
    try {
      const redirectUri = typeof window !== "undefined"
        ? `${window.location.origin}/sentio`
        : undefined;
      const url = await getWechatOAuthUrl(redirectUri);
      window.location.href = url;
    } catch (e: any) {
      setError(e.message || "微信扫码登录暂未开通，请先使用账号密码登录或注册");
    } finally {
      setLoading(false);
    }
  };

  const submit = () => {
    if (mode === "register") {
      void handleRegister();
      return;
    }
    if (mode === "wechat") {
      void handleWechatOAuth();
      return;
    }
    void handleLogin();
  };

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError("");
    setConfirmPassword("");
  };

  return (
    <div className="w-full h-full flex items-center justify-center px-4">
      <Card className="w-[420px] max-w-full shadow-2xl bg-white/10 backdrop-blur-xl border border-white/20">
        <CardHeader className="flex flex-col items-center pb-2 pt-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-400 via-sky-400 to-violet-500 flex items-center justify-center mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.75c-2.9 0-5.25 2.02-5.25 4.5 0 1.33.68 2.52 1.75 3.34l-.5 1.91 2.16-1.04c.58.18 1.2.29 1.84.29 2.9 0 5.25-2.02 5.25-4.5S14.9 6.75 12 6.75z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.75 11.1c1.5.7 2.5 1.99 2.5 3.46 0 1.06-.52 2.02-1.36 2.73l.36 1.46-1.62-.8c-.46.14-.95.21-1.46.21-1.35 0-2.57-.48-3.42-1.25" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">心伴</h2>
          <p className="text-sm text-white/95 mt-1 drop-shadow">
            {mode === "register" ? "创建账号后继续" : mode === "wechat" ? "使用微信绑定登录" : "请登录以继续"}
          </p>
        </CardHeader>
        <CardBody className="px-8 pb-8 gap-4">
          <div className="grid grid-cols-3 gap-2 rounded-lg bg-white/10 p-1">
            <button
              type="button"
              className={`h-9 rounded-md text-sm transition ${mode === "login" ? "bg-white text-slate-900 font-medium" : "text-white/95 hover:text-white"}`}
              onClick={() => switchMode("login")}
            >
              登录
            </button>
            <button
              type="button"
              className={`h-9 rounded-md text-sm transition ${mode === "register" ? "bg-white text-slate-900 font-medium" : "text-white/95 hover:text-white"}`}
              onClick={() => switchMode("register")}
            >
              注册
            </button>
            <button
              type="button"
              className={`h-9 rounded-md text-sm transition ${mode === "wechat" ? "bg-white text-slate-900 font-medium" : "text-white/95 hover:text-white"}`}
              onClick={() => switchMode("wechat")}
            >
              微信
            </button>
          </div>

          {mode === "register" && (
            <Input
              label="昵称"
              placeholder="请输入昵称"
              variant="bordered"
              classNames={{
                input: "text-white",
                label: "text-white/95",
                inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
              }}
              value={name}
              onValueChange={setName}
            />
          )}

          {mode === "wechat" && (
            <Button
              className="bg-emerald-500 text-white font-semibold"
              fullWidth
              isLoading={loading}
              onPress={handleWechatOAuth}
            >
              微信扫码登录
            </Button>
          )}

          {mode !== "wechat" && (
            <>
              <Input
                label="用户名"
                placeholder="请输入用户名"
                variant="bordered"
                classNames={{
                  input: "text-white",
                  label: "text-white/95",
                  inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
                }}
                value={username}
                onValueChange={setUsername}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              <Input
                label="密码"
                placeholder="请输入密码"
                type="password"
                variant="bordered"
                classNames={{
                  input: "text-white",
                  label: "text-white/95",
                  inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
                }}
                value={password}
                onValueChange={setPassword}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </>
          )}

          {mode === "register" && (
            <Input
              label="确认密码"
              placeholder="请再次输入密码"
              type="password"
              variant="bordered"
              classNames={{
                input: "text-white",
                label: "text-white/95",
                inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
              }}
              value={confirmPassword}
              onValueChange={setConfirmPassword}
              onKeyDown={(e) => e.key === "Enter" && submit()}
            />
          )}

          {error && <p className="text-red-300 text-sm text-center">{error}</p>}

          {mode !== "wechat" ? (
            <Button
              color="primary"
              className="mt-2 bg-gradient-to-r from-emerald-500 to-sky-500 font-semibold"
              fullWidth
              isLoading={loading}
              onPress={submit}
            >
              {mode === "register" ? "注册并登录" : "登录"}
            </Button>
          ) : (
            <p className="text-xs leading-5 text-white/95 text-center drop-shadow">
              微信扫码登录开通后，将通过微信授权完成登录或账号绑定。
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
