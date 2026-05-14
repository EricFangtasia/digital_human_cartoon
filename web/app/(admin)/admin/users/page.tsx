"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Select,
  SelectItem,
  Chip,
} from "@heroui/react";
import {
  getUserList,
  createUser,
  updateUser,
  deleteUser,
  getGuardians,
  addGuardianLink,
  deleteGuardianLink,
  getAdminGuardians,
  UserInfo,
  CreateUserRequest,
  Guardian,
} from "@/lib/api/adh";
import Link from "next/link";

const GENDER_OPTIONS = [
  { key: "male", label: "男" },
  { key: "female", label: "女" },
  { key: "other", label: "其他" },
];

const ROLE_OPTIONS = [
  { key: "user", label: "普通用户" },
  { key: "guardian", label: "监护人" },
  { key: "super_admin", label: "超级管理员" },
];

const EMPTY_FORM: CreateUserRequest = {
  username: "",
  password: "",
  name: "",
  age: undefined,
  gender: "",
  address: "",
};

export default function UsersPage() {
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<CreateUserRequest>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingRole, setEditingRole] = useState<string>("user");
  const [submitting, setSubmitting] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");

  // 监护人 Modal 状态
  const [guardianUserId, setGuardianUserId] = useState<number | null>(null);
  const [guardianUserName, setGuardianUserName] = useState("");
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [guardianLoading, setGuardianLoading] = useState(false);
  const [allGuardianUsers, setAllGuardianUsers] = useState<UserInfo[]>([]);
  const [selectedGuardianUserId, setSelectedGuardianUserId] = useState<string>("");
  const [guardianSubmitting, setGuardianSubmitting] = useState(false);
  const [addGuardianOpen, setAddGuardianOpen] = useState(false);

  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();
  const {
    isOpen: isDeleteOpen,
    onOpen: onDeleteOpen,
    onOpenChange: onDeleteOpenChange,
    onClose: onDeleteClose,
  } = useDisclosure();
  const {
    isOpen: isGuardianOpen,
    onOpen: onGuardianOpen,
    onOpenChange: onGuardianOpenChange,
    onClose: onGuardianClose,
  } = useDisclosure();

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await getUserList();
      setUsers(data);
    } catch {}
    setLoading(false);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    onOpen();
  };

  const openEdit = (user: UserInfo) => {
    setEditingId(user.id);
    setEditingRole(user.role || "user");
    setForm({
      username: user.username,
      password: "",
      name: user.name,
      age: user.age,
      gender: user.gender || "",
      address: user.address || "",
    });
    onOpen();
  };

  const openDelete = (id: number) => {
    setDeleteId(id);
    onDeleteOpen();
  };

  const openGuardianModal = async (user: UserInfo) => {
    setGuardianUserId(user.id);
    setGuardianUserName(user.name);
    setGuardians([]);
    setSelectedGuardianUserId("");
    setAddGuardianOpen(false);
    setGuardianLoading(true);
    onGuardianOpen();
    try {
      const [guardianList, guardianUsers] = await Promise.all([
        getGuardians(user.id),
        getAdminGuardians(),
      ]);
      setGuardians(guardianList);
      setAllGuardianUsers(guardianUsers);
    } catch {}
    setGuardianLoading(false);
  };

  const handleSubmit = async () => {
    if (!form.username || !form.name || (!editingId && !form.password)) return;
    setSubmitting(true);
    try {
      if (editingId) {
        const { password, ...rest } = form;
        const updatePayload = password ? form : rest;
        await updateUser(editingId, { ...updatePayload, role: editingRole } as any);
      } else {
        await createUser(form);
      }
      await loadUsers();
      onClose();
    } catch {}
    setSubmitting(false);
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      await deleteUser(deleteId);
      await loadUsers();
      onDeleteClose();
    } catch {}
  };

  const handleAddGuardianLink = async () => {
    if (!guardianUserId || !selectedGuardianUserId) return;
    setGuardianSubmitting(true);
    try {
      await addGuardianLink(guardianUserId, parseInt(selectedGuardianUserId));
      const guardianList = await getGuardians(guardianUserId);
      setGuardians(guardianList);
      setSelectedGuardianUserId("");
      setAddGuardianOpen(false);
    } catch (e: any) {
      alert(e?.message || "添加失败");
    }
    setGuardianSubmitting(false);
  };

  const handleDeleteGuardian = async (guardianId: number) => {
    if (!guardianUserId) return;
    try {
      await deleteGuardianLink(guardianUserId, guardianId);
      const guardianList = await getGuardians(guardianUserId);
      setGuardians(guardianList);
    } catch (e: any) {
      alert(e?.message || "删除失败");
    }
  };

  // 过滤掉已经关联的监护人用户，以及该用户本身
  const availableGuardianUsers = allGuardianUsers.filter(
    (gu) =>
      gu.id !== guardianUserId &&
      !guardians.some((g: any) => g.guardian_user_id === gu.id)
  );

  const filtered = users.filter(
    (u) =>
      u.name?.includes(searchText) ||
      u.username?.includes(searchText) ||
      u.address?.includes(searchText)
  );

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">用户管理</h1>
          <p className="text-gray-500 text-sm mt-1">管理系统注册用户</p>
        </div>
        <Button color="primary" onPress={openCreate}>
          + 新建用户
        </Button>
      </div>

      {/* 搜索 */}
      <div className="mb-4 max-w-xs">
        <Input
          placeholder="搜索姓名/用户名/地址..."
          value={searchText}
          onValueChange={setSearchText}
          variant="bordered"
          size="sm"
        />
      </div>

      {/* 表格 */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">姓名</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">用户名</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">角色</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">年龄</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">性别</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">创建时间</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">加载中...</td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-gray-400">暂无数据</td>
              </tr>
            ) : (
              filtered.map((user) => (
                <tr key={user.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/users/${user.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {user.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.username}</td>
                  <td className="px-4 py-3">
                    {user.role === "super_admin" ? (
                      <Chip size="sm" variant="flat" color="warning">超管</Chip>
                    ) : user.role === "guardian" ? (
                      <Chip size="sm" variant="flat" color="success">监护人</Chip>
                    ) : (
                      <Chip size="sm" variant="flat" color="default">普通用户</Chip>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{user.age ?? "-"}</td>
                  <td className="px-4 py-3">
                    {user.gender ? (
                      <Chip size="sm" variant="flat" color={user.gender === "male" ? "primary" : "secondary"}>
                        {user.gender === "male" ? "男" : user.gender === "female" ? "女" : user.gender}
                      </Chip>
                    ) : "-"}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {user.created_at ? new Date(user.created_at).toLocaleDateString("zh-CN") : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/admin/users/${user.id}`}>
                        <Button size="sm" variant="flat" color="default">详情</Button>
                      </Link>
                      <Button size="sm" variant="flat" color="primary" onPress={() => openEdit(user)}>编辑</Button>
                      {user.role !== "guardian" && user.role !== "super_admin" && (
                        <Button size="sm" variant="flat" color="secondary" onPress={() => openGuardianModal(user)}>监护人</Button>
                      )}
                      <Button size="sm" variant="flat" color="danger" onPress={() => openDelete(user.id)}>删除</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* 创建/编辑 Modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="lg">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>{editingId ? "编辑用户" : "新建用户"}</ModalHeader>
              <ModalBody className="gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="用户名"
                    placeholder="登录用户名"
                    isRequired
                    value={form.username}
                    onValueChange={(v) => setForm({ ...form, username: v })}
                    isDisabled={!!editingId}
                  />
                  <Input
                    label="密码"
                    placeholder={editingId ? "留空则不修改" : "登录密码"}
                    type="password"
                    isRequired={!editingId}
                    value={form.password}
                    onValueChange={(v) => setForm({ ...form, password: v })}
                  />
                  <Input
                    label="姓名"
                    placeholder="真实姓名"
                    isRequired
                    value={form.name}
                    onValueChange={(v) => setForm({ ...form, name: v })}
                  />
                  <Input
                    label="年龄"
                    placeholder="年龄"
                    type="number"
                    value={form.age?.toString() || ""}
                    onValueChange={(v) => setForm({ ...form, age: v ? parseInt(v) : undefined })}
                  />
                  <Select
                    label="性别"
                    selectedKeys={form.gender ? [form.gender] : []}
                    onSelectionChange={(keys) => setForm({ ...form, gender: Array.from(keys)[0] as string })}
                  >
                    {GENDER_OPTIONS.map((g) => (
                      <SelectItem key={g.key}>{g.label}</SelectItem>
                    ))}
                  </Select>
                  <Input
                    label="地址"
                    placeholder="家庭住址"
                    value={form.address || ""}
                    onValueChange={(v) => setForm({ ...form, address: v })}
                  />
                  {editingId && (
                    <Select
                      label="角色"
                      selectedKeys={[editingRole]}
                      onSelectionChange={(keys) => setEditingRole(Array.from(keys)[0] as string)}
                      className="col-span-2"
                    >
                      {ROLE_OPTIONS.map((r) => (
                        <SelectItem key={r.key}>{r.label}</SelectItem>
                      ))}
                    </Select>
                  )}
                </div>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>取消</Button>
                <Button color="primary" isLoading={submitting} onPress={handleSubmit}>
                  {editingId ? "保存" : "创建"}
                </Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* 删除确认 Modal */}
      <Modal isOpen={isDeleteOpen} onOpenChange={onDeleteOpenChange} size="sm">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>确认删除</ModalHeader>
              <ModalBody>
                <p className="text-gray-600">确定要删除该用户吗？此操作不可恢复。</p>
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onDeleteClose}>取消</Button>
                <Button color="danger" onPress={handleDelete}>删除</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* 监护人管理 Modal */}
      <Modal isOpen={isGuardianOpen} onOpenChange={onGuardianOpenChange} size="lg">
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col gap-1">
                <span>{guardianUserName} 的监护人</span>
                <span className="text-sm font-normal text-gray-400">管理该用户绑定的监护人</span>
              </ModalHeader>
              <ModalBody>
                {guardianLoading ? (
                  <div className="py-8 text-center text-gray-400">加载中...</div>
                ) : (
                  <div className="space-y-4">
                    {/* 当前监护人列表 */}
                    {guardians.length === 0 ? (
                      <p className="text-gray-400 text-sm py-2">暂无监护人，请添加</p>
                    ) : (
                      <div className="space-y-2">
                        {guardians.map((g: any, i: number) => (
                          <div
                            key={g.id || i}
                            className="flex items-center justify-between p-3 rounded-lg bg-gray-50 border border-gray-100"
                          >
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-semibold text-sm">
                                {g.name?.[0] || "?"}
                              </div>
                              <div>
                                <p className="font-medium text-gray-800 text-sm">{g.name}</p>
                                {g.phone && <p className="text-xs text-gray-500">{g.phone}</p>}
                                {g.guardian_user_id && (
                                  <p className="text-xs text-green-600">系统用户</p>
                                )}
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

                    {/* 添加监护人区域 */}
                    {addGuardianOpen ? (
                      <div className="border border-blue-100 rounded-lg p-4 bg-blue-50 space-y-3">
                        <p className="text-sm font-medium text-gray-700">选择监护人用户</p>
                        {availableGuardianUsers.length === 0 ? (
                          <p className="text-sm text-gray-400">暂无可选的监护人用户（所有监护人角色用户均已绑定，或系统中没有监护人角色用户）</p>
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
                    ) : (
                      <Button
                        size="sm"
                        color="primary"
                        variant="flat"
                        onPress={() => setAddGuardianOpen(true)}
                      >
                        + 添加监护人
                      </Button>
                    )}
                  </div>
                )}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onGuardianClose}>关闭</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
