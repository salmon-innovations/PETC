/**
 * Local auth store — authenticates against the sidecar's /auth/login endpoint.
 * Credentials are verified against the local SQLite users table (no cloud needed).
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import axios from "axios";
export const useAuthStore = create()(persist((set) => ({
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
}), { name: "petc-auth", partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }));
