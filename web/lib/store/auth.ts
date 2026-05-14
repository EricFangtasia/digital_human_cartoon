/**
 * 登录认证状态管理 (zustand)
 */
import { create } from "zustand";
import { UserInfo } from "@/lib/api/adh";

interface AuthState {
  token: string | null;
  user: UserInfo | null;
  isLoggedIn: boolean;
  setAuth: (token: string, user: UserInfo) => void;
  clearAuth: () => void;
  initFromStorage: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: null,
  user: null,
  isLoggedIn: false,

  setAuth: (token: string, user: UserInfo) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("adh_token", token);
      localStorage.setItem("adh_user", JSON.stringify(user));
    }
    set({ token, user, isLoggedIn: true });
  },

  clearAuth: () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem("adh_token");
      localStorage.removeItem("adh_user");
    }
    set({ token: null, user: null, isLoggedIn: false });
  },

  initFromStorage: () => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("adh_token");
    const userStr = localStorage.getItem("adh_user");
    if (token && userStr) {
      try {
        const user = JSON.parse(userStr) as UserInfo;
        set({ token, user, isLoggedIn: true });
      } catch {
        localStorage.removeItem("adh_token");
        localStorage.removeItem("adh_user");
      }
    }
  },
}));
