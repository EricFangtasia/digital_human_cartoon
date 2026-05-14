"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/lib/store/auth";

export default function NotificationsRedirectPage() {
  const router = useRouter();
  const { user } = useAuthStore();

  useEffect(() => {
    if (user?.role === "guardian") {
      router.replace("/admin/my-notifications");
    } else {
      router.replace("/admin/guardian-notifications");
    }
  }, [user?.role]);

  return (
    <div className="w-full h-screen flex items-center justify-center">
      <div className="text-gray-400">跳转中...</div>
    </div>
  );
}
