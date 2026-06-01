"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Card, CardBody } from "@heroui/react";
import { login } from "@/lib/api/adh";
import { useAuthStore } from "@/lib/store/auth";

export default function AdminLoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const { setAuth, isLoggedIn, initFromStorage } = useAuthStore();

  useEffect(() => {
    initFromStorage();
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      // 已登录用户根据角色决定跳转目标
      const { user } = useAuthStore.getState();
      if (user && user.role === "user") {
        router.replace("/sentio");
      } else {
        router.replace("/admin");
      }
    }
  }, [isLoggedIn]);

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
      if (res.user.role === "user") {
        router.replace("/sentio");
      } else {
        router.replace("/admin");
      }
    } catch (e: any) {
      setError(e.message || "登录失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-[400px] shadow-xl">
        <CardBody className="p-8">
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900">管理后台</h1>
            <p className="text-sm text-gray-700 mt-1">沐光而行 · 心智成长关护系统</p>
          </div>

          <div className="space-y-4">
            <Input
              label="用户名"
              placeholder="请输入管理员用户名"
              variant="bordered"
              value={username}
              onValueChange={setUsername}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
            <Input
              label="密码"
              placeholder="请输入密码"
              type="password"
              variant="bordered"
              value={password}
              onValueChange={setPassword}
              onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            />
            {error && <p className="text-red-500 text-sm">{error}</p>}
            <Button
              color="primary"
              fullWidth
              size="lg"
              isLoading={loading}
              onPress={handleLogin}
              className="mt-2"
            >
              登录
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

