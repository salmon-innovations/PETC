import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../../store/authStore";
const schema = z.object({
    email: z.string().email("Invalid email"),
    password: z.string().min(1, "Password is required"),
});
export default function LoginPage() {
    const login = useAuthStore((s) => s.login);
    const navigate = useNavigate();
    const { register, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({ resolver: zodResolver(schema) });
    const onSubmit = async ({ email, password }) => {
        try {
            await login(email, password);
            navigate("/analytics");
        }
        catch {
            setError("root", { message: "Invalid email or password" });
        }
    };
    return (_jsx("div", { className: "min-h-screen flex items-center justify-center bg-gray-50", children: _jsxs("div", { className: "w-full max-w-sm bg-white rounded-xl shadow p-8 space-y-6", children: [_jsxs("div", { className: "text-center space-y-1", children: [_jsx("h1", { className: "text-xl font-bold text-gray-800", children: "PETC Operator Portal" }), _jsx("p", { className: "text-xs text-gray-500", children: "Sign in to manage centers and analytics" })] }), _jsxs("form", { onSubmit: handleSubmit(onSubmit), className: "space-y-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Email" }), _jsx("input", { ...register("email"), type: "email", autoComplete: "email", placeholder: "admin@petc.ph", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" }), errors.email && _jsx("p", { className: "mt-1 text-xs text-red-600", children: errors.email.message })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-xs font-medium text-gray-600 mb-1", children: "Password" }), _jsx("input", { ...register("password"), type: "password", autoComplete: "current-password", className: "w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" }), errors.password && _jsx("p", { className: "mt-1 text-xs text-red-600", children: errors.password.message })] }), errors.root && (_jsx("p", { className: "text-sm text-red-600 text-center", children: errors.root.message })), _jsx("button", { type: "submit", disabled: isSubmitting, className: "w-full rounded-lg bg-blue-600 py-2 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors", children: isSubmitting ? "Signing in…" : "Sign In" })] })] }) }));
}
