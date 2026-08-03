import { clearTokens } from "../api/webClient";
import { useBackendAvailabilityStore } from "../store/backendAvailabilityStore";

export default function BackendUnavailableDialog() {
  const failure = useBackendAvailabilityStore((state) => state.failure);
  const clearFailure = useBackendAvailabilityStore((state) => state.clearFailure);

  if (!failure) return null;

  const forbidden = failure.kind === "forbidden";

  const retry = () => {
    clearFailure();
    window.location.reload();
  };

  const signInAgain = () => {
    clearTokens();
    clearFailure();
    window.location.href = "/login";
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="backend-unavailable-title"
    >
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-100 text-xl text-red-700">
            !
          </div>
          <div>
            <h2 id="backend-unavailable-title" className="font-semibold text-gray-900">
              Cloud backend unavailable
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              {forbidden
                ? "The backend refused this request (HTTP 403). Your session may not have super-admin access. No center or submission data will be shown."
                : "The cloud backend could not be reached or returned a server error. No center or submission data will be shown."}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Verify that the Spring Boot service is running, then retry. If access was refused,
              sign in again with a super-admin account.
            </p>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          {forbidden && (
            <button
              type="button"
              onClick={signInAgain}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Sign in again
            </button>
          )}
          <button
            type="button"
            onClick={retry}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Retry now
          </button>
        </div>
      </div>
    </div>
  );
}
