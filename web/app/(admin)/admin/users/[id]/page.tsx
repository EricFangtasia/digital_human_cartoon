"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Button,
  Input,
  Card,
  CardBody,
  CardHeader,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Chip,
  Select,
  SelectItem,
} from "@heroui/react";
import {
  getUserList,
  getGuardians,
  addGuardianLink,
  deleteGuardianLink,
  getAdminGuardians,
  getUserConversations,
  UserInfo,
  Guardian,
  Conversation,
} from "@/lib/api/adh";
import Link from "next/link";

export default function UserDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const userId = parseInt(id);

  const [user, setUser] = useState<UserInfo | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  // 选择监护人相关状态
  const [allGuardianUsers, setAllGuardianUsers] = useState<UserInfo[]>([]);
  const [selectedGuardianUserId, setSelectedGuardianUserId] = useState<string>("");
  const [addGuardianOpen, setAddGuardianOpen] = useState(false);
  const [guardianSubmitting, setGuardianSubmitting] = useState(false);

  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();

  useEffect(() => {
    loadData();
  }, [userId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [users, guardianList, convList, guardianUsers] = await Promise.all([
        getUserList(),
        getGuardians(userId),
        getUserConversations(userId),
        getAdminGuardians(),
      ]);
      const found = users.find((u) => u.id === userId);
      setUser(found || null);
      setGuardians(guardianList);
      setConversations(convList);
      setAllGuardianUsers(guardianUsers);
    } catch {}
    setLoading(false);
  };

  const refreshGuardians = async () => {
    try {
      const guardianList = await getGuardians(userId);
      setGuardians(guardianList);
    } catch {}
  };

  const handleAddGuardianLink = async () => {
    if (!selectedGuardianUserId) return;
    setGuardianSubmitting(true);
    try {
      await addGuardianLink(userId, parseInt(selectedGuardianUserId));
      await refreshGuardians();
      setSelectedGuardianUserId("");
      setAddGuardianOpen(false);
    } catch (e: any) {
      alert(e?.message || "添加失败");
    }
    setGuardianSubmitting(false);
  };

  const handleDeleteGuardian = async (guardianId: number) => {
    try {
      await deleteGuardianLink(userId, guardianId);
      await refreshGuardians();
    } catch (e: any) {
      alert(e?.message || "删除失败");
    }
  };

  // 过滤掉已关联的监护人用户
  const availableGuardianUsers = allGuardianUsers.filter(
    (gu) =>
      gu.id !== userId &&
      !guardians.some((g: any) => g.guardian_user_id === gu.id)
  );

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-400">加载中...</div>
    );
  }

  if (!user) {
    return (
      <div className="p-8">
        <p className="text-gray-500">用户不存在</p>
        <Link href="/admin/users">
          <Button className="mt-4" variant="flat">返回用户列表</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <Link href="/admin/users">
          <Button size="sm" variant="flat">← 返回</Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{user.name}</h1>
          <p className="text-gray-500 text-sm">用户详情</p>
        </div>
      </div>

      {/* 基本信息 */}
      <Card>
        <CardHeader className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-gray-800">基本信息</h2>
        </CardHeader>
        <CardBody className="px-6 pb-6">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-6">
            {[
              { label: "用户名", value: user.username },
              { label: "姓名", value: user.name },
              { label: "年龄", value: user.age?.toString() || "-" },
              { label: "性别", value: user.gender === "male" ? "男" : user.gender === "female" ? "女" : user.gender || "-" },
              { label: "地址", value: user.address || "-" },
              { label: "注册时间", value: user.created_at ? new Date(user.created_at).toLocaleDateString("zh-CN") : "-" },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-gray-500 mb-0.5">{item.label}</p>
                <p className="text-sm font-medium text-gray-900">{item.value}</p>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {/* 监护人 */}
      <Card>
        <CardHeader className="px-6 pt-6 pb-2 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-800">监护人 ({guardians.length})</h2>
          {!addGuardianOpen && (
            <Button size="sm" color="primary" onPress={() => { setAddGuardianOpen(true); setSelectedGuardianUserId(""); }}>
              添加监护人
            </Button>
          )}
        </CardHeader>
        <CardBody className="px-6 pb-6 space-y-4">
          {/* 添加监护人选择区域 */}
          {addGuardianOpen && (
            <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-3">
              <p className="text-sm font-medium text-gray-700">从系统中选择监护人用户</p>
              {availableGuardianUsers.length === 0 ? (
                <p className="text-sm text-gray-400">
                  暂无可选的监护人用户（所有监护人角色用户均已绑定，或系统中没有监护人角色用户）
                </p>
              ) : (
                <Select
                  label="选择监护人"
                  placeholder="请选择系统中的监护人用户"
                  selectedKeys={selectedGuardianUserId ? [selectedGuardianUserId] : []}
                  onSelectionChange={(keys) => {
                    const val = Array.from(keys)[0];
                    setSelectedGuardianUserId(val ? String(val) : "");
                  }}
                >
                  {availableGuardianUsers.map((gu) => (
                    <SelectItem key={String(gu.id)}>
                      {gu.name}（{gu.username}）
                    </SelectItem>
                  ))}
                </Select>
              )}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="flat"
                  onPress={() => { setAddGuardianOpen(false); setSelectedGuardianUserId(""); }}
                >
                  取消
                </Button>
                <Button
                  size="sm"
                  color="primary"
                  isLoading={guardianSubmitting}
                  isDisabled={!selectedGuardianUserId}
                  onPress={handleAddGuardianLink}
                >
                  确认添加
                </Button>
              </div>
            </div>
          )}

          {/* 监护人列表 */}
          {guardians.length === 0 ? (
            <p className="text-gray-400 text-sm">暂无监护人记录</p>
          ) : (
            <div className="space-y-3">
              {guardians.map((g: any, i: number) => (
                <div
                  key={g.id || i}
                  className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold">
                      {g.name?.[0] || "?"}
                    </div>
                    <div>
                      <p className="font-medium text-gray-800">{g.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {g.phone && <p className="text-xs text-gray-500">{g.phone}</p>}
                        {g.guardian_user_id ? (
                          <Chip size="sm" variant="flat" color="success" className="h-4 text-xs">系统用户</Chip>
                        ) : (
                          <Chip size="sm" variant="flat" color="default" className="h-4 text-xs">手动添加</Chip>
                        )}
                      </div>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    color="danger"
                    onPress={() => handleDeleteGuardian(g.id)}
                  >
                    移除
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* 对话记录 */}
      <Card>
        <CardHeader className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-semibold text-gray-800">对话记录 ({conversations.length})</h2>
        </CardHeader>
        <CardBody className="px-6 pb-6">
          {conversations.length === 0 ? (
            <p className="text-gray-400 text-sm">暂无对话记录</p>
          ) : (
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {conversations.map((c) => (
                <div
                  key={c.id}
                  className="p-3 rounded-lg bg-gray-50 border border-gray-100"
                >
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm text-gray-800 flex-1 line-clamp-2">{c.content}</p>
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {c.created_at ? new Date(c.created_at).toLocaleString("zh-CN") : ""}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
