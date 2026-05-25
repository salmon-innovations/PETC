/**
 * HTTP client for the PETC web app backend.
 * Handles JWT injection and token refresh transparently.
 */
import axios from "axios";
const api = axios.create({ baseURL: "/api", timeout: 15_000 });
// ── token storage ──────────────────────────────────────────────────────────
const TOKEN_KEY = "petc_tokens";
function getTokens() {
    const raw = localStorage.getItem(TOKEN_KEY);
    return raw ? JSON.parse(raw) : null;
}
function setTokens(t) {
    localStorage.setItem(TOKEN_KEY, JSON.stringify(t));
}
function clearTokens() {
    localStorage.removeItem(TOKEN_KEY);
}
// ── request interceptor: inject access token ──────────────────────────────
api.interceptors.request.use((config) => {
    const tokens = getTokens();
    if (tokens?.accessToken) {
        config.headers.Authorization = `Bearer ${tokens.accessToken}`;
    }
    return config;
});
// ── response interceptor: auto-refresh on 401 ─────────────────────────────
let refreshing = null;
api.interceptors.response.use((res) => res, async (error) => {
    const original = error.config;
    if (error.response?.status !== 401 || original._retry) {
        return Promise.reject(error);
    }
    original._retry = true;
    try {
        if (!refreshing) {
            const tokens = getTokens();
            refreshing = axios
                .post("/api/auth/refresh", {
                refreshToken: tokens?.refreshToken,
            })
                .then((r) => r.data)
                .finally(() => {
                refreshing = null;
            });
        }
        const newTokens = await refreshing;
        setTokens(newTokens);
        original.headers.Authorization = `Bearer ${newTokens.accessToken}`;
        return api(original);
    }
    catch {
        clearTokens();
        window.location.href = "/login";
        return Promise.reject(error);
    }
});
export { api, getTokens, setTokens, clearTokens };
