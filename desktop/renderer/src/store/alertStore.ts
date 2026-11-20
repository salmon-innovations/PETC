import { create } from "zustand";

export type AlertType = "success" | "delete" | "edit" | "error" | "bug";

export interface AlertItem {
  id: string;
  type: AlertType;
  title: string;
  message?: string;
  duration?: number; // ms, default 5000
  timestamp: number;
}

interface AlertState {
  alerts: AlertItem[];
  addAlert: (alert: Omit<AlertItem, "id" | "timestamp">) => string;
  removeAlert: (id: string) => void;
  clearAlerts: () => void;
}

export const useAlertStore = create<AlertState>((set) => ({
  alerts: [],

  addAlert: (alert) => {
    const id = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const now = Date.now();
    // Fast auto-dismiss (1800ms) so stacked alerts clear out quickly without lingering
    const duration = alert.duration ?? 1800;

    const newAlert: AlertItem = {
      ...alert,
      id,
      duration,
      timestamp: now,
    };

    // Stacks alerts downwards
    set((state) => {
      const current = state.alerts.length >= 6 ? state.alerts.slice(1) : state.alerts;
      return {
        alerts: [...current, newAlert],
      };
    });

    return id;
  },

  removeAlert: (id) => {
    set((state) => ({
      alerts: state.alerts.filter((a) => a.id !== id),
    }));
  },

  clearAlerts: () => set({ alerts: [] }),
}));

// Convenient standalone helper to trigger alerts with fast dismiss
export const triggerAlert = {
  success: (title: string, message?: string, duration = 1800) =>
    useAlertStore.getState().addAlert({ type: "success", title, message, duration }),

  delete: (title: string, message?: string, duration = 2000) =>
    useAlertStore.getState().addAlert({ type: "delete", title, message, duration }),

  edit: (title: string, message?: string, duration = 1600) =>
    useAlertStore.getState().addAlert({ type: "edit", title, message, duration }),

  error: (title: string, message?: string, duration = 2800) =>
    useAlertStore.getState().addAlert({ type: "error", title, message, duration }),

  bug: (title: string, message?: string, duration = 3500) =>
    useAlertStore.getState().addAlert({ type: "bug", title, message, duration }),
};

// Global error listener to automatically catch unhandled exceptions & bugs
if (typeof window !== "undefined") {
  window.addEventListener("error", (event) => {
    console.error("Global captured error:", event.error);
    const msg = event.message || (event.error && event.error.message) || "Script execution error";
    // Avoid spamming if same error
    triggerAlert.bug("System Bug Detected", msg, 8000);
  });

  window.addEventListener("unhandledrejection", (event) => {
    console.error("Global unhandled rejection:", event.reason);
    const reasonMsg =
      typeof event.reason === "string"
        ? event.reason
        : event.reason?.message ?? "Unhandled asynchronous error";
    triggerAlert.bug("System Exception", reasonMsg, 8000);
  });
}
