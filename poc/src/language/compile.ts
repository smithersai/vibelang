import { resolve } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { identityFileName } from "../durable/site-id.ts";
import type { Analysis, AnalyzeOptions } from "./model.ts";
import { nativeFileAnalysis, nativeSourceRequest } from "./native-analysis.ts";

export interface CompileOptions extends AnalyzeOptions {
  readonly runtimeImport?: string;
  readonly sourceName?: string;
  readonly sourceMap?: boolean;
  readonly outputFileName?: string;
  readonly preserveVibeLangSpecifiers?: boolean;
}
export interface CompileResult {
  readonly code: string;
  readonly sourceMap?: string;
  readonly analysis: Analysis;
}

/** Native checked lowering to SDK TypeScript. Generated-program checking is a
 * separate native phase exposed by compileAndCheckVibeLang. No legacy fallback. */
export function compileVibeLang(source: string, options: CompileOptions = {}): CompileResult {
  const { request, path } = nativeSourceRequest(source, options);
  for (const key of ["runtimeImport", "sourceName", "outputFileName"] as const) {
    if (options[key] !== undefined && (typeof options[key] !== "string" || !options[key]!.trim() || options[key]!.includes("\0"))) {
      throw new TypeError(`compileVibeLang ${key} must be a non-empty string`);
    }
  }
  for (const key of ["sourceMap", "preserveVibeLangSpecifiers"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new TypeError(`compileVibeLang ${key} must be a boolean`);
  }
  const result = getNativeCompiler().lowerLanguage({
    project: request, runtimeImport: options.runtimeImport ?? "../runtime/index.ts",
    outputs: [{ path, sourceName: options.sourceName ?? (options.fileName === undefined ? "<memory>.vibe" : identityFileName(options.fileName)),
      ...(options.outputFileName === undefined ? {} : { outputFileName: resolve(options.outputFileName) }),
    }],
    ...(options.preserveVibeLangSpecifiers === undefined ? {} : { preserveVibeLangSpecifiers: options.preserveVibeLangSpecifiers }),
  });
  const file = result.analysis.files.find(file => file.path === path);
  if (!file) throw new Error(`native language lowering omitted analysis of ${path}`);
  const analysis = nativeFileAnalysis(file, [...result.analysis.diagnostics, ...result.diagnostics], source);
  const emitted = result.files.find(file => file.path === path);
  return { code: emitted?.text ?? "", analysis,
    ...(options.sourceMap === false || !emitted ? {} : { sourceMap: emitted.sourceMap }),
  };
}
