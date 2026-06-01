"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getAdminGuardians, UserInfo } from "@/lib/api/adh";

const ROLE_LABEL: Record<string, string> = {
  super_admin: "超级管理员",
  guardian: "监护人",
  user: "普通用户",
};

export default function GuardianNotificationsPage() {
  const router = useRouter();
  const [guardians, setGuardians] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadGuardians();
  }, []);

  const loadGuardians = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await getAdminGuardians();
      setGuardians(list);
    } catch (e: any) {
      setError(e.message || "加载失败");
    }
    setLoading(false);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">监护人通知配置</h1>
        <p className="text-gray-700 text-sm mt-1">管理所有监护人的危机事件通知推送渠道</p>
      </div>

      {loading ? (
        <div className="text-center text-gray-700 py-12">加载中...</div>
      ) : error ? (
        <div className="text-center py-12">
          <p className="text-red-500 mb-4">{error}</p>
          <button
            onClick={loadGuardians}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
          >
            重试
          </button>
        </div>
      ) : guardians.length === 0 ? (
        <div className="text-center text-gray-700 py-12">暂无监护人数据</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {guardians.map((g) => (
            <div
              key={g.id}
              className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 flex flex-col gap-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-base">
                  {(g.name || g.username || "?")[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900 truncate">{g.name || g.username}</p>
                  <span
                    className={`inline-block text-xs px-2 py-0.5 rounded-full mt-0.5 ${
                      g.role === "super_admin"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {ROLE_LABEL[g.role || ""] || g.role}
                  </span>
                </div>
              </div>

              <div className="text-sm text-gray-700">
                <p>账号：{g.username}</p>
                {g.created_at && (
                  <p className="mt-1">注册时间：{new Date(g.created_at).toLocaleDateString()}</p>
                )}
              </div>

              <Link
                href={`/admin/guardian-notifications/${g.id}`}
                className="mt-auto w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 transition-colors"
              >
                配置通知渠道
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

