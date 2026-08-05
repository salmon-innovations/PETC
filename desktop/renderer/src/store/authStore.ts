/**
 * Local auth store — authenticates against the sidecar's /auth/login endpoint.
 * Credentials are verified against the local SQLite users table (no cloud needed).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";
import type { User } from "../types";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      async login(email, password) {
        const base = await window.petcBridge.getSidecarUrl();
        const { data } = await axios.post(`${base}/auth/login`, { email, password });
        set({ user: data.user, token: data.token, isAuthenticated: true });
      },

      logout() {
        set({ user: null, token: null, isAuthenticated: false });
      },
    }),
    { name: "petc-auth", partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }
  )
);
