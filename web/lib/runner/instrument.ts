// Injects a __s() call at the top of every braced loop body so the worker can
// count "iterations" and enforce a step budget. Best-effort single-pass
// scanner: skips strings, template literals, and comments; unbraced loop
// bodies are left uninstrumented.
export function instrument(code: string): string {
  const out: string[] = [];
  let i = 0;
  const n = code.length;
  let headerDepth = 0; // inside for(...)/while(...) parens
  let inHeader = false;
  let pendingBody = false; // loop header done, waiting for '{'

  const copyString = (quote: string) => {
    out.push(code[i]);
    i++;
    while (i < n) {
      const c = code[i];
      out.push(c);
      i++;
      if (c === "\\") {
        if (i < n) {
          out.push(code[i]);
          i++;
        }
      } else if (c === quote) {
        break;
      }
    }
  };

  while (i < n) {
    const ch = code[i];

    if (ch === '"' || ch === "'" || ch === "`") {
      copyString(ch);
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      while (i < n && code[i] !== "\n") out.push(code[i++]);
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      out.push(code[i++], code[i++]);
      while (i < n && !(code[i] === "*" && code[i + 1] === "/")) out.push(code[i++]);
      if (i < n) out.push(code[i++], code[i++]);
      continue;
    }

    if (!inHeader && /[A-Za-z_$]/.test(ch)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_$]/.test(code[j])) j++;
      const word = code.slice(i, j);
      const prev = i > 0 ? code[i - 1] : "";
      const isWordStart = !/[A-Za-z0-9_$.]/.test(prev);
      if (isWordStart && (word === "for" || word === "while")) {
        inHeader = true;
        headerDepth = 0;
      } else if (isWordStart && word === "do") {
        pendingBody = true;
      }
      out.push(word);
      i = j;
      continue;
    }

    if (inHeader) {
      if (ch === "(") headerDepth++;
      else if (ch === ")") {
        headerDepth--;
        if (headerDepth === 0) {
          inHeader = false;
          pendingBody = true;
        }
      }
    } else if (pendingBody && !/\s/.test(ch)) {
      pendingBody = false;
      if (ch === "{") {
        out.push("{__s();");
        i++;
        continue;
      }
    }

    out.push(ch);
    i++;
  }
  return out.join("");
}
