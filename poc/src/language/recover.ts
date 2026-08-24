import * as ts from "typescript-js";

// Stock TypeScript does not yet parse declarations in conditions. This small
// pre-parse pass rewrites only that standards-track form into an equivalent
// scoped block while retaining exact authored/derived offset maps.

export interface RecoveryDiagnostic {
  readonly severity: "error";
  readonly code: "SMITHERS1717";
  readonly message: string;
  readonly start: number;
}

export interface VerbatimRun {
  readonly derivedStart: number;
  readonly authoredStart: number;
  readonly length: number;
}

interface GlueRun {
  readonly derivedStart: number;
  readonly length: number;
  readonly anchor: number;
}

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

const MAX_ITERATIONS = 32;
const MAX_CONSTRUCTS = 256;

export interface RecoveryToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

type Token = RecoveryToken;

export function scanTokens(source: string): readonly Token[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  const tokens: Token[] = [];
  const templateBraceDepths: number[] = [];
  let braceDepth = 0;
  let previousKind: ts.SyntaxKind | undefined;
  for (;;) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if ((kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
      regularExpressionAllowed(previousKind)) {
      kind = scanner.reScanSlashToken();
    }
    if (kind === ts.SyntaxKind.CloseBraceToken && templateBraceDepths.length > 0 &&
      braceDepth === templateBraceDepths[templateBraceDepths.length - 1]) {
      kind = scanner.reScanTemplateToken(false);
      if (kind === ts.SyntaxKind.TemplateTail) templateBraceDepths.pop();
    } else if (kind === ts.SyntaxKind.OpenBraceToken) {
      braceDepth += 1;
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      braceDepth -= 1;
    }
    if (kind === ts.SyntaxKind.TemplateHead) templateBraceDepths.push(braceDepth);
    tokens.push({ kind, text: scanner.getTokenText(), start: scanner.getTokenPos(), end: scanner.getTextPos() });
    previousKind = kind;
  }
  return tokens;
}

export function tokenEndsExpression(previous: ts.SyntaxKind | undefined): boolean {
  return previous !== undefined && !regularExpressionAllowed(previous);
}

function regularExpressionAllowed(previous: ts.SyntaxKind | undefined): boolean {
  if (previous === undefined) return true;
  switch (previous) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.PrivateIdentifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.PlusPlusToken:
    case ts.SyntaxKind.MinusMinusToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.SuperKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return false;
    default:
      return true;
  }
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly pieces: readonly EditPiece[];
}

type EditPiece =
  | { readonly kind: "glue"; readonly text: string; readonly anchor: number }
  | { readonly kind: "verbatim"; readonly start: number; readonly end: number };

interface ConditionalRejection {
  readonly start: number;
  readonly message: string;
}

interface ConditionalPlan {
  readonly edits: readonly Edit[];
  readonly rejections: readonly ConditionalRejection[];
  readonly count: number;
}

function matchingGroupEnd(
  tokens: readonly Token[],
  openIndex: number,
  open: ts.SyntaxKind,
  close: ts.SyntaxKind,
): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index++) {
    const kind = tokens[index]!.kind;
    if (kind === open) depth += 1;
    else if (kind === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function scanConditionalHeader(
  tokens: readonly Token[],
  openIndex: number,
): { readonly separators: readonly number[]; readonly closeIndex: number } | undefined {
  let parens = 0;
  let braces = 0;
  const separators: number[] = [];
  for (let index = openIndex; index < tokens.length; index++) {
    const kind = tokens[index]!.kind;
    if (kind === ts.SyntaxKind.OpenParenToken) parens += 1;
    else if (kind === ts.SyntaxKind.CloseParenToken) {
      parens -= 1;
      if (parens === 0) return { separators, closeIndex: index };
    } else if (kind === ts.SyntaxKind.OpenBraceToken) braces += 1;
    else if (kind === ts.SyntaxKind.CloseBraceToken) braces -= 1;
    else if (kind === ts.SyntaxKind.SemicolonToken && parens === 1 && braces === 0) separators.push(index);
  }
  return undefined;
}

function scanIfChainExtent(tokens: readonly Token[], closeIndex: number): number | undefined {
  let index = closeIndex + 1;
  for (;;) {
    if (tokens[index]?.kind !== ts.SyntaxKind.OpenBraceToken) return undefined;
    const branchEnd = matchingGroupEnd(tokens, index, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
    if (branchEnd === undefined) return undefined;
    index = branchEnd + 1;
    if (tokens[index]?.kind !== ts.SyntaxKind.ElseKeyword) return tokens[branchEnd]!.end;
    index += 1;
    if (tokens[index]?.kind !== ts.SyntaxKind.IfKeyword) continue;
    index += 1;
    if (tokens[index]?.kind !== ts.SyntaxKind.OpenParenToken) return undefined;
    const headerEnd = matchingGroupEnd(tokens, index, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
    if (headerEnd === undefined) return undefined;
    index = headerEnd + 1;
  }
}

function planConditionalDeclarations(tokens: readonly Token[]): ConditionalPlan {
  const edits: Edit[] = [];
  const rejections: ConditionalRejection[] = [];
  let count = 0;
  let claimedEnd = -1;
  for (let index = 0; index < tokens.length; index++) {
    const keyword = tokens[index]!;
    if (keyword.kind !== ts.SyntaxKind.IfKeyword) continue;
    const openIndex = index + 1;
    if (tokens[openIndex]?.kind !== ts.SyntaxKind.OpenParenToken) continue;
    const header = scanConditionalHeader(tokens, openIndex);
    if (!header || header.separators.length === 0) continue;
    count += 1;
    const reject = (message: string): void => {
      rejections.push({ start: keyword.start, message });
    };
    if (header.separators.length > 1) {
      reject("a conditional declaration takes exactly one `;` between the declaration and the condition");
      continue;
    }
    const separator = header.separators[0]!;
    const declaration = tokens[openIndex + 1];
    if (declaration?.kind === ts.SyntaxKind.VarKeyword) {
      reject("`var` in a conditional declaration hoists out of the conditional construct; use `const` or `let`");
      continue;
    }
    if (declaration?.kind !== ts.SyntaxKind.ConstKeyword && declaration?.kind !== ts.SyntaxKind.LetKeyword) {
      reject("a declaration in a conditional must begin with `const` or `let`");
      continue;
    }
    if (separator <= openIndex + 1 || separator + 1 >= header.closeIndex) {
      reject("a conditional declaration needs both a declaration and a condition around its `;`");
      continue;
    }
    const end = scanIfChainExtent(tokens, header.closeIndex);
    if (end === undefined) {
      reject("a conditional declaration requires braced branches so the binding scope is provable");
      continue;
    }
    if (keyword.start < claimedEnd) continue;
    claimedEnd = end;
    edits.push({
      start: keyword.start,
      end,
      pieces: [
        { kind: "glue", text: "{ ", anchor: keyword.start },
        { kind: "verbatim", start: tokens[openIndex + 1]!.start, end: tokens[separator]!.end },
        { kind: "glue", text: " if (", anchor: keyword.start },
        { kind: "verbatim", start: tokens[separator + 1]!.start, end },
        { kind: "glue", text: " }", anchor: keyword.start },
      ],
    });
  }
  return { edits, rejections, count };
}

export function recoverSmithersSyntax(authoredSource: string): RecoveredSource {
  let verbatim: VerbatimRun[] = [{ derivedStart: 0, authoredStart: 0, length: authoredSource.length }];
  let glue: GlueRun[] = [];
  let current = authoredSource;
  let currentTokens = scanTokens(current);
  let changed = false;
  const diagnostics: RecoveryDiagnostic[] = [];
  const rejectedAuthored: number[] = [];

  const exactAt = (runs: readonly VerbatimRun[], offset: number): number | undefined => {
    for (const run of runs) {
      if (offset >= run.derivedStart && offset < run.derivedStart + run.length) {
        return run.authoredStart + (offset - run.derivedStart);
      }
    }
    return undefined;
  };
  const anchorAt = (offset: number): number => {
    const exact = exactAt(verbatim, offset);
    if (exact !== undefined) return exact;
    for (const run of glue) {
      if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.anchor;
    }
    return 0;
  };

  for (let round = 0; ; round++) {
    const plan = planConditionalDeclarations(currentTokens);
    if (round >= MAX_ITERATIONS || plan.count > MAX_CONSTRUCTS) {
      diagnostics.push({
        severity: "error",
        code: "SMITHERS1717",
        message: "conditional-declaration recovery exceeded its checked construct or iteration bound",
        start: 0,
      });
      return identityRecovery(authoredSource, diagnostics);
    }
    if (plan.edits.length === 0) {
      for (const rejection of plan.rejections) {
        const start = anchorAt(rejection.start);
        rejectedAuthored.push(start);
        diagnostics.push({ severity: "error", code: "SMITHERS1717", message: rejection.message, start });
      }
      break;
    }
    const applied = applyEdits(current, plan.edits, verbatim, glue);
    current = applied.source;
    verbatim = applied.verbatim;
    glue = applied.glue;
    currentTokens = scanTokens(current);
    changed = true;
  }

  const derivedIndex = [...verbatim].sort((left, right) => left.derivedStart - right.derivedStart);
  const authoredIndex = [...verbatim].sort((left, right) => left.authoredStart - right.authoredStart);
  const rejectedStarts = new Set<number>();
  for (const authored of rejectedAuthored) {
    for (const run of authoredIndex) {
      if (authored >= run.authoredStart && authored < run.authoredStart + run.length) {
        rejectedStarts.add(run.derivedStart + (authored - run.authoredStart));
        break;
      }
    }
  }
  const finalGlue = glue;
  return {
    authoredSource,
    parseSource: current,
    changed,
    diagnostics,
    rejectedStarts,
    verbatim: derivedIndex,
    toAuthored: (offset) => exactAt(derivedIndex, offset),
    toAuthoredAnchor: (offset) => {
      const exact = exactAt(derivedIndex, offset);
      if (exact !== undefined) return exact;
      for (const run of finalGlue) {
        if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.anchor;
      }
      for (let index = derivedIndex.length - 1; index >= 0; index--) {
        const run = derivedIndex[index]!;
        if (run.derivedStart <= offset) {
          return run.authoredStart + Math.min(offset - run.derivedStart, Math.max(0, run.length - 1));
        }
      }
      return 0;
    },
    toDerived: (offset) => {
      for (const run of authoredIndex) {
        if (offset >= run.authoredStart && offset < run.authoredStart + run.length) {
          return run.derivedStart + (offset - run.authoredStart);
        }
      }
      return undefined;
    },
  };
}

function identityRecovery(source: string, diagnostics: readonly RecoveryDiagnostic[]): RecoveredSource {
  const runs: VerbatimRun[] = [{ derivedStart: 0, authoredStart: 0, length: source.length }];
  return {
    authoredSource: source,
    parseSource: source,
    changed: false,
    diagnostics,
    rejectedStarts: new Set(),
    verbatim: runs,
    toAuthored: (offset) => (offset >= 0 && offset <= source.length ? offset : undefined),
    toAuthoredAnchor: (offset) => Math.max(0, Math.min(offset, source.length)),
    toDerived: (offset) => (offset >= 0 && offset <= source.length ? offset : undefined),
  };
}

function applyEdits(
  source: string,
  edits: readonly Edit[],
  previousVerbatim: readonly VerbatimRun[],
  previousGlue: readonly GlueRun[],
): { source: string; verbatim: VerbatimRun[]; glue: GlueRun[] } {
  const anchorThroughPrevious = (offset: number): number => {
    for (const run of previousVerbatim) {
      if (offset >= run.derivedStart && offset < run.derivedStart + run.length) {
        return run.authoredStart + (offset - run.derivedStart);
      }
    }
    for (const run of previousGlue) {
      if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.anchor;
    }
    return 0;
  };
  const output: string[] = [];
  const verbatim: VerbatimRun[] = [];
  const glue: GlueRun[] = [];
  let produced = 0;
  const emitVerbatimSlice = (start: number, end: number): void => {
    let cursor = start;
    while (cursor < end) {
      const run = previousVerbatim.find((candidate) =>
        cursor >= candidate.derivedStart && cursor < candidate.derivedStart + candidate.length);
      if (run) {
        const upper = Math.min(end, run.derivedStart + run.length);
        verbatim.push({
          derivedStart: produced,
          authoredStart: run.authoredStart + (cursor - run.derivedStart),
          length: upper - cursor,
        });
        output.push(source.slice(cursor, upper));
        produced += upper - cursor;
        cursor = upper;
        continue;
      }
      const glueRun = previousGlue.find((candidate) =>
        cursor >= candidate.derivedStart && cursor < candidate.derivedStart + candidate.length);
      const upper = glueRun ? Math.min(end, glueRun.derivedStart + glueRun.length) : end;
      glue.push({ derivedStart: produced, length: upper - cursor, anchor: glueRun?.anchor ?? 0 });
      output.push(source.slice(cursor, upper));
      produced += upper - cursor;
      cursor = upper;
    }
  };
  const emitGlue = (text: string, currentAnchor: number): void => {
    if (text.length === 0) return;
    glue.push({ derivedStart: produced, length: text.length, anchor: anchorThroughPrevious(currentAnchor) });
    output.push(text);
    produced += text.length;
  };
  let cursor = 0;
  for (const edit of edits) {
    if (edit.start > cursor) emitVerbatimSlice(cursor, edit.start);
    for (const piece of edit.pieces) {
      if (piece.kind === "verbatim") emitVerbatimSlice(piece.start, piece.end);
      else emitGlue(piece.text, piece.anchor);
    }
    cursor = edit.end;
  }
  if (cursor < source.length) emitVerbatimSlice(cursor, source.length);
  return { source: output.join(""), verbatim, glue };
}
