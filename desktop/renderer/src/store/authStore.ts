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
  updateProfile: (profile: Partial<User>) => Promise<User>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  updateAvatar: (avatarData: { avatarColor?: string; avatarUrl?: string | null }) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      isAuthenticated: false,

      async login(email, password) {
        const base = await window.petcBridge.getSidecarUrl();
        const { data } = await axios.post(`${base}/auth/login`, { email, password });
        const prevUser = get().user;
        const newUser: User = {
          ...data.user,
          avatarColor: prevUser?.id === data.user.id ? prevUser?.avatarColor : undefined,
          avatarUrl: prevUser?.id === data.user.id ? prevUser?.avatarUrl : undefined,
        };
        set({ user: newUser, token: data.token, isAuthenticated: true });
      },

      logout() {
        set({ user: null, token: null, isAuthenticated: false });
      },

      async updateProfile(profileUpdates) {
        const currentUser = get().user;
        const base = await window.petcBridge.getSidecarUrl();
        let updatedUser: User = {
          ...(currentUser || {
            id: "op1",
            email: "operator@petc.local",
            fullName: "Mock PETC Operator",
            role: "operator",
          }),
          ...profileUpdates,
        };

        try {
          const { data } = await axios.put(`${base}/auth/profile`, {
            user_id: currentUser?.id,
            email: profileUpdates.email ?? currentUser?.email,
            full_name: profileUpdates.fullName ?? currentUser?.fullName,
            tesda_cert_no: profileUpdates.tesdaCertNo ?? currentUser?.tesdaCertNo,
            certification_no: profileUpdates.certificationNo ?? currentUser?.certificationNo,
          });
          updatedUser = {
            ...updatedUser,
            ...data,
            avatarColor: currentUser?.avatarColor,
            avatarUrl: currentUser?.avatarUrl,
          };
        } catch (err: unknown) {
          console.warn("Could not sync profile to sidecar, persisting locally:", err);
        }

        set({ user: updatedUser });
        return updatedUser;
      },

      async changePassword(currentPassword, newPassword) {
        const currentUser = get().user;
        const base = await window.petcBridge.getSidecarUrl();
        try {
          await axios.post(`${base}/auth/change-password`, {
            user_id: currentUser?.id,
            email: currentUser?.email,
            current_password: currentPassword,
            new_password: newPassword,
          });
        } catch (err: unknown) {
          const errorObj = err as { response?: { data?: { detail?: string } }; message?: string };
          const detail = errorObj.response?.data?.detail || errorObj.message || "Failed to update password";
          throw new Error(detail);
        }
      },

      updateAvatar({ avatarColor, avatarUrl }) {
        const currentUser = get().user;
        if (!currentUser) return;
        const updatedUser: User = {
          ...currentUser,
          ...(avatarColor !== undefined ? { avatarColor } : {}),
          ...(avatarUrl !== undefined ? { avatarUrl } : {}),
        };
        set({ user: updatedUser });
      },
    }),
    { name: "petc-auth", partialize: (s) => ({ user: s.user, token: s.token, isAuthenticated: s.isAuthenticated }) }
  )
);
