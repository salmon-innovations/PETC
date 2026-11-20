import { useState, useRef, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion, AnimatePresence } from "framer-motion";
import { useAuthStore } from "../../store/authStore";
import { triggerAlert } from "../../store/alertStore";
import {
  UserCircle,
  EnvelopeSimple,
  LockKey,
  Eye,
  EyeSlash,
  IdentificationCard,
  Certificate,
  Camera,
  FloppyDisk,
  ArrowLeft,
  ShieldCheck,
  Warning,
  CircleNotch,
  SignOut,
  Pencil,
  CheckCircle,
  Key,
} from "@phosphor-icons/react";
import { useNavigate } from "react-router-dom";

// ── Schemas ───────────────────────────────────────────────────────────────────

const profileSchema = z.object({
  fullName: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  tesdaCertNo: z.string().optional(),
  certificationNo: z.string().optional(),
});

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z.string().min(8, "New password must be at least 8 characters"),
    confirmPassword: z.string().min(1, "Please confirm your new password"),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type ProfileValues = z.infer<typeof profileSchema>;
type PasswordValues = z.infer<typeof passwordSchema>;

// ── Avatar Colors ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  { bg: "#3b5bdb", label: "Indigo",  tailwind: "bg-[#3b5bdb]" },
  { bg: "#0ca678", label: "Teal",    tailwind: "bg-[#0ca678]" },
  { bg: "#7c3aed", label: "Violet",  tailwind: "bg-[#7c3aed]" },
  { bg: "#e67700", label: "Amber",   tailwind: "bg-[#e67700]" },
  { bg: "#c2255c", label: "Rose",    tailwind: "bg-[#c2255c]" },
  { bg: "#1971c2", label: "Sky",     tailwind: "bg-[#1971c2]" },
  { bg: "#2f9e44", label: "Green",   tailwind: "bg-[#2f9e44]" },
  { bg: "#862e9c", label: "Purple",  tailwind: "bg-[#862e9c]" },
];

// ── Tab config ────────────────────────────────────────────────────────────────

const TABS = [
  { id: "account", label: "Account Info",  Icon: UserCircle },
  { id: "security", label: "Security",     Icon: Key },
] as const;
type TabId = typeof TABS[number]["id"];

// ── Field component ───────────────────────────────────────────────────────────

function Field({
  label,
  id,
  icon: Icon,
  error,
  children,
}: {
  label: string;
  id: string;
  icon: React.ElementType;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-black uppercase tracking-widest text-slate-500">
        {label}
      </label>
      <div className="relative group">
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 pointer-events-none transition-colors">
          <Icon size={18} weight="bold" />
        </div>
        {children}
      </div>
      <AnimatePresence>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-xs font-bold text-red-500 flex items-center gap-1.5"
          >
            <Warning size={13} weight="fill" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all min-h-[48px] shadow-xs";

const inputClsGreen =
  "w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 py-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 placeholder:font-normal focus:outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 transition-all min-h-[48px] shadow-xs";

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { user, logout, updateProfile, changePassword, updateAvatar } = useAuthStore();
  const navigate = useNavigate();

  const displayName  = user?.fullName  || "Mock PETC Operator";
  const displayEmail = user?.email     || "operator@petc.local";
  const displayRole  = user?.role      || "operator";

  const initialColor = AVATAR_COLORS.find((c) => c.bg === user?.avatarColor) || AVATAR_COLORS[0];
  const [avatarColor, setAvatarColor]   = useState(initialColor);
  const [avatarImg,   setAvatarImg]     = useState<string | null>(user?.avatarUrl || null);
  const [activeTab,   setActiveTab]     = useState<TabId>("account");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showCurrent, setShowCurrent]   = useState(false);
  const [showNew,     setShowNew]       = useState(false);
  const [showConfirm, setShowConfirm]   = useState(false);

  // ── Forms ──────────────────────────────────────────────────────────────────
  const {
    register: regProfile,
    handleSubmit: handleProfile,
    reset: resetProfile,
    formState: { errors: pErr, isSubmitting: pSub },
  } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      fullName:        displayName,
      email:           displayEmail,
      tesdaCertNo:     user?.tesdaCertNo     ?? "",
      certificationNo: user?.certificationNo ?? "",
    },
  });

  useEffect(() => {
    if (user) {
      resetProfile({
        fullName:        user.fullName        || "",
        email:           user.email           || "",
        tesdaCertNo:     user.tesdaCertNo     || "",
        certificationNo: user.certificationNo || "",
      });
      if (user.avatarColor) {
        const match = AVATAR_COLORS.find((c) => c.bg === user.avatarColor);
        if (match) setAvatarColor(match);
      }
      if (user.avatarUrl !== undefined) {
        setAvatarImg(user.avatarUrl);
      }
    }
  }, [user, resetProfile]);

  const {
    register: regPw,
    handleSubmit: handlePassword,
    reset: resetPw,
    formState: { errors: pwErr, isSubmitting: pwSub },
  } = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });

  // ── Handlers ───────────────────────────────────────────────────────────────
  const onSaveProfile = async (values: ProfileValues) => {
    try {
      const updated = await updateProfile({
        fullName: values.fullName,
        email: values.email,
        tesdaCertNo: values.tesdaCertNo,
        certificationNo: values.certificationNo,
      });
      triggerAlert.success("Profile Updated", `Information updated for ${updated.fullName}.`);
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Failed to update profile information.";
      triggerAlert.error("Update Error", msg);
    }
  };

  const onChangePassword = async (values: PasswordValues) => {
    try {
      await changePassword(values.currentPassword, values.newPassword);
      triggerAlert.success("Password Changed", "Your workstation password has been updated.");
      resetPw();
    } catch (err: unknown) {
      const msg = (err as Error)?.message || "Failed to change password. Please check your current password.";
      triggerAlert.error("Password Error", msg);
    }
  };

  const handleAvatarUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      triggerAlert.error("File Too Large", "Please choose an image under 5 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      setAvatarImg(dataUrl);
      if (typeof updateAvatar === "function") {
        updateAvatar({ avatarUrl: dataUrl });
      }
      triggerAlert.success("Photo Updated", "Profile picture preview has been saved.");
    };
    reader.readAsDataURL(file);
  };

  const handleColorSelect = (c: typeof AVATAR_COLORS[number]) => {
    setAvatarColor(c);
    setAvatarImg(null);
    if (typeof updateAvatar === "function") {
      updateAvatar({ avatarColor: c.bg, avatarUrl: null });
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
    triggerAlert.edit("Avatar Theme", `Avatar color updated to ${c.label}.`);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-full bg-[#f4f6f9] pt-8 sm:pt-10 pb-16 px-6 sm:px-8">
      <div className="max-w-5xl mx-auto space-y-7">

        {/* ── Top Header / Back Navigation with ample space ── */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-white border border-slate-200 text-slate-700 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50/50 text-sm font-bold shadow-2xs transition-all cursor-pointer group"
          >
            <ArrowLeft size={16} weight="bold" className="group-hover:-translate-x-0.5 transition-transform" />
            <span>Back to Workstation</span>
          </button>
          <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold shadow-2xs">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Active Certified Session
          </div>
        </div>

        {/* ── Profile Identity Card with generous top padding ── */}
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-7 sm:p-9">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-6">
              {/* Avatar — plenty of breathing room, no clipping */}
              <div className="relative flex-shrink-0 group">
                <motion.div
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl ring-4 ring-slate-100 shadow-xl overflow-hidden flex items-center justify-center text-white font-black text-4xl sm:text-5xl cursor-pointer"
                  style={{ backgroundColor: avatarColor.bg }}
                  whileHover={{ scale: 1.02 }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {avatarImg ? (
                    <img src={avatarImg} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <span>{displayName.charAt(0).toUpperCase()}</span>
                  )}
                </motion.div>
                {/* Camera overlay */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute inset-0 rounded-3xl bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 cursor-pointer"
                >
                  <Camera size={22} className="text-white" weight="bold" />
                  <span className="text-white text-[10px] font-bold">Change</span>
                </div>
                {/* Online dot */}
                <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 border-[3px] border-white shadow-sm" />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarUpload}
                />
              </div>

              {/* Info block */}
              <div className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight leading-none">
                    {displayName}
                  </h1>
                  <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-black uppercase tracking-wider px-2.5 py-1 rounded-lg">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {displayRole}
                  </span>
                </div>
                <p className="text-sm font-medium text-slate-500">{displayEmail}</p>

                {/* Avatar Color Picker */}
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span className="text-[11px] font-black uppercase tracking-widest text-slate-400 mr-1">Color:</span>
                  {AVATAR_COLORS.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={() => handleColorSelect(c)}
                      title={c.label}
                      className="relative w-6 h-6 rounded-lg transition-all cursor-pointer hover:scale-110"
                      style={{ backgroundColor: c.bg }}
                    >
                      {avatarColor.bg === c.bg && !avatarImg && (
                        <span className="absolute inset-0 flex items-center justify-center">
                          <CheckCircle size={14} className="text-white" weight="fill" />
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Edit photo button */}
            <div>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 px-4 py-2.5 rounded-2xl transition-all cursor-pointer shadow-2xs"
              >
                <Pencil size={16} weight="bold" />
                <span>Change Photo</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── Tab Bar ── */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs px-4 flex gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`relative flex items-center gap-2 px-4 py-3.5 text-sm font-bold transition-all cursor-pointer ${
                activeTab === id
                  ? "text-blue-600"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              <Icon size={16} weight={activeTab === id ? "fill" : "bold"} />
              {label}
              {activeTab === id && (
                <motion.span
                  layoutId="tab-underline"
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-blue-600 rounded-full"
                />
              )}
            </button>
          ))}
        </div>

        {/* ── Tab Content ── */}
        <div>
          <AnimatePresence mode="wait">

            {/* ── ACCOUNT INFO TAB ─────────────────────────────────── */}
            {activeTab === "account" && (
              <motion.div
                key="account"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <form onSubmit={handleProfile(onSaveProfile)}>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                    {/* Left: Personal info */}
                    <div className="lg:col-span-2 space-y-6">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
                            <UserCircle size={18} weight="fill" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900">Personal Information</h3>
                            <p className="text-xs text-slate-500 font-medium">Your name and contact details</p>
                          </div>
                        </div>

                        <div className="p-6 space-y-5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <Field label="Full Name" id="fullName" icon={IdentificationCard} error={pErr.fullName?.message}>
                              <input
                                {...regProfile("fullName")}
                                id="fullName"
                                type="text"
                                placeholder="Your full name"
                                className={inputCls}
                              />
                            </Field>
                            <Field label="Email Address" id="profile-email" icon={EnvelopeSimple} error={pErr.email?.message}>
                              <input
                                {...regProfile("email")}
                                id="profile-email"
                                type="email"
                                placeholder="your@email.com"
                                className={inputCls}
                              />
                            </Field>
                          </div>
                        </div>
                      </div>

                      {/* Certifications */}
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
                            <Certificate size={18} weight="fill" />
                          </div>
                          <div>
                            <h3 className="text-sm font-black text-slate-900">Professional Certifications</h3>
                            <p className="text-xs text-slate-500 font-medium">Regulatory accreditation numbers</p>
                          </div>
                        </div>
                        <div className="p-6 space-y-5">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                            <Field label="TESDA Certificate No." id="tesdaCertNo" icon={Certificate}>
                              <input
                                {...regProfile("tesdaCertNo")}
                                id="tesdaCertNo"
                                type="text"
                                placeholder="TESDA-2024-00001"
                                className={inputCls}
                              />
                            </Field>
                            <Field label="Certification No." id="certificationNo" icon={ShieldCheck}>
                              <input
                                {...regProfile("certificationNo")}
                                id="certificationNo"
                                type="text"
                                placeholder="CERT-2024-00001"
                                className={inputCls}
                              />
                            </Field>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: Summary card */}
                    <div className="space-y-4">
                      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                        <div className="p-6 text-center space-y-4">
                          <div
                            className="w-20 h-20 rounded-2xl mx-auto flex items-center justify-center text-white font-black text-3xl shadow-lg"
                            style={{ backgroundColor: avatarColor.bg }}
                          >
                            {avatarImg
                              ? <img src={avatarImg} alt="" className="w-full h-full object-cover rounded-2xl" />
                              : displayName.charAt(0).toUpperCase()
                            }
                          </div>
                          <div>
                            <p className="font-black text-slate-900 text-base leading-tight">{displayName}</p>
                            <p className="text-xs text-slate-500 font-medium mt-0.5">{displayEmail}</p>
                          </div>
                          <div className="pt-2 border-t border-slate-100 space-y-2 text-left">
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-500 font-medium">Role</span>
                              <span className="font-black text-slate-800 uppercase tracking-wide">{displayRole}</span>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-slate-500 font-medium">Status</span>
                              <span className="flex items-center gap-1.5 text-emerald-700 font-bold">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                                Online
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Save button */}
                      <motion.button
                        type="submit"
                        disabled={pSub}
                        whileHover={{ scale: 1.015 }}
                        whileTap={{ scale: 0.985 }}
                        className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black text-sm py-3.5 shadow-[0_6px_20px_-4px_rgba(37,99,235,0.4)] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer min-h-[52px]"
                      >
                        {pSub
                          ? <><CircleNotch size={18} className="animate-spin" /> Saving…</>
                          : <><FloppyDisk size={18} weight="bold" /> Save Changes</>
                        }
                      </motion.button>
                    </div>
                  </div>
                </form>
              </motion.div>
            )}

            {/* ── SECURITY TAB ─────────────────────────────────────── */}
            {activeTab === "security" && (
              <motion.div
                key="security"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.2 }}
              >
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* Password form */}
                  <div className="lg:col-span-2">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
                      <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-3">
                        <div className="w-8 h-8 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
                          <LockKey size={18} weight="fill" />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900">Change Password</h3>
                          <p className="text-xs text-slate-500 font-medium">Minimum 8 characters required</p>
                        </div>
                      </div>
                      <div className="p-6">
                        <form onSubmit={handlePassword(onChangePassword)} className="space-y-5">
                          {/* Current Password */}
                          <div className="space-y-1.5">
                            <label htmlFor="currentPassword" className="block text-xs font-black uppercase tracking-widest text-slate-500">
                              Current Password
                            </label>
                            <div className="relative group">
                              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 pointer-events-none transition-colors">
                                <LockKey size={18} weight="bold" />
                              </div>
                              <input
                                {...regPw("currentPassword")}
                                id="currentPassword"
                                type={showCurrent ? "text" : "password"}
                                placeholder="Enter your current password"
                                className={inputClsGreen}
                              />
                              <button
                                type="button"
                                onClick={() => setShowCurrent((s) => !s)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              >
                                {showCurrent ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}
                              </button>
                            </div>
                            <AnimatePresence>
                              {pwErr.currentPassword && (
                                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs font-bold text-red-500 flex items-center gap-1.5">
                                  <Warning size={13} weight="fill" /> {pwErr.currentPassword.message}
                                </motion.p>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Divider */}
                          <div className="border-t border-slate-100 pt-1" />

                          {/* New Password */}
                          <div className="space-y-1.5">
                            <label htmlFor="newPassword" className="block text-xs font-black uppercase tracking-widest text-slate-500">
                              New Password
                            </label>
                            <div className="relative group">
                              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 pointer-events-none transition-colors">
                                <ShieldCheck size={18} weight="bold" />
                              </div>
                              <input
                                {...regPw("newPassword")}
                                id="newPassword"
                                type={showNew ? "text" : "password"}
                                placeholder="Minimum 8 characters"
                                className={inputClsGreen}
                              />
                              <button
                                type="button"
                                onClick={() => setShowNew((s) => !s)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              >
                                {showNew ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}
                              </button>
                            </div>
                            <AnimatePresence>
                              {pwErr.newPassword && (
                                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs font-bold text-red-500 flex items-center gap-1.5">
                                  <Warning size={13} weight="fill" /> {pwErr.newPassword.message}
                                </motion.p>
                              )}
                            </AnimatePresence>
                          </div>

                          {/* Confirm Password */}
                          <div className="space-y-1.5">
                            <label htmlFor="confirmPassword" className="block text-xs font-black uppercase tracking-widest text-slate-500">
                              Confirm New Password
                            </label>
                            <div className="relative group">
                              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-emerald-600 pointer-events-none transition-colors">
                                <ShieldCheck size={18} weight="bold" />
                              </div>
                              <input
                                {...regPw("confirmPassword")}
                                id="confirmPassword"
                                type={showConfirm ? "text" : "password"}
                                placeholder="Re-enter new password"
                                className={inputClsGreen}
                              />
                              <button
                                type="button"
                                onClick={() => setShowConfirm((s) => !s)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
                              >
                                {showConfirm ? <EyeSlash size={18} weight="bold" /> : <Eye size={18} weight="bold" />}
                              </button>
                            </div>
                            <AnimatePresence>
                              {pwErr.confirmPassword && (
                                <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs font-bold text-red-500 flex items-center gap-1.5">
                                  <Warning size={13} weight="fill" /> {pwErr.confirmPassword.message}
                                </motion.p>
                              )}
                            </AnimatePresence>
                          </div>

                          <motion.button
                            type="submit"
                            disabled={pwSub}
                            whileHover={{ scale: 1.015 }}
                            whileTap={{ scale: 0.985 }}
                            className="w-full flex items-center justify-center gap-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-sm py-3.5 shadow-[0_6px_20px_-4px_rgba(5,150,105,0.4)] disabled:opacity-60 disabled:cursor-not-allowed transition-all cursor-pointer min-h-[52px]"
                          >
                            {pwSub
                              ? <><CircleNotch size={18} className="animate-spin" /> Updating…</>
                              : <><ShieldCheck size={18} weight="fill" /> Update Password</>
                            }
                          </motion.button>
                        </form>
                      </div>
                    </div>
                  </div>

                  {/* Right: Tips + Danger Zone */}
                  <div className="space-y-4">
                    {/* Tips card */}
                    <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center gap-2 text-blue-700">
                        <ShieldCheck size={18} weight="fill" />
                        <span className="text-sm font-black">Password Tips</span>
                      </div>
                      <ul className="space-y-1.5 text-xs font-medium text-blue-700/80">
                        {[
                          "Use at least 8 characters",
                          "Mix uppercase and lowercase letters",
                          "Include numbers and symbols",
                          "Avoid easy-to-guess words",
                          "Don't reuse old passwords",
                        ].map((tip) => (
                          <li key={tip} className="flex items-start gap-1.5">
                            <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                            {tip}
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Danger Zone */}
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
                      <div className="px-5 py-3.5 border-b border-slate-100">
                        <p className="text-xs font-black uppercase tracking-widest text-red-500">Danger Zone</p>
                      </div>
                      <div className="p-5">
                        <p className="text-xs text-slate-500 font-medium mb-3 leading-relaxed">
                          This will immediately sign you out from all active sessions on this workstation.
                        </p>
                        <motion.button
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            triggerAlert.delete("Session Ended", "You have been signed out of the workstation.");
                            logout();
                          }}
                          className="w-full flex items-center justify-center gap-2.5 rounded-xl border-2 border-red-200 bg-red-50 hover:bg-red-100 text-red-700 font-black text-sm py-3 transition-all cursor-pointer min-h-[48px]"
                        >
                          <SignOut size={16} weight="bold" />
                          Sign Out Now
                        </motion.button>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

