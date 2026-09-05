// Minimal module hook so test scripts can import the app's .ts sources
// directly. Uses sucrase, which is already a dependency for the in-browser
// runner. Type-stripping only — no type checking (that's `tsc --noEmit`).
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { transform } from "sucrase";

export async function load(url, context, next) {
  if (url.endsWith(".ts")) {
    const path = fileURLToPath(url);
    const { code } = transform(await readFile(path, "utf8"), {
      transforms: ["typescript"],
      filePath: path,
    });
    return { format: "module", source: code, shortCircuit: true };
  }
  return next(url, context);
}
