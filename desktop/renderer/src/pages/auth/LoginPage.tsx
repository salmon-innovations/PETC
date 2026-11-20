import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
import { motion, AnimatePresence } from "framer-motion";
import {
  EnvelopeSimple,
  LockKey,
  Eye,
  EyeSlash,
  CircleNotch,
  ShieldCheck,
  Gauge,
  Camera,
  WarningCircle,
  Sparkle,
  CheckCircle,
  Cpu,
  Database,
  ArrowRight,
  Clock,
  Broadcast,
  CloudArrowUp,
  Pulse,
} from "@phosphor-icons/react";
import { triggerAlert } from "../../store/alertStore";

const schema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});
type FormValues = z.infer<typeof schema>;

export default function LoginPage() {
  const login = useAuthStore((s) => s.login);
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date().toLocaleTimeString());

  // Real-time workstation clock
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date().toLocaleTimeString());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const {
    register,
    handleSubmit,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await login(values.email, values.password);
      triggerAlert.success("Login Successful", `Signed in successfully as ${values.email}`);
      navigate("/test");
    } catch (err: any) {
      const message =
        err?.response?.data?.detail ??
        err?.message ??
        "Invalid email or password. Please verify your credentials.";
      setError("root", { message });
      triggerAlert.error("Authentication Failed", message);
    }
  };

  const handleFillDemo = () => {
    setValue("email", "operator@petc.local", { shouldValidate: true });
    setValue("password", "operator123", { shouldValidate: true });
    triggerAlert.edit("Demo Filled", "Populated default technician credentials");
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 flex flex-col justify-between p-3 sm:p-6 lg:p-8 font-sans relative overflow-x-hidden selection:bg-emerald-500 selection:text-white">
      
      {/* ── Soft Ambient Pastel Aurora Mesh (Zero Murkiness, Gentle 60fps Float) ── */}
      <div className="absolute -top-32 -left-32 w-80 sm:w-[38rem] h-80 sm:h-[38rem] bg-gradient-to-br from-emerald-400/10 via-teal-300/8 to-transparent rounded-full blur-[90px] sm:blur-[130px] pointer-events-none animate-aurora-1" />
      <div className="absolute -bottom-32 -right-32 w-80 sm:w-[42rem] h-80 sm:h-[42rem] bg-gradient-to-tl from-sky-400/10 via-blue-300/6 to-transparent rounded-full blur-[100px] sm:blur-[140px] pointer-events-none animate-aurora-2" />

      {/* Subtle Dot Matrix Pattern with Radial Vignette */}
      <div
        className="absolute inset-0 bg-dot-pattern-light opacity-60 pointer-events-none"
        style={{
          maskImage: "radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 80%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, rgba(0,0,0,1) 35%, rgba(0,0,0,0) 80%)",
        }}
      />

      {/* Top Accent Gradient Line */}
      <div className="absolute top-0 inset-x-0 h-[2.5px] bg-gradient-to-r from-transparent via-emerald-500 to-transparent" />

      {/* ── 1. Responsive Frosted Floating Header ── */}
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="relative z-20 w-full max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2.5 sm:gap-4 py-2 px-3.5 sm:px-5 rounded-2xl bg-white/80 backdrop-blur-md border border-slate-200/80 shadow-[0_2px_10px_-3px_rgba(0,0,0,0.04)] text-xs sm:text-sm font-semibold text-slate-700"
      >
        <div className="flex items-center gap-2.5 sm:gap-3">
          <span className="flex h-2.5 w-2.5 sm:h-3 sm:w-3 relative flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 sm:h-3 sm:w-3 bg-emerald-600" />
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-900 font-extrabold tracking-tight text-xs sm:text-sm">
              PETC WORKSTATION
            </span>
            <span className="hidden md:inline text-slate-300">·</span>
            <span className="hidden md:inline text-slate-600 font-mono text-xs">
              TERMINAL MNL-01
            </span>
            <span className="text-emerald-800 font-bold bg-emerald-50 border border-emerald-300/80 px-2 py-0.5 rounded-md text-[11px] sm:text-xs">
              LTO & DENR ACCREDITED
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 ml-auto">
          <div className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200/90 shadow-2xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl text-slate-800 font-bold text-xs sm:text-sm">
            <Clock size={16} weight="bold" className="text-emerald-600 flex-shrink-0" />
            <span className="font-mono">{currentTime} PHT</span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 bg-emerald-50 border border-emerald-300/80 px-3 py-1.5 rounded-xl text-emerald-900 font-bold text-xs">
            <Broadcast size={16} weight="bold" className="text-emerald-700 animate-pulse" />
            <span>ENCRYPTED CHANNEL</span>
          </div>
        </div>
      </motion.header>

      {/* ── 2. Main Workstation Body (Responsive Layout on Mobile & Desktop) ── */}
      <main className="relative z-10 w-full max-w-7xl mx-auto py-6 sm:py-8 lg:py-10 my-auto">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
          
          {/* ── Left Column: System Showcase, Visual Gauges & Live Telemetry ── */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className="order-2 lg:order-1 lg:col-span-7 space-y-6 sm:space-y-7"
          >
            {/* Accreditation Badge */}
            <div className="inline-flex items-center gap-2 bg-white border border-slate-200 shadow-2xs px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold text-slate-800">
              <ShieldCheck size={18} weight="fill" className="text-emerald-600 flex-shrink-0" />
              <span>Republic of the Philippines · Clean Air Act Compliance</span>
            </div>

            {/* Hero Branding */}
            <div className="space-y-3 sm:space-y-4">
              <div className="flex items-center gap-4 sm:gap-5">
                {/* Modern Emblem with Pulsing Ripple */}
                <div className="relative flex-shrink-0">
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl sm:rounded-3xl bg-gradient-to-tr from-emerald-600 via-teal-500 to-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-600/25">
                    <Gauge size={38} weight="fill" className="sm:scale-110" />
                  </div>
                  <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 border-2 border-white rounded-full" />
                </div>

                <div>
                  <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
                    PETC Workstation
                  </h1>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm sm:text-base font-bold text-slate-600">
                      Periodic Emission Testing Terminal
                    </span>
                    <span className="text-emerald-800 font-mono text-xs bg-emerald-100/80 border border-emerald-300 px-2 py-0.5 rounded-md font-black">
                      v2.0 PRO
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-sm sm:text-base lg:text-lg text-slate-600 leading-relaxed font-medium max-w-2xl">
                Automated testing terminal engineered for diesel opacimeter sampling, multi-gas exhaust analysis, optical license plate verification, and direct cloud transmission to the official LTO registry.
              </p>
            </div>

            {/* 3 Interactive Animated Feature Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 sm:gap-4 pt-1">
              
              {/* Card 1: Live Opacimeter & Gas Analyzer with Real-Time Waveform */}
              <motion.div
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                className="group rounded-2xl bg-white border border-slate-200/90 hover:border-emerald-500 p-4 sm:p-5 space-y-3 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-xl bg-emerald-50 border border-emerald-200/80 flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                      <Gauge size={24} weight="fill" />
                    </div>
                    <span className="text-xs font-mono font-black text-emerald-800 bg-emerald-100/80 border border-emerald-300 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-ping" />
                      READY
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 group-hover:text-emerald-700 transition-colors">
                      Live Analyzer
                    </h3>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed font-medium">
                      6-cycle peak opacity detection & multi-gas sampling.
                    </p>
                  </div>
                </div>

                {/* Animated Equalizer Waveform & Live Value */}
                <div className="pt-3 border-t border-slate-100 space-y-2">
                  <div className="flex items-end justify-between h-5 px-1">
                    <div className="w-2 rounded-full bg-emerald-500 animate-eq-1" />
                    <div className="w-2 rounded-full bg-emerald-500 animate-eq-2" />
                    <div className="w-2 rounded-full bg-emerald-500 animate-eq-3" />
                    <div className="w-2 rounded-full bg-emerald-500 animate-eq-4" />
                    <div className="w-2 rounded-full bg-emerald-500 animate-eq-5" />
                    <div className="w-2 rounded-full bg-slate-200 h-2" />
                  </div>
                  <div className="flex items-center justify-between font-mono text-[11px] font-bold text-slate-600">
                    <span>OPACITY</span>
                    <span className="text-emerald-700 font-extrabold">0.42 m⁻¹ (PASS)</span>
                  </div>
                </div>
              </motion.div>

              {/* Card 2: Computer Vision HUD with Reticle & Laser Sweep */}
              <motion.div
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                className="group rounded-2xl bg-white border border-slate-200/90 hover:border-sky-500 p-4 sm:p-5 space-y-3 shadow-xs hover:shadow-md transition-all flex flex-col justify-between relative overflow-hidden"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-xl bg-sky-50 border border-sky-200/80 flex items-center justify-center text-sky-600 group-hover:bg-sky-600 group-hover:text-white transition-colors">
                      <Camera size={24} weight="fill" />
                    </div>
                    <span className="text-xs font-mono font-black text-sky-800 bg-sky-100/80 border border-sky-300 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-600 animate-pulse" />
                      ACTIVE
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 group-hover:text-sky-700 transition-colors">
                      Vision HUD Reticle
                    </h3>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed font-medium">
                      Plate reticle alignment, watermark burn-in & audit log.
                    </p>
                  </div>
                </div>

                {/* Animated Camera HUD Viewfinder Box */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="relative rounded-lg bg-slate-50 border border-slate-200/80 p-1.5 overflow-hidden">
                    <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-sky-500 to-transparent animate-scanline-sweep pointer-events-none" />
                    <div className="flex items-center justify-between font-mono text-[11px] font-bold text-slate-700">
                      <span className="flex items-center gap-1 text-sky-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
                        CAM-01
                      </span>
                      <span className="text-[10px] bg-white px-1.5 py-0.5 rounded border border-slate-200 font-extrabold text-slate-600">
                        1080p 60FPS
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>

              {/* Card 3: LTMS Direct Sync with Uplink Heartbeat */}
              <motion.div
                whileHover={{ y: -3 }}
                transition={{ duration: 0.2 }}
                className="group rounded-2xl bg-white border border-slate-200/90 hover:border-teal-500 p-4 sm:p-5 space-y-3 shadow-xs hover:shadow-md transition-all flex flex-col justify-between"
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div className="w-11 h-11 rounded-xl bg-teal-50 border border-teal-200/80 flex items-center justify-center text-teal-600 group-hover:bg-teal-600 group-hover:text-white transition-colors">
                      <CloudArrowUp size={24} weight="fill" />
                    </div>
                    <span className="text-xs font-mono font-black text-teal-800 bg-teal-100/80 border border-teal-300 px-2.5 py-0.5 rounded-md flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-teal-600" />
                      SYNCED
                    </span>
                  </div>
                  <div>
                    <h3 className="text-base font-black text-slate-900 group-hover:text-teal-700 transition-colors">
                      LTMS Cloud Sync
                    </h3>
                    <p className="text-xs text-slate-600 mt-1 leading-relaxed font-medium">
                      Encrypted upload to national registry with instant CEC printing.
                    </p>
                  </div>
                </div>

                {/* Uplink Status Badge */}
                <div className="pt-3 border-t border-slate-100">
                  <div className="flex items-center justify-between font-mono text-[11px] font-bold text-slate-600">
                    <span className="flex items-center gap-1 text-teal-700">
                      <Pulse size={14} weight="bold" />
                      14ms PING
                    </span>
                    <span className="text-emerald-700 font-extrabold">100% UPTIME</span>
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Unified Station Telemetry Capsule (Responsive Wrap) */}
            <div className="rounded-2xl bg-white border border-slate-200 shadow-xs p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 sm:gap-4 text-xs sm:text-sm font-bold text-slate-800">
              <div className="flex items-center gap-2">
                <Cpu size={18} className="text-emerald-600 flex-shrink-0" weight="bold" />
                <span>Analyzer Engine: <strong className="text-emerald-700 font-black">Online</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <Database size={18} className="text-teal-600 flex-shrink-0" weight="bold" />
                <span>Local Database: <strong className="text-teal-700 font-black">Ready & Verified</strong></span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle size={18} className="text-sky-600 flex-shrink-0" weight="fill" />
                <span>LTO Registry: <strong className="text-sky-700 font-black">Link Active</strong></span>
              </div>
            </div>
          </motion.div>

          {/* ── Right Column: Solid White Minimalist Operator Card ── */}
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.45, ease: "easeOut", delay: 0.08 }}
            className="order-1 lg:order-2 lg:col-span-5 w-full"
          >
            {/* Animated Laser Border Beam Container with Solid White Base */}
            <div className="border-beam-card-light shadow-[0_20px_50px_-10px_rgba(15,23,42,0.08),0_1px_4px_rgba(0,0,0,0.05)] w-full">
              
              {/* Pure Opaque White Card Interior */}
              <div className="relative z-10 rounded-[24px] sm:rounded-[26px] bg-white p-6 sm:p-8 lg:p-9 space-y-5 sm:space-y-6">
                
                {/* Card Header & Quick Demo Trigger */}
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4 sm:pb-5">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                      Operator Sign In
                    </h2>
                    <p className="text-xs sm:text-sm font-semibold text-slate-500 mt-1">
                      Enter authorized credentials to unlock station
                    </p>
                  </div>

                  {/* Quick Demo Autofill Button (Large Touch Target 44px+) */}
                  <motion.button
                    type="button"
                    whileHover={{ scale: 1.04 }}
                    whileTap={{ scale: 0.96 }}
                    onClick={handleFillDemo}
                    className="inline-flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm font-black bg-emerald-50 hover:bg-emerald-100 text-emerald-900 border border-emerald-300/90 px-3 sm:px-4 py-2 sm:py-2.5 rounded-xl transition-all cursor-pointer shadow-2xs min-h-[44px] flex-shrink-0"
                    title="Click to populate default test technician credentials"
                  >
                    <Sparkle size={18} weight="fill" className="text-emerald-600 animate-spin [animation-duration:8s]" />
                    <span>Quick Demo</span>
                  </motion.button>
                </div>

                {/* Login Form */}
                <form onSubmit={handleSubmit(onSubmit)} className="space-y-5 sm:space-y-6">
                  
                  {/* Email Field (Optimized Font Size & 58px Touch Target) */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm sm:text-base font-black uppercase tracking-wide text-slate-900" htmlFor="login-email">
                        Operator Email Address
                      </label>
                      <span className="text-[11px] sm:text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        AUTH ID
                      </span>
                    </div>
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 group-focus-within:scale-110 transition-all pointer-events-none">
                        <EnvelopeSimple size={24} weight="bold" />
                      </div>
                      <input
                        {...register("email")}
                        id="login-email"
                        type="email"
                        autoComplete="email"
                        disabled={isSubmitting}
                        placeholder="operator@petc.local"
                        className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50/70 pl-14 pr-4 py-3.5 sm:py-4 text-base sm:text-lg font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 transition-all shadow-2xs disabled:opacity-50 min-h-[56px] sm:min-h-[58px]"
                      />
                    </div>
                    {errors.email && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs sm:text-sm font-bold text-red-600 mt-1 flex items-center gap-1.5"
                        role="alert"
                      >
                        <WarningCircle size={18} weight="fill" />
                        <span>{errors.email.message}</span>
                      </motion.p>
                    )}
                  </div>

                  {/* Password Field (Optimized Font Size & 58px Touch Target) */}
                  <div className="space-y-1.5 sm:space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="block text-sm sm:text-base font-black uppercase tracking-wide text-slate-900" htmlFor="login-password">
                        Workstation Password
                      </label>
                      <span className="text-[11px] sm:text-xs font-mono font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        PASSCODE
                      </span>
                    </div>
                    
                    <div className="relative group">
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 group-focus-within:scale-110 transition-all pointer-events-none">
                        <LockKey size={24} weight="bold" />
                      </div>
                      <input
                        {...register("password")}
                        id="login-password"
                        type={showPassword ? "text" : "password"}
                        autoComplete="current-password"
                        disabled={isSubmitting}
                        placeholder="••••••••••••"
                        className="w-full rounded-2xl border-2 border-slate-200 bg-slate-50/70 pl-14 pr-14 py-3.5 sm:py-4 text-base sm:text-lg font-bold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-emerald-600 focus:bg-white focus:ring-4 focus:ring-emerald-500/15 transition-all shadow-2xs disabled:opacity-50 min-h-[56px] sm:min-h-[58px]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-emerald-700 p-2.5 rounded-xl cursor-pointer transition-colors"
                        aria-label={showPassword ? "Hide password" : "Show password"}
                        title={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeSlash size={22} weight="bold" /> : <Eye size={22} weight="bold" />}
                      </button>
                    </div>
                    {errors.password && (
                      <motion.p
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="text-xs sm:text-sm font-bold text-red-600 mt-1 flex items-center gap-1.5"
                        role="alert"
                      >
                        <WarningCircle size={18} weight="fill" />
                        <span>{errors.password.message}</span>
                      </motion.p>
                    )}
                  </div>

                  {/* Server Error Notification Banner */}
                  <AnimatePresence>
                    {errors.root && (
                      <motion.div
                        initial={{ opacity: 0, y: -8, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -8, scale: 0.98 }}
                        className="flex items-start gap-3 rounded-2xl bg-red-50 border-2 border-red-200 p-3.5 sm:p-4 text-xs sm:text-sm text-red-800 font-bold shadow-xs"
                        role="alert"
                      >
                        <WarningCircle size={20} weight="fill" className="text-red-600 flex-shrink-0 mt-0.5" />
                        <span>{errors.root.message}</span>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Clean Vibrant Emerald Action Button (58px touch target) */}
                  <motion.button
                    type="submit"
                    disabled={isSubmitting}
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.985 }}
                    className="group relative w-full overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-500 hover:to-teal-500 text-white font-black text-lg sm:text-xl py-4 shadow-[0_10px_25px_-5px_rgba(16,185,129,0.35)] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer min-h-[56px] sm:min-h-[58px] flex items-center justify-center gap-3"
                  >
                    {/* Subtle Light Sweep Animation */}
                    <div className="absolute inset-0 w-1/2 h-full bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer-sweep pointer-events-none" />

                    {isSubmitting ? (
                      <>
                        <CircleNotch size={24} className="animate-spin text-white" />
                        <span>Verifying Access…</span>
                      </>
                    ) : (
                      <>
                        <span>Unlock Workstation</span>
                        <ArrowRight size={22} weight="bold" className="group-hover:translate-x-1.5 transition-transform" />
                      </>
                    )}
                  </motion.button>
                </form>

                {/* Station Security Compliance Footer */}
                <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs sm:text-sm font-bold text-slate-500">
                  <span>Land Transportation Office · Philippines</span>
                  <span className="flex items-center gap-1.5 text-emerald-800 font-mono font-black">
                    <ShieldCheck size={18} weight="fill" className="text-emerald-600" />
                    TLS 256-BIT SECURED
                  </span>
                </div>
              </div>
            </div>
          </motion.div>

        </div>
      </main>

      {/* ── 3. Minimalist Bottom Compliance Footer ── */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 py-3 border-t border-slate-200/90 text-xs sm:text-sm text-slate-500 font-semibold text-center sm:text-left">
        <p>© 2026 PETC Workstation Terminal · Official Emission Inspection Software.</p>
        <p className="font-mono text-[11px] sm:text-xs">DENR AO 2000-81 · LTO MC 2019-014 COMPLIANT</p>
      </footer>

    </div>
  );
}

