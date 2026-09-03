// Decides which characters of a solution the user actually has to type.
// Skipped (mask 0): full-line comments, blank lines, and each line's leading
// indentation. The engine auto-advances through skipped runs; the UI renders
// them in a dimmed style and they never count toward WPM.

const HASH_COMMENT_LANGS = new Set(["python", "ruby"]);
const DOCSTRING_LANGS = new Set(["python"]);

export function buildTypableMask(code: string, language: string): Uint8Array {
  const mask = new Uint8Array(code.length).fill(1);
  const lines = code.split("\n");
  const hashStyle = HASH_COMMENT_LANGS.has(language);

  let offset = 0;
  let inBlock = false;
  let blockCloser = "";

  for (const line of lines) {
    const trimmed = line.trim();
    let isComment = false;

    if (inBlock) {
      isComment = true;
      const at = trimmed.indexOf(blockCloser);
      if (at !== -1) {
        inBlock = false;
        // code after the closer on the same line -> line must still be typed
        if (trimmed.slice(at + blockCloser.length).trim() !== "") isComment = false;
      }
    } else if (hashStyle) {
      if (trimmed.startsWith("#")) {
        isComment = true;
      } else if (
        DOCSTRING_LANGS.has(language) &&
        (trimmed.startsWith('"""') || trimmed.startsWith("'''"))
      ) {
        const quote = trimmed.slice(0, 3);
        isComment = true;
        if (!trimmed.slice(3).includes(quote)) {
          inBlock = true;
          blockCloser = quote;
        }
      }
    } else {
      if (trimmed.startsWith("//")) {
        isComment = true;
      } else if (trimmed.startsWith("/*")) {
        isComment = true;
        const at = trimmed.indexOf("*/", 2);
        if (at === -1) {
          inBlock = true;
          blockCloser = "*/";
        } else if (trimmed.slice(at + 2).trim() !== "") {
          isComment = false;
        }
      }
    }

    const lineEnd = Math.min(offset + line.length + 1, code.length); // incl. "\n"
    if (isComment || trimmed === "") {
      mask.fill(0, offset, lineEnd);
    } else {
      // leading indentation is auto-consumed
      const indent = line.length - line.trimStart().length;
      mask.fill(0, offset, offset + indent);
    }
    offset += line.length + 1;
  }
  return mask;
}

/** First typable index at or after `i`. May return code.length. */
export function skipForward(mask: Uint8Array, i: number): number {
  while (i < mask.length && !mask[i]) i++;
  return i;
}

/** Position after correctly typing the char at `pos`. */
export function advance(mask: Uint8Array, pos: number): number {
  return skipForward(mask, pos + 1);
}
