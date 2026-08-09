import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { isLtmsNonterminalState, isLtmsSuccessState, sidecarClient } from "../../api/sidecarClient";
import { TestListFilters } from "../../components/TestListFilters";
import { INSPECTION_PURPOSE_LABELS, type EmissionTest } from "../../types";
import { EMPTY_TEST_FILTERS, filterEmissionTests, type TestListFilterState } from "../../utils/testFilters";

export default function HistoryPage() {
  const [filters, setFilters] = useState<TestListFilterState>({ ...EMPTY_TEST_FILTERS });
  const [viewingCec, setViewingCec] = useState<{
    submissionId: string;
    certificateNo: string | null;
    plateNumber: string;
  } | null>(null);

  const { data: tests = [], isLoading } = useQuery<EmissionTest[]>({
    queryKey: ["tests", "all"],
    queryFn: async () => {
      const base = await window.petcBridge.getSidecarUrl();
      const { data } = await axios.get(`${base}/tests?limit=100`);
      return data;
    },
    // Poll faster while any row is still waiting for LTMS
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      return rows.some((t) => isLtmsNonterminalState(t.ltmsState))
        ? 10_000
        : 30_000;
    },
  });

  const filteredTests = useMemo(
    () => filterEmissionTests(tests, filters),
    [tests, filters],
  );
  const ltmsStates = useMemo(
    () => Array.from(new Set(tests.map((test) => test.ltmsState ?? "PENDING"))).sort(),
    [tests],
  );

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-800">Test History</h1>
        <p className="text-sm text-gray-500">Search and filter completed emission tests and LTMS submissions.</p>
      </div>

      <TestListFilters
        filters={filters}
        onChange={setFilters}
        ltmsStates={ltmsStates}
        resultIncludesNotRecorded
      />

      {isLoading && <p className="text-sm text-gray-500">Loading…</p>}

      {!isLoading && tests.length > 0 && (
        <p className="text-xs text-gray-500">
          Showing {filteredTests.length} of {tests.length} tests
        </p>
      )}

      <div className="bg-white rounded-xl shadow divide-y">
        {filteredTests.map((t) => (
          <HistoryRow
            key={t.id}
            test={t}
            onViewCec={() => {
              if (!t.submissionId) return;
              setViewingCec({
                submissionId: t.submissionId,
                certificateNo: t.certificateNo,
                plateNumber: t.plateNumber,
              });
            }}
          />
        ))}
        {!isLoading && tests.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">No tests recorded yet.</p>
        )}
        {!isLoading && tests.length > 0 && filteredTests.length === 0 && (
          <p className="px-5 py-10 text-center text-sm text-gray-500">
            No tests match the selected filters.
          </p>
        )}
      </div>

      {viewingCec && (
        <CecViewerModal
          {...viewingCec}
          onClose={() => setViewingCec(null)}
        />
      )}
    </div>
  );
}

function HistoryRow({
  test: t,
  onViewCec,
}: {
  test: EmissionTest;
  onViewCec: () => void;
}) {
  const printMutation = useMutation({
    mutationFn: () => sidecarClient.printCec(t.submissionId!, 2),
  });

  return (
    <div className="flex items-center justify-between px-5 py-3">
      <div>
        <p className="font-semibold text-sm text-gray-800">{t.plateNumber}</p>
        <p className="text-xs text-gray-500">
          {t.fuelType} · {INSPECTION_PURPOSE_LABELS[t.inspectionPurpose]} · {t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"}
        </p>
        {t.certificateNo && (
          <p className="text-xs text-blue-600 mt-0.5">Cert: {t.certificateNo}</p>
        )}
      </div>
      <div className="flex items-center gap-2">
        {t.passFail !== null && (
          <span className={clsx(
            "rounded-full px-2 py-0.5 text-xs font-medium",
            t.passFail ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
          )}>
            {t.passFail ? "PASS" : "FAIL"}
          </span>
        )}
        <LtmsStateBadge state={t.ltmsState} />
        {isLtmsSuccessState(t.ltmsState) && t.submissionId && (
          <>
            <button
              onClick={onViewCec}
              className="rounded-md border border-blue-600 px-3 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              View CEC
            </button>
            <button
              onClick={() => printMutation.mutate()}
              disabled={printMutation.isPending}
              className="rounded-md bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {printMutation.isPending ? "Printing…" : printMutation.isSuccess ? "Printed ✓" : "Print CEC"}
            </button>
          </>
        )}
        {isLtmsNonterminalState(t.ltmsState) && (
          <span className="text-xs text-blue-600 animate-pulse">Awaiting LTMS…</span>
        )}
      </div>
    </div>
  );
}

function CecViewerModal({
  submissionId,
  certificateNo,
  plateNumber,
  onClose,
}: {
  submissionId: string;
  certificateNo: string | null;
  plateNumber: string;
  onClose: () => void;
}) {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    sidecarClient.cecPdfUrl(submissionId).then((url) => {
      if (active) setPdfUrl(url);
    });
    return () => {
      active = false;
    };
  }, [submissionId]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6"
      onClick={onClose}
    >
      <div
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="font-semibold text-gray-800">Certificate of Emission Compliance</h2>
            <p className="text-xs text-gray-500">
              {plateNumber}{certificateNo ? ` · ${certificateNo}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Close
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-gray-100">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={`CEC for ${plateNumber}`}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-500">
              Loading CEC…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function LtmsStateBadge({ state }: { state: string | null }) {
  const label = state ?? "pending LTMS";
  const cls = clsx(
    "rounded-full px-2 py-0.5 text-xs",
    isLtmsSuccessState(state)
      ? "bg-blue-100 text-blue-700"
      : state === "FAILED_EVALUATION" || state === "ACTION_REQUIRED"
        || state === "AUTH_BLOCKED" || state === "REJECTED" || state === "DEAD"
      ? "bg-red-100 text-red-600"
      : state === "RECONCILING"
      ? "bg-purple-100 text-purple-700"
      : state === "DEFERRED" || state === "BLOCKED"
      ? "bg-amber-100 text-amber-700"
      : isLtmsNonterminalState(state)
      ? "bg-blue-50 text-blue-500"
      : "bg-yellow-100 text-yellow-700",
  );
  return <span className={cls}>{label}</span>;
}
