import { create } from "zustand";
import type { User, AuthTokens } from "../types";
import { api, setTokens, clearTokens, getTokens } from "../api/webClient";

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: !!getTokens(),

  async login(email, password) {
    const { data } = await api.post<AuthTokens & { user: User }>(
      "/auth/login",
      { email, password }
    );
    setTokens({ accessToken: data.accessToken, refreshToken: data.refreshToken });
    set({ user: data.user, isAuthenticated: true });
  },

  async logout() {
    const tokens = getTokens();
    if (tokens?.refreshToken) {
      await api.post("/auth/logout", { refreshToken: tokens.refreshToken }).catch(() => {});
    }
    clearTokens();
    set({ user: null, isAuthenticated: false });
  },
}));
