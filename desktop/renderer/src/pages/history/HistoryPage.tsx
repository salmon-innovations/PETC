import { useMutation, useQuery } from "@tanstack/react-query";
import axios from "axios";
import clsx from "clsx";
import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  FileText,
  CheckCircle,
  XCircle,
  Printer,
  Eye,
  Clock,
  Car,
  X,
  CloudArrowUp,
} from "@phosphor-icons/react";
import { isLtmsNonterminalState, isLtmsSuccessState, sidecarClient } from "../../api/sidecarClient";
import { TestListFilters } from "../../components/TestListFilters";
import { INSPECTION_PURPOSE_LABELS, type EmissionTest } from "../../types";
import { EMPTY_TEST_FILTERS, filterEmissionTests, type TestListFilterState } from "../../utils/testFilters";
import { triggerAlert } from "../../store/alertStore";

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
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="max-w-6xl mx-auto p-6 md:p-8 space-y-6 text-slate-800"
    >
      {/* Page Header */}
      <div className="flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 shadow-sm flex-shrink-0">
          <FileText size={26} weight="fill" />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">Test History</h1>
          <p className="text-sm text-slate-500 font-medium">Search and review completed emission tests and official LTMS submissions.</p>
        </div>
      </div>

      {/* ── Operational Metric Tiles ── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 flex-shrink-0">
            <FileText size={24} weight="fill" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Recorded</p>
            <p className="text-2xl font-black text-slate-900 num-display mt-0.5">{tests.length}</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600 flex-shrink-0">
            <CheckCircle size={24} weight="fill" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Passed Tests</p>
            <p className="text-2xl font-black text-emerald-600 num-display mt-0.5">
              {tests.filter((t) => t.passFail === true).length}
            </p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-xs flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 flex-shrink-0">
            <CloudArrowUp size={24} weight="fill" />
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Awaiting LTMS</p>
            <p className="text-2xl font-black text-amber-600 num-display mt-0.5">
              {tests.filter((t) => isLtmsNonterminalState(t.ltmsState)).length}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm">
        <TestListFilters
          filters={filters}
          onChange={setFilters}
          ltmsStates={ltmsStates}
          resultIncludesNotRecorded
        />
      </div>

      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-white rounded-2xl p-5 border border-slate-200/90 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 animate-pulse"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-slate-100 flex-shrink-0" />
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-6 w-32 bg-slate-200 rounded-lg" />
                    <div className="h-5 w-16 bg-slate-100 rounded-md" />
                  </div>
                  <div className="h-4 w-48 bg-slate-100 rounded-md" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-7 w-20 bg-slate-100 rounded-full" />
                <div className="h-7 w-24 bg-slate-100 rounded-full" />
                <div className="h-10 w-24 bg-slate-200 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && tests.length > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-sm font-semibold text-slate-600">
            Showing <span className="text-blue-600 font-bold">{filteredTests.length}</span> of {tests.length} recorded tests
          </p>
        </div>
      )}

      {!isLoading && (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200/90 divide-y divide-slate-100 overflow-hidden">
          {filteredTests.map((t, idx) => (
            <HistoryRow
              key={t.id}
              test={t}
              index={idx}
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

          {tests.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
                <FileText size={32} />
              </div>
              <p className="text-base font-bold text-slate-700">No tests recorded yet</p>
              <p className="text-sm text-slate-400 max-w-sm mt-1">Tests conducted on the Run Test page will appear here automatically.</p>
            </div>
          )}

          {tests.length > 0 && filteredTests.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-400 mb-3 shadow-inner">
                <Car size={32} />
              </div>
              <p className="text-base font-bold text-slate-700">No matching test records</p>
              <p className="text-sm text-slate-400 max-w-sm mt-1">Try changing or clearing your search filters to see other results.</p>
            </div>
          )}
        </div>
      )}

      {viewingCec && (
        <CecViewerModal
          {...viewingCec}
          onClose={() => setViewingCec(null)}
        />
      )}
    </motion.div>
  );
}

function HistoryRow({
  test: t,
  index,
  onViewCec,
}: {
  test: EmissionTest;
  index: number;
  onViewCec: () => void;
}) {
  const printMutation = useMutation({
    mutationFn: () => sidecarClient.printCec(t.submissionId!, 2),
    onSuccess: () => {
      triggerAlert.success("Printing CEC", `Certificate for ${t.plateNumber} sent to thermal printer`);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Printer communication error";
      triggerAlert.error("Printer Error", msg);
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3), duration: 0.2 }}
      className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 px-6 py-4 hover:bg-slate-50/80 transition-colors"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-lg text-slate-900 tracking-wide font-mono bg-slate-100 px-3 py-0.5 rounded-lg border border-slate-200">
            {t.plateNumber}
          </span>
          {t.certificateNo && (
            <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-md border border-blue-200">
              Cert #{t.certificateNo}
            </span>
          )}
        </div>
        <p className="text-sm text-slate-600 font-medium">
          <span className="font-bold text-slate-700">{t.fuelType}</span> · {INSPECTION_PURPOSE_LABELS[t.inspectionPurpose]} · {t.startedAt ? new Date(t.startedAt).toLocaleString() : "—"}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {t.passFail !== null && (
          <span
            className={clsx(
              "rounded-full px-3 py-1 text-xs font-extrabold flex items-center gap-1.5 border shadow-xs",
              t.passFail
                ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                : "bg-red-50 text-red-700 border-red-300"
            )}
          >
            {t.passFail ? (
              <>
                <CheckCircle size={15} weight="fill" />
                PASS
              </>
            ) : (
              <>
                <XCircle size={15} weight="fill" />
                FAIL
              </>
            )}
          </span>
        )}

        <LtmsStateBadge state={t.ltmsState} />

        {isLtmsSuccessState(t.ltmsState) && t.submissionId && (
          <div className="flex items-center gap-2">
            <button
              onClick={onViewCec}
              className="inline-flex items-center gap-1.5 rounded-xl border-2 border-blue-600 px-3.5 py-2 text-xs font-bold text-blue-600 hover:bg-blue-50 transition-colors cursor-pointer min-h-[38px]"
            >
              <Eye size={16} weight="bold" />
              <span>View CEC</span>
            </button>
            <button
              onClick={() => printMutation.mutate()}
              disabled={printMutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm cursor-pointer min-h-[38px]"
            >
              <Printer size={16} weight="bold" />
              <span>{printMutation.isPending ? "Printing…" : printMutation.isSuccess ? "Printed ✓" : "Print CEC"}</span>
            </button>
          </div>
        )}

        {isLtmsNonterminalState(t.ltmsState) && (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-full border border-blue-200 animate-pulse">
            <Clock size={15} weight="bold" />
            Awaiting LTMS…
          </span>
        )}
      </div>
    </motion.div>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4 sm:p-6"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl bg-white shadow-2xl border border-slate-200"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
          <div>
            <h2 className="text-lg font-extrabold text-slate-900">Certificate of Emission Compliance</h2>
            <p className="text-xs text-slate-500 font-medium">
              Plate: <strong className="text-slate-700">{plateNumber}</strong> {certificateNo ? `· Cert: ${certificateNo}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer min-h-[40px]"
          >
            <X size={16} weight="bold" />
            <span>Close</span>
          </button>
        </div>
        <div className="min-h-0 flex-1 bg-slate-100">
          {pdfUrl ? (
            <iframe
              src={pdfUrl}
              title={`CEC for ${plateNumber}`}
              className="h-full w-full border-0"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm font-semibold text-slate-500">
              Loading Certificate of Emission Compliance…
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function LtmsStateBadge({ state }: { state: string | null }) {
  const label = state ?? "pending LTMS";
  const cls = clsx(
    "rounded-full px-3 py-1 text-xs font-bold border uppercase tracking-wider",
    isLtmsSuccessState(state)
      ? "bg-blue-50 text-blue-700 border-blue-200"
      : state === "FAILED_EVALUATION" || state === "ACTION_REQUIRED"
        || state === "AUTH_BLOCKED" || state === "REJECTED" || state === "DEAD"
      ? "bg-red-50 text-red-700 border-red-200"
      : state === "RECONCILING"
      ? "bg-purple-50 text-purple-700 border-purple-200"
      : state === "DEFERRED" || state === "BLOCKED"
      ? "bg-amber-50 text-amber-700 border-amber-200"
      : isLtmsNonterminalState(state)
      ? "bg-blue-50 text-blue-600 border-blue-200"
      : "bg-yellow-50 text-yellow-800 border-yellow-200",
  );
  return <span className={cls}>{label}</span>;
}
