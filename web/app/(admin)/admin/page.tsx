"use client";

import { useEffect, useState } from "react";
import { Card, CardBody } from "@heroui/react";
import { getUserList, getCrisisReports, getUserConversations } from "@/lib/api/adh";
import Link from "next/link";

interface StatCardProps {
  title: string;
  value: number | string;
  icon: string;
  color: string;
  href?: string;
}

function StatCard({ title, value, icon, color, href }: StatCardProps) {
  const content = (
    <Card className="hover:shadow-md transition-shadow cursor-default">
      <CardBody className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700 mb-1">{title}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
          </div>
          <div className={`text-4xl`}>{icon}</div>
        </div>
      </CardBody>
    </Card>
  );
  if (href) {
    return <Link href={href} className="block">{content}</Link>;
  }
  return content;
}

export default function AdminDashboard() {
  const [userCount, setUserCount] = useState<number | string>("--");
  const [crisisCount, setCrisisCount] = useState<number | string>("--");
  const [todayConvCount, setTodayConvCount] = useState<number | string>("--");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    setLoading(true);
    try {
      const [users, crisisReports] = await Promise.all([
        getUserList(),
        getCrisisReports(),
      ]);
      setUserCount(users.length);

      const today = new Date().toLocaleDateString("zh-CN");
      const todayCrisis = crisisReports.filter((r) => {
        if (!r.created_at) return false;
        return new Date(r.created_at).toLocaleDateString("zh-CN") === today;
      });
      setCrisisCount(crisisReports.length);

      // 统计今日对话
      let convCount = 0;
      for (const u of users.slice(0, 5)) {
        try {
          const convs = await getUserConversations(u.id);
          convCount += convs.filter((c) => {
            if (!c.created_at) return false;
            return new Date(c.created_at).toLocaleDateString("zh-CN") === today;
          }).length;
        } catch {}
      }
      setTodayConvCount(convCount);
    } catch {
      // 忽略错误
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
        <p className="text-gray-700 text-sm mt-1">系统数据概览</p>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <StatCard
          title="总用户数"
          value={loading ? "..." : userCount}
          icon="👥"
          color="text-blue-600"
          href="/admin/users"
        />
        <StatCard
          title="今日对话数"
          value={loading ? "..." : todayConvCount}
          icon="💬"
          color="text-green-600"
        />
        <StatCard
          title="危机上报总数"
          value={loading ? "..." : crisisCount}
          icon="🚨"
          color="text-red-600"
          href="/admin/crisis-reports"
        />
      </div>

      {/* 快捷入口 */}
      <div className="mb-8">
        <h2 className="text-lg font-semibold text-gray-800 mb-4">快捷功能</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { href: "/admin/users", label: "用户管理", icon: "👤", desc: "管理系统用户" },
            { href: "/admin/users", label: "添加用户", icon: "➕", desc: "新建用户账号" },
            { href: "/admin/notifications", label: "通知配置", icon: "🔔", desc: "配置通知渠道" },
            { href: "/admin/crisis-reports", label: "危机上报", icon: "⚠️", desc: "查看危机记录" },
          ].map((item) => (
            <Link key={item.label} href={item.href}>
              <Card className="hover:shadow-md transition-all hover:-translate-y-0.5 cursor-pointer">
                <CardBody className="p-4 text-center">
                  <div className="text-3xl mb-2">{item.icon}</div>
                  <p className="font-medium text-gray-800 text-sm">{item.label}</p>
                  <p className="text-xs text-gray-700 mt-0.5">{item.desc}</p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      </div>

      {/* 系统信息 */}
      <Card>
        <CardBody className="p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">系统信息</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: "系统名称", value: "沐光而行 · 心智成长关护系统" },
              { label: "后端服务", value: "http://127.0.0.1:8881" },
              { label: "前端框架", value: "Next.js 15 + HeroUI" },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-gray-700">{item.label}</p>
                <p className="text-sm font-medium text-gray-800 mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

