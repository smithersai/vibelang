#!/usr/bin/env bun
// vsc.ts — VibeScript (.vs) -> TypeScript (.ts) lowering.
// DELIBERATELY HACKY: regex + a tiny brace matcher, no real parser. See NOTES.md.
//
// usage: bun vsc.ts examples/demo.vs   (writes examples/demo.ts)

import { readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// tiny scanning helpers (string-aware-ish; comments handled only where it hurt)
// ---------------------------------------------------------------------------

/** index OF the closing quote for a string starting at src[i] (a quote char). */
function skipString(src: string, i: number): number {
  const q = src[i];
  i++;
  while (i < src.length) {
    if (src[i] === "\\") { i += 2; continue; }
    if (src[i] === q) return i;
    i++;
  }
  return i;
}

/** index of the delimiter closing the one at openIdx. Skips strings and // comments. */
function matchDelim(src: string, openIdx: number, open: string, close: string): number {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") { i = skipString(src, i); continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === open) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error(`vsc: unbalanced ${open}${close} starting at index ${openIdx}`);
}

/** Walk BACKWARDS from `end` to find the start of the expression ending there.
 *  Heuristic: stop at an unbalanced open-delim or at = , ; { } newline (depth 0). */
function scanExprBack(src: string, end: number): number {
  let depth = 0;
  let j = end;
  while (j > 0) {
    const c = src[j - 1];
    if (c === ")" || c === "]") depth++;
    else if (c === "(" || c === "[") { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === "=" || c === "," || c === ";" || c === "{" || c === "}" || c === "\n")) break;
    j--;
  }
  while (j < end && /\s/.test(src[j])) j++;
  return j;
}

/** Walk FORWARDS from `start` to the end of an expression.
 *  Heuristic: stop at ; , newline, //, or an unbalanced close-delim (depth 0). */
function scanExprFwd(src: string, start: number): number {
  let depth = 0;
  let j = start;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'" || c === "`") { j = skipString(src, j) + 1; continue; }
    if (c === "/" && src[j + 1] === "/") break;
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === ";" || c === "," || c === "\n")) break;
    j++;
  }
  return j;
}

/** true if the match at idx sits inside a // comment on its line (cheap check). */
function inLineComment(src: string, idx: number): boolean {
  const lineStart = src.lastIndexOf("\n", idx - 1) + 1;
  return src.slice(lineStart, idx).includes("//");
}

// ---------------------------------------------------------------------------
// pass 1: `error Name { field: type, ... }` -> class extending __VSError
// ---------------------------------------------------------------------------
function lowerErrors(src: string): string {
  const re = /\berror\s+([\w$]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (inLineComment(src, m.index)) continue;
    const name = m[1];
    const open = m.index + m[0].length - 1;
    const close = matchDelim(src, open, "{", "}");
    const fields = src
      .slice(open + 1, close)
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("//"))
      .map((s) => {
        const fm = s.match(/^(?:readonly\s+)?([\w$]+)\s*:\s*(.+)$/);
        if (!fm) throw new Error(`vsc: error ${name}: cannot parse field '${s}'`);
        return { name: fm[1], type: fm[2] };
      });
    const fieldsType = `{ ${fields.map((f) => `${f.name}: ${f.type}`).join("; ")} }`;
    const cls = [
      `class ${name} extends __VSError {`,
      `  declare readonly _tag: ${JSON.stringify(name)};`,
      ...fields.map((f) => `  declare readonly ${f.name}: ${f.type};`),
      fields.length
        ? `  constructor(fields: ${fieldsType}) { super(${JSON.stringify(name)}, fields); }`
        : `  constructor() { super(${JSON.stringify(name)}); }`,
      `}`,
    ].join("\n");
    src = src.slice(0, m.index) + cls + src.slice(close + 1);
    re.lastIndex = m.index + cls.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// pass 2: `provide { A: a, B: b } { body }` -> __vsProvide({...}, () => { body })
// ---------------------------------------------------------------------------
function lowerProvide(src: string): string {
  const re = /\bprovide\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (inLineComment(src, m.index)) continue;
    const objOpen = m.index + m[0].length - 1;
    const objClose = matchDelim(src, objOpen, "{", "}");
    const after = src.slice(objClose + 1);
    const rel = after.search(/\S/);
    if (rel === -1 || after[rel] !== "{") throw new Error("vsc: provide: expected { block } after frame object");
    const bodyOpen = objClose + 1 + rel;
    const bodyClose = matchDelim(src, bodyOpen, "{", "}");
    const out = `__vsProvide(${src.slice(objOpen, objClose + 1)}, () => {${src.slice(bodyOpen + 1, bodyClose)}})`;
    src = src.slice(0, m.index) + out + src.slice(bodyClose + 1);
    re.lastIndex = m.index + out.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// pass 3: `uses A, B` on function decls -> const A = __vsUse("A"); ... at body top.
// Also strips `!Err`/`!Err | Other` error-channel annotations from the signature
// (type-level channels are out of scope for the prototype).
// ---------------------------------------------------------------------------
function lowerUses(src: string): string {
  const re = /\bfunction\s+[\w$]*\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const parenOpen = m.index + m[0].length - 1;
    const parenClose = matchDelim(src, parenOpen, "(", ")");
    const braceIdx = src.indexOf("{", parenClose + 1); // return types containing { would break — noted
    if (braceIdx === -1) continue;
    let tail = src.slice(parenClose + 1, braceIdx);
    let inject = "";
    const um = tail.match(/\buses\s+([\w$]+(?:\s*,\s*[\w$]+)*)/);
    if (um) {
      inject = um[1]
        .split(/\s*,\s*/)
        .map((c) => ` const ${c} = __vsUse(${JSON.stringify(c)});`)
        .join("");
      tail = tail.replace(um[0], " ");
    }
    tail = tail.replace(/!\s*[\w$]+(?:\s*\|\s*[\w$]+)*/g, " "); // strip !Err annotations
    tail = tail.replace(/\s+/g, " ");
    const out = tail + "{" + inject;
    src = src.slice(0, parenClose + 1) + out + src.slice(braceIdx + 1);
    re.lastIndex = parenClose + 1 + out.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// pass 4: `expr catch |e| fallback` -> __vsCatch(() => (expr), (e: any) => ...)
// fallback may be any expression, or a `switch (...) { case T: expr ... }` whose
// inline case bodies get `return (...)` wrapped; unmatched tags rethrow.
// ---------------------------------------------------------------------------
function lowerCatch(src: string): string {
  const re = /\bcatch\s*\|([\w$]+)\|\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (inLineComment(src, m.index)) continue;
    const eName = m[1];
    const exprStart = scanExprBack(src, m.index);
    const expr = src.slice(exprStart, m.index).trimEnd();
    const fbStart = m.index + m[0].length;
    let out: string;
    let tailEnd: number;
    if (/^switch\b/.test(src.slice(fbStart))) {
      const parenOpen = src.indexOf("(", fbStart);
      const parenClose = matchDelim(src, parenOpen, "(", ")");
      const braceOpen = src.indexOf("{", parenClose);
      const braceClose = matchDelim(src, braceOpen, "{", "}");
      const cond = src.slice(parenOpen, parenClose + 1);
      const body = src.slice(braceOpen + 1, braceClose).replace(
        /^(\s*(?:case\s+[^:\n]+|default)\s*:\s*)(.+)$/gm,
        (line, head, rest) => (/^(return|throw|break)\b/.test(rest.trim()) ? line : `${head}return (${rest.trim()});`),
      );
      out = `__vsCatch(() => (${expr}), (${eName}: any) => { switch ${cond} {${body}} throw ${eName}; })`;
      tailEnd = braceClose + 1;
    } else {
      const fbEnd = scanExprFwd(src, fbStart);
      out = `__vsCatch(() => (${expr}), (${eName}: any) => (${src.slice(fbStart, fbEnd).trim()}))`;
      tailEnd = fbEnd;
    }
    src = src.slice(0, exprStart) + out + src.slice(tailEnd);
    re.lastIndex = exprStart + out.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// pass 5: `try expr` (expression position) -> __vsTry(() => (expr))
// `try {` statements are left alone via the lookahead.
// ---------------------------------------------------------------------------
function lowerTry(src: string): string {
  const re = /\btry\b(?!\s*[{(])\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (inLineComment(src, m.index)) continue;
    const exprStart = m.index + m[0].length;
    const exprEnd = scanExprFwd(src, exprStart);
    const out = `__vsTry(() => (${src.slice(exprStart, exprEnd).trim()}))`;
    src = src.slice(0, m.index) + out + src.slice(exprEnd);
    re.lastIndex = m.index + out.length;
  }
  return src;
}

// ---------------------------------------------------------------------------
// pass 6 (stretch): single-line if-expressions after `=` or `return` -> ternary
// ---------------------------------------------------------------------------
function lowerIfExpr(src: string): string {
  return src.replace(
    /(=\s*|\breturn\s+)if\s*\(([^)]*)\)\s*([^\n;]+?)\s+else\s+([^\n;]+)/g,
    (_s, pre, cond, a, b) => `${pre}((${cond}) ? (${a}) : (${b}))`,
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const inFile = process.argv[2];
if (!inFile || !inFile.endsWith(".vs")) {
  console.error("usage: bun vsc.ts <file.vs>");
  process.exit(1);
}
const abs = path.resolve(inFile);
const outFile = abs.replace(/\.vs$/, ".ts");

const HERE = (import.meta as any).dirname ?? path.dirname(new URL(import.meta.url).pathname);
let runtimeImport = path.relative(path.dirname(outFile), path.join(HERE, "runtime")).split(path.sep).join("/");
if (!runtimeImport.startsWith(".")) runtimeImport = "./" + runtimeImport;

let src = readFileSync(abs, "utf8");
src = lowerErrors(src);
src = lowerProvide(src);
src = lowerUses(src);
src = lowerCatch(src);
src = lowerTry(src);
src = lowerIfExpr(src);

const header =
  `// Generated from ${path.basename(abs)} by vsc.ts — DO NOT EDIT\n` +
  `import { __VSError, __vsTry, __vsCatch, __vsProvide, __vsUse } from ${JSON.stringify(runtimeImport)};\n\n`;
writeFileSync(outFile, header + src);
console.log(`vsc: ${path.relative(process.cwd(), abs)} -> ${path.relative(process.cwd(), outFile)}`);
