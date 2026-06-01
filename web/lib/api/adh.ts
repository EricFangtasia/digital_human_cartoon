/**
 * ADH后端API封装
 * 管理用户、监护人、对话记录、危机上报、通知配置等接口
 */

import "whatwg-fetch";
import { getHost } from "./requests";

const ADH_PREFIX = "/adh";

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("adh_token");
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function parseResponse(res: Response): Promise<any> {
  // 处理 HTTP 错误状态码（401未授权、403禁止访问等）
  if (res.status === 401 || res.status === 403) {
    throw new Error("认证失败，请重新登录");
  }
  if (!res.ok) {
    throw new Error(`请求失败: ${res.status}`);
  }
  const data = await res.json();
  // 处理错误的业务响应（detail 字段表示后端错误）
  if (data.detail && !data.data && !data.code) {
    throw new Error(data.detail);
  }
  if (data.code !== undefined && data.code !== 0) {
    throw new Error(data.message || "请求失败");
  }
  return data;
}

async function adhGet(path: string): Promise<any> {
  const url = getHost() + ADH_PREFIX + path;
  const res = await fetch(url, {
    method: "GET",
    headers: authHeaders(),
  });
  return parseResponse(res);
}

async function adhPost(path: string, body?: any): Promise<any> {
  const url = getHost() + ADH_PREFIX + path;
  const res = await fetch(url, {
    method: "POST",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseResponse(res);
}

async function adhPut(path: string, body?: any): Promise<any> {
  const url = getHost() + ADH_PREFIX + path;
  const res = await fetch(url, {
    method: "PUT",
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  return parseResponse(res);
}

async function adhDelete(path: string): Promise<any> {
  const url = getHost() + ADH_PREFIX + path;
  const res = await fetch(url, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return parseResponse(res);
}

// ============ 类型定义 ============

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: UserInfo;
}

export interface RegisterRequest {
  username: string;
  password: string;
  name?: string;
  age?: number;
  gender?: string;
  address?: string;
}

export interface WechatLoginRequest {
  wechat_openid: string;
}

export interface WechatBindLoginRequest {
  username: string;
  password: string;
  wechat_openid: string;
}

export interface WechatOAuthConfig {
  enabled: boolean;
  app_id?: string;
  scope?: string;
}

export interface UserInfo {
  id: number;
  username: string;
  name: string;
  role?: "super_admin" | "guardian" | "user";
  age?: number;
  gender?: string;
  address?: string;
  created_at?: string;
}

export interface CreateUserRequest {
  username: string;
  password: string;
  name: string;
  age?: number;
  gender?: string;
  address?: string;
  guardians?: Guardian[];
}

export interface Guardian {
  id?: number;
  name: string;
  phone: string;
  relationship?: string;
}

export interface Conversation {
  id: number;
  user_id: number;
  content: string;
  created_at: string;
}

export interface CrisisReport {
  id: number;
  user_id: number;
  user_name?: string;
  severity: "low" | "medium" | "high" | "urgent";
  description: string;
  notification_channels?: string;
  created_at: string;
}

export interface NotificationConfig {
  channel: string;
  enabled: boolean;
  config_json?: Record<string, any>;
}

// ============ 用户相关 ============

export async function login(req: LoginRequest): Promise<LoginResponse> {
  const url = getHost() + ADH_PREFIX + "/user/login";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return parseResponse(res);
}

export async function register(req: RegisterRequest): Promise<LoginResponse> {
  const url = getHost() + ADH_PREFIX + "/user/register";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return parseResponse(res);
}

export async function wechatLogin(req: WechatLoginRequest): Promise<LoginResponse> {
  const url = getHost() + ADH_PREFIX + "/user/wechat-login";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return parseResponse(res);
}

export async function wechatBindLogin(req: WechatBindLoginRequest): Promise<LoginResponse> {
  const url = getHost() + ADH_PREFIX + "/user/wechat-bind-login";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });
  return parseResponse(res);
}

export async function getWechatOAuthConfig(): Promise<WechatOAuthConfig> {
  const data = await adhGet("/user/wechat/oauth-config");
  return data.data || data;
}

export async function getWechatOAuthUrl(redirectUri?: string): Promise<string> {
  const url = getHost() + ADH_PREFIX + "/user/wechat/oauth-url";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uri: redirectUri,
      state: "adh",
    }),
  });
  const data = await parseResponse(res);
  return data.url;
}

export async function getUserProfile(): Promise<UserInfo> {
  const data = await adhGet("/user/profile");
  return data.user || data.data || data;
}

export async function getUserList(): Promise<UserInfo[]> {
  const data = await adhGet("/user/list");
  return Array.isArray(data) ? data : (data.users || data.data || []);
}

export async function createUser(req: CreateUserRequest): Promise<UserInfo> {
  const data = await adhPost("/user/create", req);
  return data.data || data;
}

export async function updateUser(id: number, req: Partial<CreateUserRequest>): Promise<UserInfo> {
  const data = await adhPut(`/user/${id}`, req);
  return data.data || data;
}

export async function deleteUser(id: number): Promise<void> {
  await adhDelete(`/user/${id}`);
}

// ============ 我的监护人（普通用户自助管理）============

export interface MyGuardian {
  id: number;
  name: string;
  phone?: string;
  email?: string;
  dingtalk?: string;
  wechat?: string;
}

export async function getMyGuardians(): Promise<MyGuardian[]> {
  const data = await adhGet("/user/my-guardians");
  return Array.isArray(data) ? data : (data.guardians || data.data || []);
}

export async function addMyGuardian(body: {
  name: string;
  phone?: string;
  email?: string;
  dingtalk?: string;
  wechat?: string;
}): Promise<MyGuardian> {
  const data = await adhPost("/user/my-guardian", body);
  return data.data || data;
}

export async function deleteMyGuardian(guardianId: number): Promise<void> {
  await adhDelete(`/user/my-guardian/${guardianId}`);
}

// ============ 监护人相关（管理员） ============

export async function getGuardians(userId: number): Promise<Guardian[]> {
  const data = await adhGet(`/user/${userId}/guardians`);
  return Array.isArray(data) ? data : (data.guardians || data.data || []);
}

export async function addOrUpdateGuardian(userId: number, guardian: Guardian): Promise<Guardian> {
  const data = await adhPost(`/user/${userId}/guardian`, guardian);
  return data.data || data;
}

/**
 * 通过guardian用户ID关联监护人（新方式）
 */
export async function addGuardianLink(userId: number, guardianUserId: number): Promise<void> {
  await adhPost(`/user/${userId}/guardian-link`, { guardian_user_id: guardianUserId });
}

/**
 * 删除用户的监护人关联
 */
export async function deleteGuardianLink(userId: number, guardianId: number): Promise<void> {
  await adhDelete(`/user/${userId}/guardian/${guardianId}`);
}

// ============ 对话记录 ============

export async function getUserConversations(userId: number): Promise<Conversation[]> {
  const data = await adhGet(`/user/conversations/${userId}`);
  return Array.isArray(data) ? data : (data.conversations || data.data || []);
}

// ============ 危机上报 ============

export async function getCrisisReports(): Promise<CrisisReport[]> {
  const data = await adhGet("/user/crisis-reports");
  return Array.isArray(data) ? data : (data.reports || data.crisis_reports || data.data || []);
}

// ============ 通知配置（当前登录用户自己的） ============

export async function getNotificationConfigs(): Promise<NotificationConfig[]> {
  const data = await adhGet("/notification/config");
  // 后端返回格式: { code: 0, configs: [...] }，config_json 为 JSON 字符串需要解析
  const list: any[] = Array.isArray(data)
    ? data
    : (data.configs || data.data || []);
  return list.map((item: any) => ({
    ...item,
    enabled: Boolean(item.enabled),
    config_json:
      typeof item.config_json === "string"
        ? (() => { try { return JSON.parse(item.config_json); } catch { return {}; } })()
        : (item.config_json || {}),
  })) as NotificationConfig[];
}

export async function updateNotificationConfig(
  channel: string,
  config: { enabled: boolean; config_json?: Record<string, any> }
): Promise<NotificationConfig> {
  // 将 config_json 对象序列化为字符串，后端期望 string 类型
  const payload = {
    ...config,
    config_json:
      config.config_json !== undefined && typeof config.config_json !== "string"
        ? JSON.stringify(config.config_json)
        : config.config_json,
  };
  await adhPut(`/notification/config/${channel}`, payload);
  // 后端 PUT 只返回 {code:0, message}，不返回 config 对象，重新获取最新配置
  const configs = await getNotificationConfigs();
  const updated = configs.find((c) => c.channel === channel);
  return updated || { channel, enabled: config.enabled, config_json: config.config_json || {} };
}

// ============ 管理员：监护人列表 ============

export async function getAdminGuardians(): Promise<UserInfo[]> {
  const data = await adhGet("/admin/guardians");
  return Array.isArray(data) ? data : (data.guardians || data.data || []);
}

// ============ 监护人通知配置（管理员操作指定用户） ============

function parseNotificationList(data: any): NotificationConfig[] {
  const list: any[] = Array.isArray(data)
    ? data
    : (data.configs || data.data || []);
  return list.map((item: any) => ({
    ...item,
    enabled: Boolean(item.enabled),
    config_json:
      typeof item.config_json === "string"
        ? (() => { try { return JSON.parse(item.config_json); } catch { return {}; } })()
        : (item.config_json || {}),
  })) as NotificationConfig[];
}

export async function getGuardianNotificationConfig(userId: number): Promise<NotificationConfig[]> {
  const data = await adhGet(`/guardian/notification-config/${userId}`);
  return parseNotificationList(data);
}

export async function updateGuardianNotificationConfig(
  userId: number,
  channel: string,
  config: { enabled: boolean; config_json?: Record<string, any> }
): Promise<NotificationConfig> {
  const payload = {
    ...config,
    config_json:
      config.config_json !== undefined && typeof config.config_json !== "string"
        ? JSON.stringify(config.config_json)
        : config.config_json,
  };
  await adhPut(`/guardian/notification-config/${userId}/${channel}`, payload);
  const configs = await getGuardianNotificationConfig(userId);
  const updated = configs.find((c) => c.channel === channel);
  return updated || { channel, enabled: config.enabled, config_json: config.config_json || {} };
}
