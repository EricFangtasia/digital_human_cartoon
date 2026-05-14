"use client";

import { useState } from "react";
import { Button, Input, Card, CardBody, CardHeader } from "@heroui/react";
import { login } from "@/lib/api/adh";
import { useAuthStore } from "@/lib/store/auth";

interface LoginFormProps {
  onSuccess: () => void;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { setAuth } = useAuthStore();

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      setError("请输入用户名和密码");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await login({ username, password });
      setAuth(res.token, res.user);
      onSuccess();
    } catch (e: any) {
      setError(e.message || "登录失败，请检查用户名或密码");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex items-center justify-center">
      <Card className="w-[380px] shadow-2xl bg-white/10 backdrop-blur-xl border border-white/20">
        <CardHeader className="flex flex-col items-center pb-2 pt-8">
          <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center mb-4 shadow-lg">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">沐光而行</h2>
          <p className="text-sm text-white/60 mt-1">请登录以继续</p>
        </CardHeader>
        <CardBody className="px-8 pb-8 gap-4">
          <Input
            label="用户名"
            placeholder="请输入用户名"
            variant="bordered"
            classNames={{
              input: "text-white",
              label: "text-white/70",
              inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
            }}
            value={username}
            onValueChange={setUsername}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          <Input
            label="密码"
            placeholder="请输入密码"
            type="password"
            variant="bordered"
            classNames={{
              input: "text-white",
              label: "text-white/70",
              inputWrapper: "border-white/30 bg-white/5 hover:border-white/50",
            }}
            value={password}
            onValueChange={setPassword}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
          />
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}
          <Button
            color="primary"
            className="mt-2 bg-gradient-to-r from-blue-500 to-purple-500 font-semibold"
            fullWidth
            isLoading={loading}
            onPress={handleLogin}
          >
            登录
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
