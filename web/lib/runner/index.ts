// Main-thread orchestration for the in-browser test runners.
import { transform } from "sucrase";
import { instrument } from "./instrument";
import { JS_WORKER_SRC, PY_WORKER_SRC } from "./workers";

export type CaseSpec = { argsJson: string; expectedJson: string };

export type CaseResult = {
  status: "pass" | "pass-unordered" | "fail" | "error";
  got?: string;
  error?: string;
  ms: number;
  steps: number;
};

export type RunnerEvent =
  | { type: "env-loading" }
  | { type: "env-ready" }
  | { type: "case-start"; index: number }
  | { type: "progress"; index: number; steps: number }
  | { type: "case-done"; index: number; result: CaseResult }
  | { type: "fatal"; error: string }
  | { type: "all-done" };

export const RUNNABLE_LANGUAGES = new Set(["javascript", "typescript", "python"]);

const ENV_TIMEOUT_MS = 120_000; // pyodide download on cold cache
const CASE_TIMEOUT_MS = 20_000;

function makeWorker(src: string): Worker {
  const url = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
  const w = new Worker(url);
  URL.revokeObjectURL(url);
  return w;
}

// Pyodide is ~10MB of WASM; keep one warm worker for the whole session.
let pyWorker: Worker | null = null;
let pyRunId = 0;

export function startRun(opts: {
  language: string;
  code: string;
  fnName: string;
  cases: CaseSpec[];
  onEvent: (ev: RunnerEvent) => void;
}): () => void {
  const { language, fnName, cases, onEvent } = opts;

  if (!RUNNABLE_LANGUAGES.has(language)) {
    onEvent({ type: "fatal", error: `no in-browser runner for ${language} yet` });
    return () => {};
  }

  let cancelled = false;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  const arm = (ms: number, onTimeout: () => void) => {
    clearTimeout(watchdog);
    watchdog = setTimeout(onTimeout, ms);
  };

  if (language === "python") {
    if (!pyWorker) pyWorker = makeWorker(PY_WORKER_SRC);
    const worker = pyWorker;
    const runId = ++pyRunId;
    onEvent({ type: "env-loading" });
    const killEnv = () => {
      worker.terminate();
      if (pyWorker === worker) pyWorker = null;
      if (!cancelled) onEvent({ type: "fatal", error: "python runner timed out" });
    };
    arm(ENV_TIMEOUT_MS, killEnv);
    worker.onmessage = (e) => {
      if (cancelled || e.data.runId !== runId) return;
      if (e.data.type === "all-done" || e.data.type === "fatal") clearTimeout(watchdog);
      else arm(CASE_TIMEOUT_MS, killEnv);
      onEvent(e.data as RunnerEvent);
    };
    worker.postMessage({ code: opts.code, fnName, cases, runId });
    return () => {
      cancelled = true;
      clearTimeout(watchdog);
    };
  }

  // javascript / typescript
  let code = opts.code;
  try {
    if (language === "typescript") {
      code = transform(code, { transforms: ["typescript"] }).code;
    }
    code = instrument(code);
  } catch (err) {
    onEvent({ type: "fatal", error: `could not prepare code: ${err}` });
    return () => {};
  }

  const worker = makeWorker(JS_WORKER_SRC);
  const kill = (reason?: string) => {
    clearTimeout(watchdog);
    worker.terminate();
    if (!cancelled && reason) onEvent({ type: "fatal", error: reason });
  };
  arm(CASE_TIMEOUT_MS, () => kill("runner timed out (infinite loop?)"));
  worker.onmessage = (e) => {
    if (cancelled) return;
    if (e.data.type === "all-done" || e.data.type === "fatal") {
      clearTimeout(watchdog);
      worker.terminate();
    } else {
      arm(CASE_TIMEOUT_MS, () => kill("runner timed out (infinite loop?)"));
    }
    onEvent(e.data as RunnerEvent);
  };
  worker.onerror = (e) => {
    if (!cancelled) kill(`runner crashed: ${e.message}`);
  };
  worker.postMessage({ code, fnName, cases });
  return () => {
    cancelled = true;
    clearTimeout(watchdog);
    worker.terminate();
  };
}
