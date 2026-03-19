"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Timer, CheckCircle, XCircle, X } from "lucide-react";
import { fmtMs } from "@/lib/utils/format";

const LS_KEY = "gw_pipeline";

export default function PipelinePill() {
  const router = useRouter();
  const [state, setState] = useState(null); // { tenantId, tenantName, startedAt, estimatedMs, startISO, status, title? }
  const [elapsed, setElapsed] = useState(0);
  const pollRef = useRef(null);
  const timerRef = useRef(null);

  // Aus localStorage laden + auf storage-Events hören
  useEffect(() => {
    function readState() {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) { setState(null); return; }
        const parsed = JSON.parse(raw);
        setState(parsed);
        if (parsed.status === "running") {
          setElapsed(Date.now() - parsed.startedAt);
        }
      } catch { setState(null); }
    }
    readState();
    window.addEventListener("storage", readState);
    // Auch lokale Updates abhören
    window.addEventListener("gw_pipeline_update", readState);
    return () => {
      window.removeEventListener("storage", readState);
      window.removeEventListener("gw_pipeline_update", readState);
    };
  }, []);

  // Timer: tickt jede Sekunde wenn running
  useEffect(() => {
    if (state?.status !== "running") { clearInterval(timerRef.current); return; }
    timerRef.current = setInterval(() => {
      setElapsed(Date.now() - state.startedAt);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, [state?.status, state?.startedAt]);

  // Polling: sucht nach neuem Post wenn running
  useEffect(() => {
    if (state?.status !== "running") { clearInterval(pollRef.current); return; }

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/admin/posts?tenantId=${state.tenantId}&after=${encodeURIComponent(state.startISO)}`
        );
        const data = await res.json();
        const post = data.posts?.[0];
        if (!post) return;

        const next = {
          ...state,
          status: post.status === "failed" ? "error" : "done",
          title: post.blog_title,
        };
        localStorage.setItem(LS_KEY, JSON.stringify(next));
        setState(next);
        window.dispatchEvent(new Event("gw_pipeline_update"));
      } catch { /* weiter warten */ }
    }, 4000);

    return () => clearInterval(pollRef.current);
  }, [state?.status, state?.tenantId, state?.startISO]);

  // Auto-dismiss nach 8s bei done/error
  useEffect(() => {
    if (state?.status !== "done" && state?.status !== "error") return;
    const t = setTimeout(() => {
      localStorage.removeItem(LS_KEY);
      setState(null);
    }, 8000);
    return () => clearTimeout(t);
  }, [state?.status]);

  if (!state) return null;

  const estimated = state.estimatedMs || 90000;
  const progress = Math.min(elapsed / estimated, 1);
  const isDone = state.status === "done";
  const isError = state.status === "error";
  const isRunning = state.status === "running";

  function dismiss() {
    localStorage.removeItem(LS_KEY);
    setState(null);
  }

  return (
    <div
      className="fixed bottom-6 right-6 z-[9990] w-72 rounded-xl shadow-2xl overflow-hidden cursor-pointer select-none"
      style={{
        background: isDone ? "#065f46" : isError ? "#7f1d1d" : "#1e1b4b",
        animation: "slideUpPill 0.4s cubic-bezier(0.34,1.56,0.64,1) both",
      }}
      onClick={() => {
        if (state.tenantId) router.push(`/admin/tenants/${state.tenantId}?tab=posts`);
      }}
    >
      {/* Progress bar */}
      <div className={`h-[3px] w-full ${isDone ? "bg-emerald-400" : isError ? "bg-red-400" : "bg-white/10"}`}>
        {isRunning && (
          <div className="h-full bg-violet-400 transition-all duration-1000" style={{ width: `${progress * 100}%` }} />
        )}
      </div>

      <div className="px-4 py-3 flex items-start gap-3">
        <div className="mt-0.5 flex-shrink-0">
          {isDone && <CheckCircle size={16} className="text-emerald-400" />}
          {isError && <XCircle size={16} className="text-red-400" />}
          {isRunning && <Timer size={16} className="text-violet-400 animate-pulse" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white/90 truncate">
            {state.tenantName || "Ghostwriter"}
          </p>
          <p className="text-[11px] text-white/60 mt-0.5 truncate">
            {isDone && state.title ? `✓ ${state.title}` : null}
            {isError ? "Pipeline fehlgeschlagen" : null}
            {isRunning ? (
              <>
                {fmtMs(elapsed)}
                {estimated ? ` / ca. ${fmtMs(estimated)}` : ""}
              </>
            ) : null}
          </p>
        </div>
        <button
          className="text-white/30 hover:text-white/80 transition-colors flex-shrink-0 mt-0.5"
          onClick={(e) => { e.stopPropagation(); dismiss(); }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
