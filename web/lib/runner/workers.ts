// Worker source strings (spawned as blob workers). Kept as plain strings so
// no bundler magic is involved. Protocol (worker -> main):
//   { type: "env-ready" }                       python only, after pyodide loads
//   { type: "case-start", index }
//   { type: "progress", index, steps }          js only, mid-run
//   { type: "case-done", index, result }
//   { type: "fatal", error }
//   { type: "all-done" }
// result: { status: "pass"|"pass-unordered"|"fail"|"error", got?, error?, ms, steps }

export const JS_WORKER_SRC = String.raw`
"use strict";
var __steps = 0, __cur = 0, __lastPost = 0;
var __BUDGET = 50000000;
function __s() {
  __steps++;
  if ((__steps & 8191) === 0) {
    if (__steps > __BUDGET) throw new Error("step budget exceeded (infinite loop?)");
    if (__steps - __lastPost >= 40000) {
      __lastPost = __steps;
      postMessage({ type: "progress", index: __cur, steps: __steps });
    }
  }
}
function __deepEq(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-6;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (!__deepEq(a[i], b[i])) return false;
    return true;
  }
  return false;
}
function __key(x) { return JSON.stringify(x); }
function __unorderedEq(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  var sa = a.map(__key).sort();
  var sb = b.map(__key).sort();
  for (var i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return false;
  return true;
}
onmessage = async function (e) {
  var code = e.data.code, fnName = e.data.fnName, cases = e.data.cases;
  var entry;
  try {
    var factory = new Function("__s",
      code +
      "\n;return { fn: (typeof " + fnName + " === 'function' ? " + fnName + " : undefined)," +
      " cls: (typeof Solution === 'function' ? Solution : undefined) };");
    var exported = factory(__s);
    if (exported.fn) entry = exported.fn;
    else if (exported.cls) {
      var inst = new exported.cls();
      if (typeof inst[fnName] === "function") entry = inst[fnName].bind(inst);
    }
  } catch (err) {
    postMessage({ type: "fatal", error: String(err) });
    return;
  }
  if (!entry) {
    postMessage({ type: "fatal", error: "could not find function '" + fnName + "' or a Solution class with it" });
    return;
  }
  for (var i = 0; i < cases.length; i++) {
    __cur = i; __steps = 0; __lastPost = 0;
    postMessage({ type: "case-start", index: i });
    var t0 = performance.now();
    try {
      var args = JSON.parse(cases[i].argsJson);
      var expected = JSON.parse(cases[i].expectedJson);
      var got = entry.apply(null, args);
      var ms = performance.now() - t0;
      var status = __deepEq(got, expected) ? "pass"
        : __unorderedEq(got, expected) ? "pass-unordered" : "fail";
      postMessage({ type: "case-done", index: i, result: { status: status, got: JSON.stringify(got), ms: ms, steps: __steps } });
    } catch (err) {
      postMessage({ type: "case-done", index: i, result: { status: "error", error: String(err), ms: performance.now() - t0, steps: __steps } });
    }
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  postMessage({ type: "all-done" });
};
`;

const PY_SETUP = String.raw`
import json, sys, math, re, string, collections, heapq, bisect, itertools, functools
from collections import defaultdict, deque, Counter, OrderedDict
from typing import List, Optional, Dict, Set, Tuple
from functools import lru_cache, cache
from heapq import heappush, heappop, heapify
NS = dict(globals())
exec(USER_CODE, NS)
if "Solution" not in NS:
    raise RuntimeError("no Solution class in the typed code")
SOL = NS["Solution"]()
FN = getattr(SOL, FN_NAME)
`;

const PY_RUN_CASE = String.raw`
import json, sys
args = json.loads(ARGS_JSON)
expected = json.loads(EXPECTED_JSON)
steps = 0
def _tr(frame, event, arg):
    global steps
    if event == "line":
        steps += 1
        if steps > 5000000:
            raise RuntimeError("step budget exceeded (infinite loop?)")
    return _tr
err = None
got = None
sys.settrace(_tr)
try:
    got = FN(*args)
except BaseException as ex:
    err = repr(ex)
finally:
    sys.settrace(None)

def _norm(x):
    if isinstance(x, tuple):
        x = list(x)
    if isinstance(x, (set, frozenset)):
        x = sorted(x)
    if isinstance(x, list):
        return [_norm(v) for v in x]
    if isinstance(x, bool):
        return x
    if isinstance(x, float):
        return round(x, 5)
    return x

if err is not None:
    out = {"status": "error", "error": err, "steps": steps}
else:
    g, e = _norm(got), _norm(expected)
    if g == e:
        st = "pass"
    elif (isinstance(g, list) and isinstance(e, list) and len(g) == len(e)
          and sorted(json.dumps(x, sort_keys=True, default=str) for x in g)
          == sorted(json.dumps(x, sort_keys=True, default=str) for x in e)):
        st = "pass-unordered"
    else:
        st = "fail"
    out = {"status": st, "got": json.dumps(got, default=str), "steps": steps}
json.dumps(out)
`;

export const PY_WORKER_SRC = `
importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");
var pyReady = loadPyodide({ indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/" });
var SETUP = ${JSON.stringify(PY_SETUP)};
var RUN_CASE = ${JSON.stringify(PY_RUN_CASE)};
onmessage = async function (e) {
  var code = e.data.code, fnName = e.data.fnName, cases = e.data.cases, runId = e.data.runId;
  var py;
  try {
    py = await pyReady;
  } catch (err) {
    postMessage({ type: "fatal", error: "pyodide failed to load: " + err, runId: runId });
    return;
  }
  postMessage({ type: "env-ready", runId: runId });
  try {
    py.globals.set("USER_CODE", code);
    py.globals.set("FN_NAME", fnName);
    py.runPython(SETUP);
  } catch (err) {
    postMessage({ type: "fatal", error: String(err), runId: runId });
    return;
  }
  for (var i = 0; i < cases.length; i++) {
    postMessage({ type: "case-start", index: i, runId: runId });
    var t0 = performance.now();
    try {
      py.globals.set("ARGS_JSON", cases[i].argsJson);
      py.globals.set("EXPECTED_JSON", cases[i].expectedJson);
      var resJson = py.runPython(RUN_CASE);
      var result = JSON.parse(resJson);
      result.ms = performance.now() - t0;
      postMessage({ type: "case-done", index: i, result: result, runId: runId });
    } catch (err) {
      postMessage({ type: "case-done", index: i, result: { status: "error", error: String(err), ms: performance.now() - t0, steps: 0 }, runId: runId });
    }
    await new Promise(function (r) { setTimeout(r, 300); });
  }
  postMessage({ type: "all-done", runId: runId });
};
`;
