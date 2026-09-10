import { existsSync, statSync } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { getNativeCompiler } from "../compiler/native.ts";
import type { NativeAnalyzedFile, NativeDiagnostic, NativeLanguageAnalysisRequest } from "../compiler/protocol.ts";
import { MEMORY_SOURCE_NAME } from "../durable/site-id.ts";
import type { Analysis, AnalyzeOptions, Diagnostic, FunctionRows } from "./model.ts";

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** A target selector, not compiler-library or artifact authentication authority. */
export function analysisRuntimeImport(options: {readonly runtimeImport?: string}): string {
  const runtime = options.runtimeImport;
  if (runtime !== undefined && (typeof runtime !== "string" || !runtime.trim() || runtime.includes("\0") || runtime.length > 16*1024)) {
    throw new TypeError("language analysis runtimeImport must be a bounded non-empty string");
  }
  return runtime ?? fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../runtime/index.ts" : "../runtime/index.js", import.meta.url));
}

function sourceLocator(source: string): (offset: number) => { start: number; line: number; column: number } {
  const starts = [0];
  for (let index = 0; index < source.length; index++) {
    const unit = source.charCodeAt(index);
    if (unit === 13) {
      if (source.charCodeAt(index + 1) === 10) index++;
      starts.push(index + 1);
    } else if (unit === 10 || unit === 0x2028 || unit === 0x2029) starts.push(index + 1);
  }
  return offset => {
    const start = Math.max(0, Math.min(source.length, offset));
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = (low + high) >>> 1;
      if (starts[middle]! <= start) low = middle;
      else high = middle;
    }
    return { start, line: low + 1, column: start - starts[low]! + 1 };
  };
}

/** Translate serializable native facts only. No host compiler objects or
 * reimplementation of language checking participate in this view. */
export function nativeFileAnalysis(file: NativeAnalyzedFile, diagnostics: readonly NativeDiagnostic[], source: string): Analysis {
  const rows = new Map<string, FunctionRows>();
  const moduleNames = new Set<string>();
  for (const fn of file.functions) {
    // Public row names historically prefer a module binding to a same-named
    // method or nested helper. Keep every declaration in the function table.
    if (fn.moduleScope || !moduleNames.has(fn.name)) {
      rows.set(fn.name, { failures: fn.failures, requirements: fn.requirements });
      if (fn.moduleScope) moduleNames.add(fn.name);
    }
  }
  const locate = sourceLocator(source);
  const issues: Diagnostic[] = diagnostics.map(issue => {
    const own = issue.file === undefined || issue.file === file.path;
    return {
      code: issue.code,
      severity: issue.category === "error" ? "error" : "warning",
      // A single-source view has no dependency file-name field. Anchor an
      // external finding at the request and retain its real source identity
      // explicitly; never reinterpret its offset as an offset in this source.
      message: own ? issue.message : `[${issue.file}] ${issue.message}`,
      ...locate(own ? issue.span?.start ?? 0 : 0),
    };
  });
  issues.sort((left, right) => left.start - right.start || compare(left.code, right.code) || compare(left.message, right.message));
  return {
    errors: file.errors,
    functions: file.functions.map(({ name, exported, async, channel, explicitReturn, start, end, bodyStart, bodyEnd }) =>
      ({ name, exported, async, channel, explicitReturn, start, end, bodyStart, bodyEnd })),
    rows: Object.fromEntries(rows),
    diagnostics: issues,
  };
}

export function analyzeNativeSource(source: string, options: AnalyzeOptions = {}): Analysis {
  const { request, path } = nativeSourceRequest(source, options);
  const result = getNativeCompiler().analyzeLanguage({...request, sdkRuntimeImport:analysisRuntimeImport(options)});
  const file = result.files.find(file => file.path === path);
  if (!file) throw new Error(`native language analysis omitted ${basename(path)}`);
  return nativeFileAnalysis(file, result.diagnostics, source);
}

/** Shared filesystem addressing for analysis and compilation, not semantics. */
export function nativeSourceRequest(source: string, options: AnalyzeOptions = {}): { readonly request: NativeLanguageAnalysisRequest; readonly path: string } {
  if (typeof source !== "string" || !options || typeof options !== "object" || Array.isArray(options) ||
    (options.fileName !== undefined && (typeof options.fileName !== "string" || !options.fileName.trim())) ||
    (options.rootDir !== undefined && (typeof options.rootDir !== "string" || !options.rootDir.trim()))) {
    throw new TypeError("language analysis requires source text and valid fileName/rootDir options");
  }
  const requested = options.fileName && !options.fileName.startsWith("<") ? options.fileName : MEMORY_SOURCE_NAME;
  const absolute = resolve(options.rootDir ?? process.cwd(), requested);
  const root = resolve(options.rootDir ?? (isAbsolute(requested) ? dirname(absolute) : process.cwd()));
  let path = relative(root, absolute).split(sep).join("/");
  if (!path || path === ".." || path.startsWith("../") || isAbsolute(path)) {
    throw new TypeError("language analysis source must be beneath the resolution root; supply rootDir for parent-directory imports");
  }
  // The API has always accepted diagnostic labels such as example.ts while
  // applying VibeLang semantics. Native source kind remains explicit.
  if (!path.endsWith(".vibe")) path += ".vibe";
  return { path, request: {
    files: [{ path, kind: "vibelang", text: source }],
    ...(existsSync(root) && statSync(root).isDirectory() ? { resolutionRoot: root } : {}),
  } };
}
