"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildTypableMask, skipForward, advance } from "@/lib/typing";
import {
  startRun,
  RUNNABLE_LANGUAGES,
  type RunnerEvent,
  type CaseResult,
} from "@/lib/runner";

type Testcase = { argsJson: string; expectedJson: string };

type Round = {
  id: number;
  title: string;
  slug: string;
  difficulty: "Easy" | "Medium" | "Hard";
  tags: string[];
  language: string;
  code: string;
  content: string | null;
  fnName: string | null;
  runnable: boolean;
  testcases: Testcase[];
};

type Listing = {
  id: number;
  title: string;
  slug: string;
  difficulty: Round["difficulty"];
  runnable: boolean;
};

type Meta = {
  languages: { language: string; problems: number }[];
  difficulties: string[];
};

type Status = "loading" | "ready" | "typing" | "done";

type CaseUI = {
  status: "pending" | "running" | CaseResult["status"];
  steps: number;
  ms?: number;
  got?: string;
  error?: string;
};

type RunPhase = "idle" | "env" | "running" | "done";

type LoadOpts = {
  lang: string;
  diff: string;
  problemId?: number;
  excludeId?: number;
  push: boolean;
};

const DIFF_COLOR: Record<Round["difficulty"], string> = {
  Easy: "text-easy",
  Medium: "text-medium",
  Hard: "text-hard",
};

function fmtTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtSteps(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

function preview(json: string, max = 44): string {
  return json.length > max ? json.slice(0, max - 1) + "…" : json;
}

function readParams() {
  const sp = new URLSearchParams(window.location.search);
  const p = Number(sp.get("p"));
  return {
    lang: sp.get("lang"),
    diff: sp.get("diff"),
    problemId: Number.isInteger(p) && p > 0 ? p : undefined,
  };
}

function syncUrl(lang: string, diff: string, problemId: number, push: boolean) {
  const sp = new URLSearchParams();
  sp.set("lang", lang);
  if (diff) sp.set("diff", diff);
  sp.set("p", String(problemId));
  const search = `?${sp.toString()}`;
  if (window.location.search === search) return;
  const url = window.location.pathname + search;
  if (push) history.pushState({}, "", url);
  else history.replaceState({}, "", url);
}

export default function Trainer() {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [language, setLanguage] = useState("python");
  const [difficulty, setDifficulty] = useState("");
  const [round, setRound] = useState<Round | null>(null);
  const [mask, setMask] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  const [pos, setPos] = useState(0);
  const [keystrokes, setKeystrokes] = useState(0);
  const [misses, setMisses] = useState(0);
  const [errorTick, setErrorTick] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  const [tab, setTab] = useState<"problem" | "tests">("problem");
  const [caseStates, setCaseStates] = useState<CaseUI[]>([]);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runError, setRunError] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [problemList, setProblemList] = useState<Listing[] | null>(null);
  const [query, setQuery] = useState("");

  const caretRef = useRef<HTMLSpanElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const roundRef = useRef<Round | null>(null);
  const maskRef = useRef<Uint8Array | null>(null);
  const cancelRunRef = useRef<(() => void) | null>(null);
  const listCacheRef = useRef<{ key: string; items: Listing[] } | null>(null);
  roundRef.current = round;
  maskRef.current = mask;

  // --- run state management ---------------------------------------------------
  const stopTests = useCallback(() => {
    cancelRunRef.current?.();
    cancelRunRef.current = null;
    setRunPhase("idle");
    setRunError(null);
    setCaseStates(
      (roundRef.current?.testcases ?? []).map(() => ({ status: "pending", steps: 0 }))
    );
  }, []);

  const resetRun = useCallback(() => {
    const m = maskRef.current;
    setPos(m ? skipForward(m, 0) : 0);
    setKeystrokes(0);
    setMisses(0);
    setStartedAt(null);
    setEndedAt(null);
    setStatus("ready");
    stopTests();
    setTab("problem");
  }, [stopTests]);

  // --- round loading ------------------------------------------------------------
  // A candidate next round is prefetched in the background after every load so
  // "next" swaps in with zero network wait.
  const prefetchRef = useRef<{ key: string; round: Round } | null>(null);

  const prefetchNext = useCallback((lang: string, diff: string, excludeId: number) => {
    const params = new URLSearchParams({ language: lang });
    if (diff) params.set("difficulty", diff);
    params.set("exclude", String(excludeId));
    fetch(`/api/random?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Round | null) => {
        if (data) prefetchRef.current = { key: `${lang}|${diff}`, round: data };
      })
      .catch(() => {});
  }, []);

  const applyRound = useCallback(
    (data: Round, lang: string, diff: string, push: boolean) => {
      const m = buildTypableMask(data.code, data.language);
      // refs first so resetRun computes the start position from the new round
      roundRef.current = data;
      maskRef.current = m;
      setRound(data);
      setMask(m);
      setError(null);
      resetRun();
      syncUrl(lang, diff, data.id, push);
      prefetchNext(lang, diff, data.id);
    },
    [resetRun, prefetchNext]
  );

  const loadRound = useCallback(
    async (opts: LoadOpts) => {
      setStatus("loading");
      setError(null);
      setPickerOpen(false);
      let url: string;
      if (opts.problemId) {
        url = `/api/problem?id=${opts.problemId}&language=${encodeURIComponent(opts.lang)}`;
      } else {
        const params = new URLSearchParams({ language: opts.lang });
        if (opts.diff) params.set("difficulty", opts.diff);
        if (opts.excludeId) params.set("exclude", String(opts.excludeId));
        url = `/api/random?${params}`;
      }
      const res = await fetch(url);
      if (!res.ok) {
        if (opts.problemId && res.status === 404) {
          // problem not available in this language -> fall back to a random one
          loadRound({ ...opts, problemId: undefined });
          return;
        }
        setRound(null);
        setError(
          res.status === 404
            ? "No problems match those filters. Loosen the difficulty or switch language."
            : "Something went wrong fetching a problem."
        );
        return;
      }
      const data: Round = await res.json();
      applyRound(data, opts.lang, opts.diff, opts.push);
    },
    [applyRound]
  );
  const loadRoundRef = useRef(loadRound);
  loadRoundRef.current = loadRound;

  // boot: URL params win, then saved prefs
  const bootRef = useRef<{ lang: string; diff: string; problemId?: number } | null>(
    null
  );
  useEffect(() => {
    const p = readParams();
    const lang = p.lang ?? localStorage.getItem("yeet.language") ?? "python";
    const diff = p.diff ?? localStorage.getItem("yeet.difficulty") ?? "";
    setLanguage(lang);
    setDifficulty(diff);
    bootRef.current = { lang, diff, problemId: p.problemId };
    fetch("/api/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setError("Could not load metadata. Is the database built?"));
  }, []);

  // keep the browse list warm so the picker opens with zero wait
  const loadList = useCallback((lang: string, diff: string): Promise<Listing[]> => {
    const key = `${lang}|${diff}`;
    if (listCacheRef.current?.key === key) {
      return Promise.resolve(listCacheRef.current.items);
    }
    const params = new URLSearchParams({ language: lang });
    if (diff) params.set("difficulty", diff);
    return fetch(`/api/problems?${params}`)
      .then((r) => r.json())
      .then((items: Listing[]) => {
        listCacheRef.current = { key, items };
        return items;
      });
  }, []);

  const bootedRef = useRef(false);
  useEffect(() => {
    if (meta && !bootedRef.current && bootRef.current) {
      bootedRef.current = true;
      const b = bootRef.current;
      loadRound({ lang: b.lang, diff: b.diff, problemId: b.problemId, push: false });
      loadList(b.lang, b.diff);
    }
  }, [meta, loadRound, loadList]);

  // back/forward navigates between rounds
  useEffect(() => {
    const onPop = () => {
      const p = readParams();
      const lang = p.lang ?? "python";
      const diff = p.diff ?? "";
      setLanguage(lang);
      setDifficulty(diff);
      loadRoundRef.current({ lang, diff, problemId: p.problemId, push: false });
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const nextRound = useCallback(() => {
    const pf = prefetchRef.current;
    if (
      pf &&
      pf.key === `${language}|${difficulty}` &&
      pf.round.id !== roundRef.current?.id
    ) {
      prefetchRef.current = null;
      applyRound(pf.round, language, difficulty, true);
      return;
    }
    loadRound({
      lang: language,
      diff: difficulty,
      excludeId: roundRef.current?.id,
      push: true,
    });
  }, [loadRound, applyRound, language, difficulty]);

  const changeLanguage = (lang: string) => {
    setLanguage(lang);
    localStorage.setItem("yeet.language", lang);
    prefetchRef.current = null;
    // keep the same problem when it exists in the new language
    loadRound({ lang, diff: difficulty, problemId: roundRef.current?.id, push: false });
    loadList(lang, difficulty);
  };
  const changeDifficulty = (diff: string) => {
    setDifficulty(diff);
    localStorage.setItem("yeet.difficulty", diff);
    prefetchRef.current = null;
    loadRound({ lang: language, diff, push: false });
    loadList(language, diff);
  };

  // --- problem picker ---------------------------------------------------------
  useEffect(() => {
    if (!pickerOpen) return;
    setQuery("");
    const key = `${language}|${difficulty}`;
    if (listCacheRef.current?.key === key) {
      setProblemList(listCacheRef.current.items);
    } else {
      setProblemList(null);
      loadList(language, difficulty).then(setProblemList);
    }
  }, [pickerOpen, language, difficulty, loadList]);

  const filtered = useMemo(() => {
    if (!problemList) return [];
    const q = query.trim().toLowerCase();
    if (!q) return problemList;
    return problemList.filter(
      (p) => p.title.toLowerCase().includes(q) || String(p.id).startsWith(q)
    );
  }, [problemList, query]);

  const pickProblem = useCallback(
    (problemId: number) => {
      loadRound({ lang: language, diff: difficulty, problemId, push: true });
    },
    [loadRound, language, difficulty]
  );

  // --- test runner --------------------------------------------------------------
  const canRun = !!(
    round &&
    round.runnable &&
    round.fnName &&
    round.testcases.length > 0 &&
    RUNNABLE_LANGUAGES.has(round.language)
  );

  const startTests = useCallback(() => {
    const r = roundRef.current;
    if (!r || !r.fnName || r.testcases.length === 0) return;
    cancelRunRef.current?.();
    setRunError(null);
    setCaseStates(r.testcases.map(() => ({ status: "pending", steps: 0 })));
    setRunPhase(r.language === "python" ? "env" : "running");
    setTab("tests");
    const patch = (i: number, p: Partial<CaseUI>) =>
      setCaseStates((cs) => cs.map((c, k) => (k === i ? { ...c, ...p } : c)));
    cancelRunRef.current = startRun({
      language: r.language,
      code: r.code,
      fnName: r.fnName,
      cases: r.testcases,
      onEvent: (ev: RunnerEvent) => {
        switch (ev.type) {
          case "env-loading":
            setRunPhase("env");
            break;
          case "env-ready":
            setRunPhase("running");
            break;
          case "case-start":
            patch(ev.index, { status: "running" });
            break;
          case "progress":
            patch(ev.index, { steps: ev.steps });
            break;
          case "case-done":
            patch(ev.index, { ...ev.result });
            break;
          case "fatal":
            setRunError(ev.error);
            setRunPhase("done");
            break;
          case "all-done":
            setRunPhase("done");
            break;
        }
      },
    });
  }, []);
  const startTestsRef = useRef(startTests);
  startTestsRef.current = startTests;
  const canRunRef = useRef(canRun);
  canRunRef.current = canRun;

  // --- typing engine ----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPickerOpen((v) => !v);
        return;
      }
      if (pickerOpen) {
        if (e.key === "Escape") {
          e.preventDefault();
          setPickerOpen(false);
        }
        return;
      }

      const r = roundRef.current;
      const m = maskRef.current;

      if (e.key === "Tab") {
        e.preventDefault();
        nextRound();
        return;
      }
      if (status === "done") {
        if (e.key === "Enter") nextRound();
        if (e.key === "Escape") resetRun();
        return;
      }
      if (e.key === "Escape") {
        resetRun();
        return;
      }
      if (!r || !m || status === "loading") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const expected = r.code[pos];
      const typed = e.key === "Enter" ? "\n" : e.key.length === 1 ? e.key : null;
      if (typed === null) return;
      e.preventDefault();

      if (status === "ready") {
        setStartedAt(Date.now());
        setStatus("typing");
      }

      if (typed === expected) {
        const next = advance(m, pos);
        setKeystrokes((k) => k + 1);
        setPos(next);
        if (next >= r.code.length) {
          setEndedAt(Date.now());
          setStatus("done");
          if (canRunRef.current) startTestsRef.current();
        }
      } else {
        setMisses((v) => v + 1);
        setErrorTick((t) => t + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pos, status, pickerOpen, nextRound, resetRun]);

  // live clock while typing
  useEffect(() => {
    if (status !== "typing") return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [status]);

  // keep the caret line in view
  useEffect(() => {
    caretRef.current?.scrollIntoView({ block: "nearest" });
  }, [pos]);

  // --- derived stats -----------------------------------------------------------
  const elapsed = startedAt ? (endedAt ?? now) - startedAt : 0;
  const minutes = elapsed / 60000;
  const wpm = minutes > 0 ? Math.round(keystrokes / 5 / minutes) : 0;
  const accuracy =
    keystrokes + misses > 0
      ? Math.round((keystrokes / (keystrokes + misses)) * 100)
      : 100;
  const progress = round ? Math.round((pos / round.code.length) * 100) : 0;
  const passCount = caseStates.filter(
    (c) => c.status === "pass" || c.status === "pass-unordered"
  ).length;

  // --- typing surface -----------------------------------------------------------
  const surface = useMemo(() => {
    if (!round || !mask) return null;
    const { code } = round;
    type Kind = "skip" | "typed" | "caret" | "ghost";
    const parts: { text: string; kind: Kind }[] = [];
    let i = 0;
    while (i < code.length) {
      const typable = mask[i] === 1;
      let j = i;
      while (j < code.length && (mask[j] === 1) === typable) j++;
      if (!typable) {
        parts.push({ text: code.slice(i, j), kind: "skip" });
      } else if (j <= pos) {
        parts.push({ text: code.slice(i, j), kind: "typed" });
      } else if (i > pos) {
        parts.push({ text: code.slice(i, j), kind: "ghost" });
      } else {
        if (pos > i) parts.push({ text: code.slice(i, pos), kind: "typed" });
        parts.push({ text: code[pos], kind: "caret" });
        if (pos + 1 < j) parts.push({ text: code.slice(pos + 1, j), kind: "ghost" });
      }
      i = j;
    }
    return (
      <pre className="font-mono text-[15px] leading-7 whitespace-pre overflow-x-auto">
        {parts.map((p, k) => {
          if (p.kind === "caret") {
            const isNewline = p.text === "\n";
            return (
              <span key={`c${errorTick}`}>
                <span
                  ref={caretRef}
                  className={`caret [scroll-margin:6rem] ${
                    errorTick > 0 ? "caret-error" : ""
                  } ${status !== "typing" ? "caret-idle" : ""}`}
                >
                  {isNewline ? "↵" : p.text}
                </span>
                {isNewline ? "\n" : ""}
              </span>
            );
          }
          const cls =
            p.kind === "typed"
              ? "text-ink"
              : p.kind === "skip"
                ? "text-skip italic"
                : "text-ghost";
          return (
            <span key={k} className={cls}>
              {p.text}
            </span>
          );
        })}
      </pre>
    );
  }, [round, mask, pos, status, errorTick]);

  // --- tests tab ------------------------------------------------------------------
  const argPreviews = useMemo(
    () =>
      (round?.testcases ?? []).map((t) => {
        try {
          return (JSON.parse(t.argsJson) as unknown[])
            .map((a) => JSON.stringify(a))
            .join(", ");
        } catch {
          return t.argsJson;
        }
      }),
    [round]
  );

  const CASE_ICON: Record<CaseUI["status"], { icon: string; cls: string }> = {
    pending: { icon: "·", cls: "text-ghost" },
    running: { icon: "◌", cls: "text-accent animate-spin inline-block" },
    pass: { icon: "✓", cls: "text-ok" },
    "pass-unordered": { icon: "≈", cls: "text-ok" },
    fail: { icon: "✗", cls: "text-error" },
    error: { icon: "!", cls: "text-error" },
  };

  const testsView = round && (
    <div className="p-5 pt-3 overflow-y-auto font-mono text-sm">
      {round.testcases.length === 0 && (
        <p className="text-muted">No example tests available for this problem.</p>
      )}
      {round.testcases.length > 0 && !canRun && (
        <p className="text-muted text-xs mb-3">
          {RUNNABLE_LANGUAGES.has(round.language)
            ? "This problem needs argument types the runner can't build yet (trees, linked lists, design classes)."
            : `In-browser runs work for python · javascript · typescript — not ${round.language} yet.`}
        </p>
      )}
      {runPhase === "env" && (
        <p className="text-accent text-xs mb-3 animate-pulse">
          warming up python (first run downloads ~10 MB)…
        </p>
      )}
      {runError && <p className="text-error text-xs mb-3">{runError}</p>}
      <ul className="space-y-2">
        {round.testcases.map((t, i) => {
          const c = caseStates[i] ?? { status: "pending", steps: 0 };
          const ic = CASE_ICON[c.status];
          return (
            <li key={i} className="border border-line rounded px-3 py-2 bg-bg/40">
              <div className="flex items-center gap-2">
                <span className={`w-4 text-center ${ic.cls}`}>{ic.icon}</span>
                <span className="text-muted text-xs truncate flex-1">
                  ({preview(argPreviews[i])})
                </span>
                {(c.status === "running" || c.steps > 0) && (
                  <span className="text-xs text-accent tabular-nums shrink-0">
                    {fmtSteps(c.steps)} iter
                  </span>
                )}
                {c.ms !== undefined && (
                  <span className="text-xs text-ghost tabular-nums shrink-0">
                    {c.ms < 1 ? "<1" : Math.round(c.ms)}ms
                  </span>
                )}
              </div>
              {(c.status === "fail" || c.status === "error") && (
                <div className="mt-1.5 pl-6 text-xs space-y-0.5">
                  {c.status === "fail" && (
                    <>
                      <div className="text-muted">
                        expected{" "}
                        <span className="text-ok">{preview(t.expectedJson, 60)}</span>
                      </div>
                      <div className="text-muted">
                        got <span className="text-error">{preview(c.got ?? "?", 60)}</span>
                      </div>
                    </>
                  )}
                  {c.status === "error" && <div className="text-error">{c.error}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {canRun && (
        <button
          onClick={startTests}
          disabled={runPhase === "running" || runPhase === "env"}
          className="mt-4 font-mono text-xs border border-line text-muted rounded px-3 py-1.5 hover:text-ink disabled:opacity-40 focus:outline-2 focus:outline-accent"
        >
          {runPhase === "done" ? "run again" : "run tests"}
        </button>
      )}
    </div>
  );

  // --- layout ---------------------------------------------------------------------
  return (
    <div className="flex-1 flex flex-col max-w-7xl w-full mx-auto px-6">
      <header className="flex items-center justify-between gap-4 py-6">
        <div className="font-mono font-bold text-xl tracking-tight select-none">
          yeetcode<span className="caret caret-idle">&nbsp;</span>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <button
            onClick={() => setPickerOpen(true)}
            className="bg-surface border border-line rounded px-3 py-1.5 font-mono text-muted hover:text-ink hover:border-ghost focus:outline-2 focus:outline-accent"
          >
            browse <kbd className="text-ghost">ctrl k</kbd>
          </button>
          <select
            value={language}
            onChange={(e) => {
              changeLanguage(e.target.value);
              e.currentTarget.blur();
            }}
            aria-label="Language"
            className="bg-surface border border-line rounded px-2 py-1.5 font-mono text-muted focus:outline-2 focus:outline-accent"
          >
            {(meta?.languages ?? [{ language, problems: 0 }]).map((l) => (
              <option key={l.language} value={l.language}>
                {l.language}
                {l.problems ? ` · ${l.problems}` : ""}
              </option>
            ))}
          </select>
          <select
            value={difficulty}
            onChange={(e) => {
              changeDifficulty(e.target.value);
              e.currentTarget.blur();
            }}
            aria-label="Difficulty"
            className="bg-surface border border-line rounded px-2 py-1.5 font-mono text-muted focus:outline-2 focus:outline-accent"
          >
            <option value="">all difficulties</option>
            {(meta?.difficulties ?? []).map((d) => (
              <option key={d} value={d}>
                {d.toLowerCase()}
              </option>
            ))}
          </select>
          <button
            onClick={(e) => {
              nextRound();
              e.currentTarget.blur();
            }}
            className="bg-surface border border-line rounded px-3 py-1.5 font-mono text-muted hover:text-ink hover:border-ghost focus:outline-2 focus:outline-accent"
          >
            next <kbd className="text-ghost">tab</kbd>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 pb-6">
        {/* side panel */}
        <aside className="lg:w-100 lg:shrink-0 border border-line rounded-lg bg-surface flex flex-col max-h-80 lg:max-h-[72vh]">
          {round ? (
            <>
              <div className="p-5 pb-0">
                <h1 className="font-mono text-base leading-snug">
                  <button
                    onClick={() => setPickerOpen(true)}
                    className="text-left hover:underline decoration-ghost underline-offset-4 focus:outline-2 focus:outline-accent"
                    title="Browse problems (ctrl k)"
                  >
                    <span className="text-muted">{round.id}.</span> {round.title}
                  </button>
                </h1>
                <div className="flex items-center gap-3 mt-1.5">
                  <span className={`${DIFF_COLOR[round.difficulty]} text-xs font-mono`}>
                    {round.difficulty.toLowerCase()}
                  </span>
                  <span className="text-xs text-ghost font-mono truncate">
                    {round.tags.slice(0, 4).join(" · ")}
                  </span>
                </div>
                <div className="flex gap-4 mt-3 border-b border-line">
                  {(["problem", "tests"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={(e) => {
                        setTab(t);
                        e.currentTarget.blur();
                      }}
                      className={`font-mono text-xs pb-2 -mb-px border-b-2 focus:outline-2 focus:outline-accent ${
                        tab === t
                          ? "text-ink border-accent"
                          : "text-muted border-transparent hover:text-ink"
                      }`}
                    >
                      {t}
                      {t === "tests" && round.testcases.length > 0
                        ? ` (${round.testcases.length})`
                        : ""}
                    </button>
                  ))}
                </div>
              </div>
              {tab === "problem" ? (
                <div className="p-5 pt-3 overflow-y-auto">
                  {round.content ? (
                    <div
                      className="problem-body"
                      dangerouslySetInnerHTML={{ __html: round.content }}
                    />
                  ) : (
                    <p className="text-sm text-muted">
                      No description stored for this one — go by the title, or hit{" "}
                      <kbd className="font-mono text-ink">tab</kbd> for another problem.
                    </p>
                  )}
                </div>
              ) : (
                testsView
              )}
            </>
          ) : (
            <p className="p-5 text-sm font-mono text-ghost">
              {status === "loading" ? "…" : ""}
            </p>
          )}
        </aside>

        {/* typing surface */}
        <main className="relative flex-1 min-w-0">
          <div
            className={`border border-line rounded-lg bg-surface p-6 max-h-[64vh] overflow-y-auto transition-opacity duration-150 ${
              status === "done" ? "ignited" : ""
            } ${status === "loading" && round ? "opacity-50" : ""}`}
          >
            {!round && (
              <p
                className={`font-mono text-[15px] ${error ? "text-error" : "text-ghost"}`}
              >
                {error ?? "pulling a problem…"}
              </p>
            )}
            {round && error && (
              <p className="font-mono text-error text-[15px] mb-3">{error}</p>
            )}
            {surface}
          </div>

          {/* stats line */}
          <div className="flex items-center gap-6 pt-4 font-mono text-sm text-muted">
            {status === "ready" && <span>type to start</span>}
            {(status === "typing" || status === "done") && (
              <>
                <span>
                  <span className="text-accent font-medium">{wpm}</span> wpm
                </span>
                <span>
                  <span className={accuracy < 90 ? "text-error" : "text-ink"}>
                    {accuracy}%
                  </span>{" "}
                  acc
                </span>
                <span>{fmtTime(elapsed)}</span>
                <span className="ml-auto">{progress}%</span>
              </>
            )}
          </div>

          {/* results */}
          {status === "done" && round && (
            <div className="absolute inset-0 flex items-start justify-center pt-16 pointer-events-none">
              <div className="pointer-events-auto bg-bg/95 border border-line rounded-lg px-10 py-8 text-center shadow-2xl">
                <div className="font-mono text-6xl font-bold text-accent">{wpm}</div>
                <div className="font-mono text-xs text-muted mt-1 mb-5">wpm</div>
                <div className="flex gap-8 justify-center font-mono text-sm">
                  <div>
                    <div className={accuracy < 90 ? "text-error" : "text-ok"}>
                      {accuracy}%
                    </div>
                    <div className="text-xs text-ghost mt-0.5">accuracy</div>
                  </div>
                  <div>
                    <div className="text-ink">{fmtTime(elapsed)}</div>
                    <div className="text-xs text-ghost mt-0.5">time</div>
                  </div>
                  <div>
                    <div className="text-ink">{misses}</div>
                    <div className="text-xs text-ghost mt-0.5">misses</div>
                  </div>
                  {caseStates.length > 0 && canRun && (
                    <div>
                      <div
                        className={
                          runPhase === "done"
                            ? passCount === caseStates.length
                              ? "text-ok"
                              : "text-error"
                            : "text-accent animate-pulse"
                        }
                      >
                        {runPhase === "done"
                          ? `${passCount}/${caseStates.length}`
                          : "running"}
                      </div>
                      <div className="text-xs text-ghost mt-0.5">tests</div>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 justify-center mt-6">
                  <button
                    onClick={nextRound}
                    className="font-mono text-sm bg-accent text-bg rounded px-4 py-2 font-medium hover:brightness-110 focus:outline-2 focus:outline-ink"
                  >
                    next problem <kbd className="opacity-60">enter</kbd>
                  </button>
                  <button
                    onClick={resetRun}
                    className="font-mono text-sm border border-line text-muted rounded px-4 py-2 hover:text-ink focus:outline-2 focus:outline-accent"
                  >
                    retype <kbd className="text-ghost">esc</kbd>
                  </button>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* problem picker */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-start justify-center pt-[12vh] px-6"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div className="w-full max-w-xl bg-surface border border-line rounded-lg flex flex-col max-h-[70vh] shadow-2xl">
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && filtered.length > 0) {
                  pickProblem(filtered[0].id);
                }
              }}
              placeholder={`search ${problemList?.length ?? "…"} ${language} problems…`}
              className="bg-transparent border-b border-line px-5 py-4 font-mono text-sm text-ink placeholder:text-ghost focus:outline-none"
            />
            <div className="overflow-y-auto flex-1">
              {problemList === null && (
                <p className="p-5 font-mono text-sm text-ghost">loading…</p>
              )}
              {problemList !== null && filtered.length === 0 && (
                <p className="p-5 font-mono text-sm text-muted">
                  Nothing matches “{query}”.
                </p>
              )}
              <ul>
                {filtered.slice(0, 200).map((p) => (
                  <li key={p.slug} className="picker-row">
                    <button
                      onClick={() => pickProblem(p.id)}
                      className={`w-full text-left px-5 py-2.5 font-mono text-sm flex items-center gap-3 hover:bg-bg/60 focus:outline-2 focus:-outline-offset-2 focus:outline-accent ${
                        round?.slug === p.slug ? "bg-bg/40" : ""
                      }`}
                    >
                      <span className="text-ghost w-12 shrink-0 text-right">{p.id}.</span>
                      <span className="text-ink truncate flex-1">{p.title}</span>
                      {p.runnable && (
                        <span className="text-ok text-xs shrink-0" title="runs tests">
                          ▸ tests
                        </span>
                      )}
                      <span
                        className={`${DIFF_COLOR[p.difficulty]} text-xs w-16 shrink-0 text-right`}
                      >
                        {p.difficulty.toLowerCase()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {filtered.length > 200 && (
                <p className="px-5 py-3 font-mono text-xs text-ghost">
                  {filtered.length - 200} more — refine the search…
                </p>
              )}
            </div>
            <div className="border-t border-line px-5 py-2.5 flex justify-between font-mono text-xs text-ghost">
              <span>enter picks the top match</span>
              <span>esc closes</span>
            </div>
          </div>
        </div>
      )}

      <footer className="py-4 flex items-center justify-between text-xs font-mono text-ghost border-t border-line">
        <span>
          solutions:{" "}
          <a
            href="https://github.com/neetcode-gh/leetcode"
            className="underline hover:text-muted"
          >
            neetcode
          </a>{" "}
          (MIT) · problems © leetcode
        </span>
        <span>ctrl k browse · tab next · esc restart · comments skipped for you</span>
      </footer>
    </div>
  );
}
