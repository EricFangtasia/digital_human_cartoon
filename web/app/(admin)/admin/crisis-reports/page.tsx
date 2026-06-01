"use client";

import { useEffect, useState } from "react";
import { Select, SelectItem, Chip } from "@heroui/react";
import { getCrisisReports, CrisisReport } from "@/lib/api/adh";

const SEVERITY_CONFIG = {
  low: { label: "低风险", color: "primary" as const, bgColor: "bg-blue-50 text-blue-700 border-blue-200" },
  medium: { label: "中风险", color: "warning" as const, bgColor: "bg-yellow-50 text-yellow-700 border-yellow-200" },
  high: { label: "高风险", color: "danger" as const, bgColor: "bg-orange-50 text-orange-700 border-orange-200" },
  urgent: { label: "紧急", color: "danger" as const, bgColor: "bg-red-50 text-red-700 border-red-200" },
};

const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "low", label: "低风险" },
  { key: "medium", label: "中风险" },
  { key: "high", label: "高风险" },
  { key: "urgent", label: "紧急" },
];

function SeverityBadge({ severity }: { severity: string }) {
  const cfg = SEVERITY_CONFIG[severity as keyof typeof SEVERITY_CONFIG] || {
    label: severity,
    color: "default" as const,
    bgColor: "bg-gray-50 text-gray-700 border-gray-200",
  };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.bgColor}`}>
      {cfg.label}
    </span>
  );
}

export default function CrisisReportsPage() {
  const [reports, setReports] = useState<CrisisReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadReports();
  }, []);

  const loadReports = async () => {
    setLoading(true);
    try {
      const data = await getCrisisReports();
      setReports(data);
    } catch {}
    setLoading(false);
  };

  const filtered = filter === "all" ? reports : reports.filter((r) => r.severity === filter);

  // 统计各风险等级数量
  const stats = {
    total: reports.length,
    low: reports.filter((r) => r.severity === "low").length,
    medium: reports.filter((r) => r.severity === "medium").length,
    high: reports.filter((r) => r.severity === "high").length,
    urgent: reports.filter((r) => r.severity === "urgent").length,
  };

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">危机上报记录</h1>
        <p className="text-gray-700 text-sm mt-1">系统自动检测并上报的危机事件</p>
      </div>

      {/* 统计概览 */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label: "全部", value: stats.total, color: "text-gray-700", bg: "bg-gray-50" },
          { label: "低风险", value: stats.low, color: "text-blue-600", bg: "bg-blue-50" },
          { label: "中风险", value: stats.medium, color: "text-yellow-600", bg: "bg-yellow-50" },
          { label: "高风险", value: stats.high, color: "text-orange-600", bg: "bg-orange-50" },
          { label: "紧急", value: stats.urgent, color: "text-red-600", bg: "bg-red-50" },
        ].map((item) => (
          <div
            key={item.label}
            className={`${item.bg} rounded-xl p-4 text-center cursor-pointer border border-transparent hover:border-gray-200 transition-colors`}
            onClick={() => setFilter(item.label === "全部" ? "all" : Object.entries(SEVERITY_CONFIG).find(([, v]) => v.label === item.label)?.[0] || "all")}
          >
            <p className={`text-2xl font-bold ${item.color}`}>{loading ? "..." : item.value}</p>
            <p className="text-xs text-gray-700 mt-0.5">{item.label}</p>
          </div>
        ))}
      </div>

      {/* 筛选 */}
      <div className="flex items-center gap-4 mb-4">
        <div className="flex gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === opt.key
                  ? "bg-blue-100 text-blue-700"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <span className="text-sm text-gray-700">共 {filtered.length} 条记录</span>
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">用户</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">风险等级</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">描述</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">通知渠道</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">时间</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-700">加载中...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-gray-700">暂无数据</td>
              </tr>
            ) : (
              filtered.map((report) => (
                <tr
                  key={report.id}
                  className={`hover:bg-gray-50 transition-colors ${
                    report.severity === "urgent" ? "bg-red-50/30" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <span className="font-medium text-gray-800">
                      {report.user_name || `用户 #${report.user_id}`}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SeverityBadge severity={report.severity} />
                  </td>
                  <td className="px-4 py-3 text-gray-600 max-w-xs">
                    <p className="line-clamp-2">{report.description || "-"}</p>
                  </td>
                  <td className="px-4 py-3">
                    {report.notification_channels ? (
                      <div className="flex flex-wrap gap-1">
                        {report.notification_channels.split(",").map((ch) => (
                          <span
                            key={ch}
                            className="inline-block px-1.5 py-0.5 bg-gray-100 rounded text-xs text-gray-600"
                          >
                            {ch.trim()}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-gray-700 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-700 text-xs">
                    {report.created_at ? new Date(report.created_at).toLocaleString("zh-CN") : "-"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

