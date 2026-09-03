// Turns LeetCode raw material into runnable testcases:
//   metaData          - entry point signature (JSON string from GraphQL)
//   exampleTestcases  - newline-separated arg literals, params.length per case
//   content_html      - description; expected outputs parsed from "Output:" lines
// Returns { meta, cases: [{args, expected}], runnable } or null when the
// problem can't be expressed this way (design problems, mismatched parses...).

// Types the in-browser runners can pass straight through as JSON.
// Uppercase types (TreeNode, ListNode) need codecs we don't have yet.
const SAFE_TYPE = /^(integer|long|double|boolean|string|character)(\[\])*$|^list<[a-z<>]+>$/;

function decodeEntities(s) {
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&");
}

export function extractOutputs(contentHtml) {
  const text = decodeEntities(contentHtml.replace(/<[^>]+>/g, ""));
  const outputs = [];
  for (const m of text.matchAll(/^\s*Output:?\s*(.+)$/gm)) {
    outputs.push(m[1].trim());
  }
  return outputs;
}

function parseLiteral(s) {
  try {
    return { ok: true, value: JSON.parse(s.trim()) };
  } catch {
    return { ok: false };
  }
}

export function buildTestcases({ metaData, exampleTestcases, contentHtml }) {
  if (!metaData || !exampleTestcases || !contentHtml) return null;
  let meta;
  try {
    meta = JSON.parse(metaData);
  } catch {
    return null;
  }
  // design problems have { classname: ... } instead of a single entry point
  if (!meta.name || !Array.isArray(meta.params) || !meta.return) return null;

  const lines = exampleTestcases.replace(/\r/g, "").trim().split("\n");
  const nParams = meta.params.length;
  if (nParams === 0 || lines.length % nParams !== 0) return null;
  const nCases = lines.length / nParams;

  const outputs = extractOutputs(contentHtml);
  if (outputs.length !== nCases) return null;

  const cases = [];
  for (let c = 0; c < nCases; c++) {
    const args = [];
    for (let p = 0; p < nParams; p++) {
      const r = parseLiteral(lines[c * nParams + p]);
      if (!r.ok) return null;
      args.push(r.value);
    }
    const exp = parseLiteral(outputs[c]);
    if (!exp.ok) return null;
    cases.push({ args, expected: exp.value });
  }

  const typesOk =
    meta.params.every((p) => SAFE_TYPE.test(p.type)) &&
    SAFE_TYPE.test(meta.return.type);

  return { meta, cases, runnable: typesOk };
}
