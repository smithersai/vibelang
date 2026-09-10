import { getNativeCompiler } from "../compiler/native.ts";
import type { NativeSourceRecoveryResult } from "../compiler/protocol.ts";

/** Native scanner/recovery facts; no legacy parser or numeric SyntaxKind ABI. */
export type RecoveryDiagnostic = NativeSourceRecoveryResult["diagnostics"][number];
export type VerbatimRun = NativeSourceRecoveryResult["verbatim"][number];
export type RecoveryToken = NativeSourceRecoveryResult["tokens"][number];

export interface RecoveredSource {
  readonly authoredSource: string;
  readonly parseSource: string;
  readonly changed: boolean;
  readonly diagnostics: readonly RecoveryDiagnostic[];
  readonly rejectedStarts: ReadonlySet<number>;
  readonly verbatim: readonly VerbatimRun[];
  toAuthored(derivedOffset: number): number | undefined;
  toAuthoredAnchor(derivedOffset: number): number;
  toDerived(authoredOffset: number): number | undefined;
}

// Pure facts can be reused between project recovery and its subsequent grammar
// sweep. Bound source AND token storage; a single large input is not cached.
const cache = new Map<string, { result: NativeSourceRecoveryResult; bytes: number }>();
let cachedBytes = 0;
let compilerIdentity = "";
function nativeFacts(source: string): NativeSourceRecoveryResult {
  const compiler = getNativeCompiler();
  const identity = compiler.identity.sha256 + compiler.transportDigest;
  if (identity !== compilerIdentity) {
    cache.clear(); cachedBytes = 0; compilerIdentity = identity;
  }
  const previous = cache.get(source);
  if (previous) { cache.delete(source); cache.set(source, previous); return previous.result; }
  const result = compiler.recoverSource(source);
  for (const items of [result.tokens, result.verbatim, result.glue, result.diagnostics]) {
    for (const item of items) Object.freeze(item);
    Object.freeze(items);
  }
  Object.freeze(result.rejectedStarts); Object.freeze(result);
  const bytes = 2 * (source.length + result.code.length) + result.tokens.reduce((sum, token) => sum + 128 + 2 * token.text.length, 0) +
    (result.verbatim.length + result.glue.length + result.diagnostics.length) * 128;
  if (bytes <= 16 * 1024 * 1024) {
    while (cache.size >= 64 || cachedBytes + bytes > 16 * 1024 * 1024) {
      const key = cache.keys().next().value!;
      cachedBytes -= cache.get(key)!.bytes; cache.delete(key);
    }
    cache.set(source, { result, bytes }); cachedBytes += bytes;
  }
  return result;
}

export function scanTokens(source: string): readonly RecoveryToken[] { return nativeFacts(source).tokens; }
export function tokenEndsExpression(previous: { readonly endsExpression: boolean } | undefined): boolean {
  return previous?.endsExpression ?? false;
}

export function recoverVibeLangSyntax(authoredSource: string): RecoveredSource {
  const facts = nativeFacts(authoredSource);
  const derived = facts.verbatim;
  const authored = [...derived].sort((left, right) => left.authoredStart - right.authoredStart);
  const exact = (offset: number): number | undefined => {
    if (facts.identityFallback) return offset >= 0 && offset <= authoredSource.length ? offset : undefined;
    for (const run of derived) {
      if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.authoredStart + offset - run.derivedStart;
    }
    return undefined;
  };
  return Object.freeze({
    authoredSource, parseSource: facts.code, changed: facts.changed,
    diagnostics: facts.diagnostics, rejectedStarts: new Set(facts.rejectedStarts),
    verbatim: derived, toAuthored: exact,
    toAuthoredAnchor: (offset: number): number => {
      if (facts.identityFallback) return Math.max(0, Math.min(offset, authoredSource.length));
      const mapped = exact(offset);
      if (mapped !== undefined) return mapped;
      for (const run of facts.glue) {
        if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.anchor;
      }
      for (let index = derived.length - 1; index >= 0; index--) {
        const run = derived[index]!;
        if (run.derivedStart <= offset) return run.authoredStart + Math.min(offset - run.derivedStart, Math.max(0, run.length - 1));
      }
      return 0;
    },
    toDerived: (offset: number): number | undefined => {
      if (facts.identityFallback) return offset >= 0 && offset <= authoredSource.length ? offset : undefined;
      for (const run of authored) {
        if (offset >= run.authoredStart && offset < run.authoredStart + run.length) return run.derivedStart + offset - run.authoredStart;
      }
      return undefined;
    },
  });
}
