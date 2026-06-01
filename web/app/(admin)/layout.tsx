"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuthStore } from "@/lib/store/auth";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isLoggedIn, user, clearAuth, initFromStorage } = useAuthStore();
  const [initialized, setInitialized] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    initFromStorage();
    setInitialized(true);
  }, []);

  useEffect(() => {
    if (!initialized) return;

    // 登录页直接放行
    if (pathname === "/admin/login") {
      setIsReady(true);
      return;
    }

    // 未登录，跳到登录页，保持 isReady=false（不渲染内容）
    if (!isLoggedIn) {
      router.replace("/admin/login");
      return;
    }

    // 普通用户不允许访问 /admin，跳到 /sentio，保持 isReady=false
    if (user && user.role === "user") {
      router.replace("/sentio");
      return;
    }

    // super_admin / guardian（或未设置 role 的旧版用户）才允许渲染
    setIsReady(true);
  }, [initialized, isLoggedIn, user?.role, pathname]);

  const menuItems = useMemo(() => {
    const role = user?.role;
    if (role === "super_admin") {
      return [
        { label: "仪表盘", href: "/admin", icon: "📊" },
        { label: "用户管理", href: "/admin/users", icon: "👥" },
        { label: "监护人通知配置", href: "/admin/guardian-notifications", icon: "🔔" },
        { label: "危机上报", href: "/admin/crisis-reports", icon: "🚨" },
      ];
    } else if (role === "guardian") {
      return [
        { label: "我的通知配置", href: "/admin/my-notifications", icon: "🔔" },
        { label: "危机上报", href: "/admin/crisis-reports", icon: "🚨" },
      ];
    }
    // 兼容旧版未设置 role 的用户，显示完整菜单
    return [
      { label: "仪表盘", href: "/admin", icon: "📊" },
      { label: "用户管理", href: "/admin/users", icon: "👥" },
      { label: "监护人通知配置", href: "/admin/guardian-notifications", icon: "🔔" },
      { label: "危机上报", href: "/admin/crisis-reports", icon: "🚨" },
    ];
  }, [user?.role]);

  const handleLogout = () => {
    clearAuth();
    router.replace("/admin/login");
  };

  if (!isReady) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-sm text-gray-700">加载中...</div>
        </div>
      </div>
    );
  }

  // 登录页不加侧边栏
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  const roleLabel =
    user?.role === "super_admin"
      ? "超级管理员"
      : user?.role === "guardian"
      ? "监护人"
      : "管理员";

  return (
    <div className="flex h-screen bg-gray-50">
      {/* 左侧导航 */}
      <aside className="w-56 bg-white border-r border-gray-200 flex flex-col shadow-sm">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-gray-100">
          <span className="text-lg font-bold text-blue-600">沐光管理台</span>
        </div>

        {/* 导航菜单 */}
        <nav className="flex-1 py-4 px-3 space-y-1">
          {menuItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/admin" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* 用户信息 */}
        <div className="border-t border-gray-100 p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
              {(user?.name || user?.username || "A")[0].toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{user?.name || user?.username}</p>
              <p className="text-xs text-gray-700">{roleLabel}</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full text-xs text-gray-700 hover:text-red-500 hover:bg-red-50 rounded-lg px-3 py-1.5 transition-colors text-left"
          >
            退出登录
          </button>
        </div>
      </aside>

      {/* 右侧内容 */}
      <main className="flex-1 overflow-auto">
        {children}
      </main>
    </div>
  );
}

