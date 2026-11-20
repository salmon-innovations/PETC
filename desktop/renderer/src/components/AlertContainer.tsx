import { forwardRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle,
  XCircle,
  PencilSimple,
  Trash,
  Bug,
  X,
} from "@phosphor-icons/react";
import { useAlertStore, type AlertItem, type AlertType } from "../store/alertStore";

export default function AlertContainer() {
  const alerts = useAlertStore((s) => s.alerts);
  const removeAlert = useAlertStore((s) => s.removeAlert);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed top-5 right-5 z-[9999] flex flex-col gap-3 pointer-events-none w-full max-w-sm sm:max-w-md px-4 sm:px-0"
    >
      <AnimatePresence mode="popLayout">
        {alerts.map((alert) => (
          <AlertCard
            key={alert.id}
            alert={alert}
            onDismiss={() => removeAlert(alert.id)}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface AlertCardProps {
  alert: AlertItem;
  onDismiss: () => void;
}

const TYPE_CONFIG: Record<
  AlertType,
  {
    icon: typeof CheckCircle;
    titleColor: string;
    iconBg: string;
    iconColor: string;
    borderColor: string;
    glowShadow: string;
    progressBarColor: string;
    tagText: string;
    tagBadge: string;
  }
> = {
  success: {
    icon: CheckCircle,
    titleColor: "text-slate-900",
    iconBg: "bg-emerald-50 border border-emerald-200",
    iconColor: "text-emerald-600",
    borderColor: "border-emerald-500/40",
    glowShadow: "shadow-lg shadow-emerald-950/10",
    progressBarColor: "bg-emerald-500",
    tagText: "Success",
    tagBadge: "bg-emerald-100 text-emerald-800 border-emerald-200",
  },
  delete: {
    icon: Trash,
    titleColor: "text-slate-900",
    iconBg: "bg-amber-50 border border-amber-200",
    iconColor: "text-amber-600",
    borderColor: "border-amber-500/40",
    glowShadow: "shadow-lg shadow-amber-950/10",
    progressBarColor: "bg-amber-500",
    tagText: "Deleted / Removed",
    tagBadge: "bg-amber-100 text-amber-800 border-amber-200",
  },
  edit: {
    icon: PencilSimple,
    titleColor: "text-slate-900",
    iconBg: "bg-blue-50 border border-blue-200",
    iconColor: "text-blue-600",
    borderColor: "border-blue-500/40",
    glowShadow: "shadow-lg shadow-blue-950/10",
    progressBarColor: "bg-blue-600",
    tagText: "Updated",
    tagBadge: "bg-blue-100 text-blue-800 border-blue-200",
  },
  error: {
    icon: XCircle,
    titleColor: "text-slate-900",
    iconBg: "bg-red-50 border border-red-200",
    iconColor: "text-red-600",
    borderColor: "border-red-500/40",
    glowShadow: "shadow-lg shadow-red-950/10",
    progressBarColor: "bg-red-600",
    tagText: "Error",
    tagBadge: "bg-red-100 text-red-800 border-red-200",
  },
  bug: {
    icon: Bug,
    titleColor: "text-slate-900",
    iconBg: "bg-purple-50 border border-purple-200",
    iconColor: "text-purple-600",
    borderColor: "border-purple-500/40",
    glowShadow: "shadow-lg shadow-purple-950/10",
    progressBarColor: "bg-purple-600",
    tagText: "Bug Alert",
    tagBadge: "bg-purple-100 text-purple-800 border-purple-200",
  },
};

const AlertCard = forwardRef<HTMLDivElement, AlertCardProps>(function AlertCard({ alert, onDismiss }, ref) {
  const config = TYPE_CONFIG[alert.type];
  const IconComponent = config.icon;
  const [isPaused, setIsPaused] = useState(false);
  const duration = alert.duration ?? 1800;

  useEffect(() => {
    if (isPaused || duration <= 0) return;

    const timer = setTimeout(() => {
      onDismiss();
    }, duration);

    return () => clearTimeout(timer);
  }, [isPaused, duration, alert.timestamp, onDismiss]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, x: 60, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.92, transition: { duration: 0.15, ease: "easeOut" } }}
      transition={{ type: "spring", stiffness: 480, damping: 32 }}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={`pointer-events-auto relative overflow-hidden rounded-2xl bg-white/95 backdrop-blur-md border ${config.borderColor} ${config.glowShadow} p-4 sm:p-4.5 transition-shadow`}
    >
      <div className="flex items-start gap-3.5">
        {/* Icon Badge */}
        <div
          className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 shadow-xs ${config.iconBg}`}
        >
          <IconComponent size={24} weight="fill" className={config.iconColor} />
        </div>

        {/* Text Content */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-center gap-2 mb-0.5">
            <h4 className={`text-base font-black tracking-tight leading-tight ${config.titleColor}`}>
              {alert.title}
            </h4>
            <span
              className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border tracking-wide ${config.tagBadge}`}
            >
              {config.tagText}
            </span>
          </div>

          {alert.message && (
            <p className="text-sm font-medium text-slate-600 leading-snug break-words">
              {alert.message}
            </p>
          )}
        </div>

        {/* Close Button */}
        <button
          type="button"
          onClick={onDismiss}
          className="text-slate-400 hover:text-slate-700 hover:bg-slate-100 p-1.5 rounded-xl transition-colors cursor-pointer flex-shrink-0 -mr-1 -mt-1"
          aria-label="Dismiss notification"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      {/* Auto-dismiss progress bar */}
      {duration > 0 && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-100 overflow-hidden">
          <motion.div
            key={alert.timestamp}
            initial={{ width: "100%" }}
            animate={{ width: isPaused ? "100%" : "0%" }}
            transition={{
              duration: isPaused ? 0 : duration / 1000,
              ease: "linear",
            }}
            className={`h-full ${config.progressBarColor}`}
          />
        </div>
      )}
    </motion.div>
  );
});

