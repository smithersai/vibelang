import { resolve } from "node:path";
import { getNativeCompiler } from "../compiler/native.ts";
import { nativeDeclarationOutputName, type NativeDeclarationRows } from "../compiler/protocol.ts";
import type { FunctionRows } from "./model.ts";
import { withGeneratedPositions, type EmittedDiagnostic, type EmittedModuleResolutionOptions } from "./generated-check.ts";

export { DECLARATION_EFFECT_TAG, DECLARATION_EFFECT_VERSION } from "./model.ts";

export interface DeclarationSource {
  readonly fileName: string;
  readonly code: string;
  /** Compiler-inferred rows to preserve for exported callable declarations. */
  readonly effects?: Readonly<Record<string, FunctionRows>>;
  /** Exact runtime seam emitted by the compiler; otherwise read from its header. */
  readonly runtimeModule?: string;
}
export interface DeclarationOutput {
  readonly fileName: string;
  readonly code: string;
}
export interface DeclarationEmitResult {
  readonly outputs: readonly DeclarationOutput[];
  readonly diagnostics: readonly EmittedDiagnostic[];
  readonly ok: boolean;
}

const absolute = (name: string): string => resolve(name).replaceAll("\\", "/");
function snapshotEffects(effects: Readonly<Record<string, FunctionRows>>): Readonly<Record<string, NativeDeclarationRows>> {
  return Object.fromEntries(Object.entries(effects).map(([name, row]) => [name, {
    failures: [...row.failures], requirements: [...row.requirements],
  }]));
}

/** Normalize only compiler-owned split return channels using native parsed provenance. */
export function normalizeDeclarationEffectChannels(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
  runtimeModules?: string | readonly string[],
): string {
  return getNativeCompiler().declarationText({ operation: "normalize", path: absolute(fileName), text: code,
    effects: snapshotEffects(effects), runtimes: runtimeModules === undefined ? [] : typeof runtimeModules === "string" ? [runtimeModules] : [...runtimeModules],
  }).text;
}

/** Publish canonical row/module metadata without changing the callable's TS type. */
export function annotateDeclarationEffects(
  code: string,
  effects: Readonly<Record<string, FunctionRows>>,
  fileName = "module.d.mts",
  runtimes: readonly string[] = [],
): string {
  return getNativeCompiler().declarationText({ operation: "annotate", path: absolute(fileName), text: code,
    effects: snapshotEffects(effects), runtimes: [...runtimes],
  }).text;
}

/** Historical rows may be inspected; inspection never grants a calling-convention ABI. */
export function readDeclarationEffects(code: string, fileName = "module.d.mts"): Readonly<Record<string, FunctionRows>> {
  const result = getNativeCompiler().declarationText({ operation: "read", path: absolute(fileName), text: code });
  const rows: Record<string, FunctionRows> = Object.create(null);
  for (const [name, row] of Object.entries(result.effects)) rows[name] = Object.freeze({
    failures: Object.freeze([...row.failures]), requirements: Object.freeze([...row.requirements]),
  });
  return Object.freeze(rows);
}

/**
 * Native declaration serialization for already-lowered modules. The Go checker
 * carries nested callable/accessor contracts onto the stock declaration tree.
 * Inputs/outputs stay in memory; dependency reads are explicit and bounded.
 */
export function emitProjectDeclarations(
  sources: readonly DeclarationSource[],
  resolution?: EmittedModuleResolutionOptions,
): DeclarationEmitResult {
  const roots = sources.map(source => {
    const path = absolute(source.fileName), text = source.code;
    const row = source.effects, runtimeModule = source.runtimeModule;
    return { path, text, metadata: {
      ...(row === undefined ? {} : { effects: snapshotEffects(row) }),
      ...(runtimeModule === undefined ? {} : { runtimeModule }),
    } };
  });
  const texts = new Map(roots.map(file => [file.path, file.text]));
  if (texts.size !== roots.length) throw new TypeError("duplicate declaration source");
  if (new Set(roots.map(file => nativeDeclarationOutputName(file.path))).size !== roots.length) throw new TypeError("duplicate declaration output");
  const overrides = resolution?.moduleOverrides;
  const result = getNativeCompiler().emitGeneratedDeclarations({
    project: {
      files: roots.map(({ path, text }) => ({ path, text })),
      currentDirectory: absolute(process.cwd()), diskDependencies: true,
      ...(overrides === undefined ? {} : { moduleOverrides: Object.fromEntries(Object.entries(overrides).map(([name, target]) => [name, absolute(target)])) }),
    },
    metadata: Object.fromEntries(roots.map(file => [file.path, file.metadata])),
  });
  return { ok: result.ok, outputs: result.outputs.map(file => ({ fileName: file.path, code: file.text })),
    diagnostics: withGeneratedPositions(result.diagnostics, texts),
  };
}
