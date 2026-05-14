"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardBody,
  CardHeader,
  Switch,
  Button,
  Input,
  Modal,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Chip,
} from "@heroui/react";
import {
  getGuardianNotificationConfig,
  updateGuardianNotificationConfig,
  NotificationConfig,
} from "@/lib/api/adh";
import { useAuthStore } from "@/lib/store/auth";

interface ChannelDef {
  key: string;
  label: string;
  icon: string;
  color: string;
  fields: { key: string; label: string; type?: string; placeholder?: string }[];
}

const CHANNELS: ChannelDef[] = [
  {
    key: "sms",
    label: "短信通知",
    icon: "📱",
    color: "bg-green-50 border-green-200",
    fields: [
      { key: "access_key_id", label: "Access Key ID", placeholder: "阿里云 AccessKeyId" },
      { key: "access_key_secret", label: "Access Key Secret", type: "password", placeholder: "阿里云 AccessKeySecret" },
      { key: "sign_name", label: "短信签名", placeholder: "如：沐光平台" },
      { key: "template_code", label: "模板 Code", placeholder: "如：SMS_123456789" },
    ],
  },
  {
    key: "email",
    label: "邮件通知",
    icon: "📧",
    color: "bg-blue-50 border-blue-200",
    fields: [
      { key: "smtp_host", label: "SMTP 服务器", placeholder: "如：smtp.qq.com" },
      { key: "smtp_port", label: "SMTP 端口", placeholder: "如：465" },
      { key: "smtp_user", label: "发件邮箱", placeholder: "your@email.com" },
      { key: "smtp_password", label: "邮箱密码/授权码", type: "password", placeholder: "邮箱密码或授权码" },
      { key: "to_email", label: "收件邮箱", placeholder: "接收通知的邮箱地址" },
    ],
  },
  {
    key: "dingtalk",
    label: "钉钉通知",
    icon: "🔷",
    color: "bg-cyan-50 border-cyan-200",
    fields: [
      { key: "webhook_url", label: "Webhook URL", placeholder: "钉钉机器人 Webhook 地址" },
      { key: "secret", label: "加签密钥", placeholder: "钉钉机器人加签密钥（可选）" },
    ],
  },
  {
    key: "wecom",
    label: "企业微信通知",
    icon: "💬",
    color: "bg-emerald-50 border-emerald-200",
    fields: [
      { key: "webhook_url", label: "Webhook URL", placeholder: "企业微信机器人 Webhook 地址" },
    ],
  },
];

export default function MyNotificationsPage() {
  const { user } = useAuthStore();
  const [configs, setConfigs] = useState<Record<string, NotificationConfig>>({});
  const [loading, setLoading] = useState(true);
  const [editChannel, setEditChannel] = useState<ChannelDef | null>(null);
  const [editForm, setEditForm] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const { isOpen, onOpen, onOpenChange, onClose } = useDisclosure();

  useEffect(() => {
    if (user?.id) loadConfigs();
  }, [user?.id]);

  const loadConfigs = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const list = await getGuardianNotificationConfig(user.id);
      const map: Record<string, NotificationConfig> = {};
      list.forEach((c) => {
        map[c.channel] = c;
      });
      setConfigs(map);
    } catch {}
    setLoading(false);
  };

  const handleToggle = async (channel: string, enabled: boolean) => {
    if (!user?.id) return;
    const current = configs[channel];
    try {
      const updated = await updateGuardianNotificationConfig(user.id, channel, {
        enabled,
        config_json: current?.config_json,
      });
      setConfigs((prev) => ({ ...prev, [channel]: updated }));
    } catch {}
  };

  const openConfig = (ch: ChannelDef) => {
    const current = configs[ch.key];
    const form: Record<string, string> = {};
    ch.fields.forEach((f) => {
      form[f.key] = current?.config_json?.[f.key] || "";
    });
    setEditForm(form);
    setEditChannel(ch);
    onOpen();
  };

  const handleSaveConfig = async () => {
    if (!editChannel || !user?.id) return;
    setSubmitting(true);
    try {
      const current = configs[editChannel.key];
      const updated = await updateGuardianNotificationConfig(user.id, editChannel.key, {
        enabled: current?.enabled || false,
        config_json: editForm,
      });
      setConfigs((prev) => ({ ...prev, [editChannel.key]: updated }));
      onClose();
    } catch {}
    setSubmitting(false);
  };

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">我的通知配置</h1>
        <p className="text-gray-500 text-sm mt-1">配置我的危机事件通知推送渠道</p>
      </div>

      {loading ? (
        <div className="text-center text-gray-400 py-12">加载中...</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {CHANNELS.map((ch) => {
            const config = configs[ch.key];
            const isEnabled = config?.enabled || false;
            const hasConfig = config?.config_json && Object.values(config.config_json).some(Boolean);

            return (
              <Card key={ch.key} className={`border ${ch.color} shadow-sm`}>
                <CardHeader className="px-6 pt-6 pb-3">
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-3">
                      <span className="text-3xl">{ch.icon}</span>
                      <div>
                        <p className="font-semibold text-gray-800">{ch.label}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          {hasConfig ? (
                            <Chip size="sm" color="success" variant="flat">已配置</Chip>
                          ) : (
                            <Chip size="sm" color="default" variant="flat">未配置</Chip>
                          )}
                          {isEnabled && (
                            <Chip size="sm" color="primary" variant="flat">已启用</Chip>
                          )}
                        </div>
                      </div>
                    </div>
                    <Switch
                      isSelected={isEnabled}
                      onValueChange={(v) => handleToggle(ch.key, v)}
                      color="success"
                    />
                  </div>
                </CardHeader>
                <CardBody className="px-6 pb-6 pt-1">
                  <div className="text-xs text-gray-500 mb-3">
                    {ch.fields.map((f) => f.label).join(" · ")}
                  </div>
                  <Button
                    size="sm"
                    variant="flat"
                    color="primary"
                    onPress={() => openConfig(ch)}
                  >
                    配置参数
                  </Button>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* 配置 Modal */}
      <Modal isOpen={isOpen} onOpenChange={onOpenChange} size="md">
        <ModalContent>
          {() => (
            <>
              <ModalHeader>
                {editChannel?.icon} {editChannel?.label} 配置
              </ModalHeader>
              <ModalBody className="gap-4">
                {editChannel?.fields.map((f) => (
                  <Input
                    key={f.key}
                    label={f.label}
                    placeholder={f.placeholder}
                    type={f.type || "text"}
                    value={editForm[f.key] || ""}
                    onValueChange={(v) => setEditForm({ ...editForm, [f.key]: v })}
                  />
                ))}
              </ModalBody>
              <ModalFooter>
                <Button variant="flat" onPress={onClose}>取消</Button>
                <Button color="primary" isLoading={submitting} onPress={handleSaveConfig}>保存</Button>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>
    </div>
  );
}
