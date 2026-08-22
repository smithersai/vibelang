import * as ts from "typescript-js";
import { internalParseDiagnostics } from "./semantic.ts";

/**
 * Deterministic `.vibe` source formatter.
 *
 * Printer choice, and why neither obvious option was taken:
 *
 * - `ts.createPrinter()` is an *emit* writer. It rebuilds text from an AST, so
 *   it relocates or drops comments, renormalizes literals, and cannot be shown
 *   to preserve the authored program. A formatter whose correctness argument is
 *   "the printer probably kept everything" is not one this project can ship.
 * - A hand-written printer would have to re-derive TypeScript's entire spacing
 *   grammar (type arguments versus `<`, arrow bodies, decorators, optional
 *   chains, JSX) before it could format the ordinary TypeScript that makes up
 *   most of a `.vibe` module.
 *
 * This formatter instead drives the TypeScript *language service* formatter
 * (`getFormattingEditsForDocument`), which is whitespace-only by construction:
 * it never adds, removes, or rewrites a token. That property is exactly the
 * semantic-preservation guarantee the toolchain needs, and it is enforced here
 * rather than assumed. Every result must pass `roundTripRefusal` before it is
 * returned: an identical token and comment stream, an identical VibeLang mask
 * plan and parsed AST structure, and unmoved line breaks on every line a mask
 * touches. Anything else is reported as `VIBE1902` and left byte-identical.
 *
 * Stock TypeScript cannot parse several VibeLang forms, so the source is first
 * rewritten into a **length-preserving mask**: each divergent spelling is
 * replaced by parseable text of exactly the same length, with newline positions
 * untouched. Because the mask preserves every offset, formatting edits computed
 * on the masked text apply directly to the authored text; edits that touch a
 * masked span are dropped, so the authored VibeLang spelling survives verbatim
 * in its formatted position.
 *
 * | authored                         | masked                        |
 * | -------------------------------- | ----------------------------- |
 * | `defer cleanup()`                | `defer;cleanup()`             |
 * | `break :done value`              | `break ;done,value`           |
 * | `} else -1` (loop completion)    | `} void -1`                   |
 * | `if (const u = f(); u !== null)` | `if ($c0           , u !== null)` |
 * | `return switch (x) { ... }`      | `rtn__: switch (x) { ... }`   |
 * | `const v = if (c) { ... }`       | `const v ; if (c) { ... }`    |
 * | `f(a, if (c) { 1 } else { 2 })`  | `f(a, $v0                  )` |
 *
 * The first six masks keep the construct body an ordinary statement, so the
 * language service formats the interior natively. Only value constructs in
 * general expression positions are masked opaquely; their interiors are then
 * formatted by recursion and re-indented into place.
 *
 * Everything is fail-closed: a module whose mask does not parse, or whose
 * formatted result would not round-trip its token stream, is reported and left
 * byte-identical.
 */

/** Hard ceiling on a single formatted module. */
const MAX_FORMAT_BYTES = 4 * 1024 * 1024;
/** Hard ceiling on masked constructs in one module. */
const MAX_MASKS = 1024;
/** Recursion bound for general-placement value constructs. */
const MAX_REGION_DEPTH = 8;

export type FormatDiagnosticCode =
  /** The source exceeds a formatter budget. */
  | "VIBE1900"
  /** The source does not parse after VibeLang masking; nothing is rewritten. */
  | "VIBE1901"
  /** The formatted result would not round-trip the authored token stream. */
  | "VIBE1902"
  /** The internal parser-diagnostics field is absent, so acceptance is unprovable. */
  | "VIBE1002";

export interface FormatDiagnostic {
  readonly severity: "error";
  readonly code: FormatDiagnosticCode;
  readonly message: string;
  /** UTF-16 offset in the authored source. */
  readonly start: number;
  /** 1-based. */
  readonly line: number;
  /** 1-based. */
  readonly column: number;
}

export interface FormatOptions {
  /** Reported in diagnostics; also selects the script kind. Defaults to `input.vibe`. */
  readonly fileName?: string;
  /** Spaces per indentation level. Defaults to 2. */
  readonly indentSize?: number;
  /** Newline used for inserted line breaks. Defaults to the source's own convention. */
  readonly newLine?: "\n" | "\r\n";
}

export interface FormatResult {
  /** False when the module was left byte-identical because it could not be formatted soundly. */
  readonly ok: boolean;
  /** The formatted module, or the authored source unchanged when `ok` is false. */
  readonly code: string;
  /** True when `code` differs from the authored source. */
  readonly changed: boolean;
  readonly diagnostics: readonly FormatDiagnostic[];
}

/* -------------------------------------------------------------------------- */
/* Scanning                                                                    */
/* -------------------------------------------------------------------------- */

interface ScannedToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

const TRIVIA_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
  ts.SyntaxKind.SingleLineCommentTrivia,
  ts.SyntaxKind.MultiLineCommentTrivia,
  ts.SyntaxKind.ShebangTrivia,
  ts.SyntaxKind.ConflictMarkerTrivia,
]);

const WHITESPACE_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.WhitespaceTrivia,
  ts.SyntaxKind.NewLineTrivia,
]);

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

/**
 * Template- and regex-aware scan that retains trivia. This mirrors the frontend
 * recovery scanner's biases so a wrong guess swallows tokens instead of
 * exposing string or regex content as ordinary tokens; retaining comments and
 * whitespace is what makes the round-trip gate able to prove that a formatted
 * module still contains exactly the authored tokens and comments.
 */
function scanAllTokens(source: string): readonly ScannedToken[] {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
  const tokens: ScannedToken[] = [];
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
    tokens.push({
      kind,
      text: scanner.getTokenText(),
      start: scanner.getTokenPos(),
      end: scanner.getTextPos(),
    });
    if (!WHITESPACE_KINDS.has(kind)) previousKind = kind;
  }
  return tokens;
}

/** Tokens and comments, whitespace removed. */
function significantTokens(all: readonly ScannedToken[]): readonly ScannedToken[] {
  return all.filter((token) => !WHITESPACE_KINDS.has(token.kind));
}

/** Tokens only: comments and whitespace removed. */
function codeTokens(all: readonly ScannedToken[]): readonly ScannedToken[] {
  return all.filter((token) => !TRIVIA_KINDS.has(token.kind));
}

/* -------------------------------------------------------------------------- */
/* Round-trip gate                                                             */
/* -------------------------------------------------------------------------- */

interface StreamEntry {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly lineBreakBefore: boolean;
  /** Offset of the entry in the text it was scanned from. */
  readonly start: number;
}

const LINE_BREAK = /[\n\r\u2028\u2029]/u;

/**
 * Every token and comment of a module, in order, with the line-break structure
 * between neighbours. Preserving the kinds and texts of this stream proves that
 * no token or comment was added, removed, or rewritten, so no string, template,
 * regular expression, or comment can have been reflowed.
 */
function roundTripStream(source: string): readonly StreamEntry[] {
  const all = scanAllTokens(source);
  const entries: StreamEntry[] = [];
  let previousEnd = 0;
  for (const token of significantTokens(all)) {
    entries.push({
      kind: token.kind,
      text: token.text,
      lineBreakBefore: LINE_BREAK.test(source.slice(previousEnd, token.start)),
      start: token.start,
    });
    previousEnd = token.end;
  }
  return entries;
}

/** Index of the first entry whose kind or text diverges, or -1. */
function firstTokenDivergence(left: readonly StreamEntry[], right: readonly StreamEntry[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index]!.kind !== right[index]!.kind || left[index]!.text !== right[index]!.text) return index;
  }
  return left.length === right.length ? -1 : shared;
}

function lineNumberIndex(source: string): (offset: number) => number {
  const starts: number[] = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (LINE_BREAK.test(source[index]!)) {
      if (source[index] === "\r" && source[index + 1] === "\n") index += 1;
      starts.push(index + 1);
    }
  }
  return (offset) => {
    let low = 0;
    let high = starts.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (starts[middle]! <= offset) low = middle;
      else high = middle - 1;
    }
    return low;
  };
}

/**
 * Structural signature of a parsed module: node kinds in pre-order with close
 * markers. Two masked sources with equal signatures have the same statement and
 * expression structure, which is what proves no automatic semicolon moved and
 * no restricted production (`return`, `throw`, postfix `++`) changed meaning.
 * That is strictly what matters, so the language service stays free to join a
 * brace onto its header line or break a multi-line object literal open.
 */
function structuralSignature(file: ts.SourceFile): readonly number[] {
  const signature: number[] = [];
  const walk = (node: ts.Node): void => {
    signature.push(node.kind);
    ts.forEachChild(node, walk);
    signature.push(-1);
  };
  ts.forEachChild(file, walk);
  return signature;
}

function signaturesMatch(left: readonly number[], right: readonly number[]): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

/* -------------------------------------------------------------------------- */
/* Masks                                                                       */
/* -------------------------------------------------------------------------- */

type MaskKind =
  | "defer"
  | "break-value"
  | "loop-else"
  | "conditional-declaration"
  | "value-initializer"
  | "value-return"
  | "value-region";

interface Mask {
  readonly kind: MaskKind;
  /** Replaced span, in authored coordinates. */
  readonly start: number;
  readonly end: number;
  /** Same length as `[start, end)`, with newline characters at the same offsets. */
  readonly text: string;
  /** Span no formatting edit may touch. A superset of `[start, end)`. */
  readonly protectStart: number;
  readonly protectEnd: number;
}

const EXPRESSION_HEAD_KEYWORDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.ClassKeyword,
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.DeleteKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.FunctionKeyword,
  ts.SyntaxKind.ImportKeyword,
  ts.SyntaxKind.LetKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.SuperKeyword,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VarKeyword,
  ts.SyntaxKind.VoidKeyword,
  ts.SyntaxKind.YieldKeyword,
]);

const EXPRESSION_HEAD_LITERALS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.RegularExpressionLiteral,
]);

/**
 * Word spellings that never begin an expression. TypeScript scans many
 * identifier-shaped words as contextual keywords (`defer` itself became one in
 * TypeScript 5.9), so identifier recognition here is by spelling plus this
 * exclusion set rather than by `SyntaxKind.Identifier` alone.
 */
const NON_EXPRESSION_WORDS: ReadonlySet<string> = new Set([
  "as", "asserts", "break", "case", "catch", "continue", "default", "do", "else", "enum",
  "export", "extends", "finally", "for", "if", "in", "infer", "instanceof", "is", "keyof",
  "of", "out", "readonly", "return", "satisfies", "switch", "throw", "try", "while", "with",
]);

const IDENTIFIER_WORD = /^[A-Za-z_$][A-Za-z0-9_$]*$/u;

/** True for a token whose spelling can be used as an ordinary identifier. */
function isIdentifierLike(token: ScannedToken | undefined): boolean {
  if (!token) return false;
  if (!IDENTIFIER_WORD.test(token.text)) return false;
  return token.kind === ts.SyntaxKind.Identifier ||
    (token.kind >= ts.SyntaxKind.FirstKeyword && token.kind <= ts.SyntaxKind.LastKeyword);
}

/** A cleanup expression can follow a `defer`/`errdefer` marker only if it starts here. */
function startsExpression(token: ScannedToken | undefined): boolean {
  if (!token) return false;
  if (EXPRESSION_HEAD_LITERALS.has(token.kind) || EXPRESSION_HEAD_KEYWORDS.has(token.kind)) return true;
  return isIdentifierLike(token) && !NON_EXPRESSION_WORDS.has(token.text);
}

/** A `defer`/`errdefer` cleanup marker, whatever kind the scanner gave it. */
function isDeferMarkerWord(token: ScannedToken): boolean {
  return (token.text === "defer" || token.text === "errdefer") && isIdentifierLike(token);
}

/** Token kinds after which `if`/`switch`/`label:` can only be a value expression. */
const VALUE_CONSTRUCT_PREVIOUS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.DotDotDotToken,
  ts.SyntaxKind.QuestionToken,
  ts.SyntaxKind.ExclamationToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
  ts.SyntaxKind.SlashToken,
  ts.SyntaxKind.PercentToken,
  ts.SyntaxKind.LessThanToken,
  ts.SyntaxKind.GreaterThanToken,
  ts.SyntaxKind.LessThanEqualsToken,
  ts.SyntaxKind.GreaterThanEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.AmpersandToken,
  ts.SyntaxKind.BarToken,
  ts.SyntaxKind.CaretToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AwaitKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.VoidKeyword,
]);

function isObjectPropertyColon(tokens: readonly ScannedToken[], colonIndex: number): boolean {
  const key = tokens[colonIndex - 1];
  const before = tokens[colonIndex - 2];
  if (!key || !before) return false;
  const keyIsName = isIdentifierLike(key) ||
    key.kind === ts.SyntaxKind.StringLiteral || key.kind === ts.SyntaxKind.NumericLiteral;
  return keyIsName &&
    (before.kind === ts.SyntaxKind.OpenBraceToken || before.kind === ts.SyntaxKind.CommaToken);
}

/** Index of the token closing the group opened at `openIndex`, or -1. */
function matchingClose(
  tokens: readonly ScannedToken[],
  openIndex: number,
  open: ts.SyntaxKind,
  close: ts.SyntaxKind,
): number {
  if (tokens[openIndex]?.kind !== open) return -1;
  let depth = 0;
  for (let index = openIndex; index < tokens.length; index += 1) {
    const kind = tokens[index]!.kind;
    if (kind === open) depth += 1;
    else if (kind === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/** Last token index of `if (...) { ... } [else { ... } | else if ...]`, or -1. */
function valueIfExtent(tokens: readonly ScannedToken[], index: number): number {
  const openParen = index + 1;
  const closeParen = matchingClose(tokens, openParen, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
  if (closeParen < 0) return -1;
  const closeBrace = matchingClose(tokens, closeParen + 1, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
  if (closeBrace < 0) return -1;
  if (tokens[closeBrace + 1]?.kind !== ts.SyntaxKind.ElseKeyword) return closeBrace;
  const afterElse = closeBrace + 2;
  if (tokens[afterElse]?.kind === ts.SyntaxKind.IfKeyword) return valueIfExtent(tokens, afterElse);
  return matchingClose(tokens, afterElse, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
}

/** Last token index of `switch (...) { ... }`, or -1. */
function valueSwitchExtent(tokens: readonly ScannedToken[], index: number): number {
  const closeParen = matchingClose(tokens, index + 1, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
  if (closeParen < 0) return -1;
  return matchingClose(tokens, closeParen + 1, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
}

/** Last token index of `label: { ... }`, or -1. Loop values are not extent-scanned. */
function labeledBlockExtent(tokens: readonly ScannedToken[], index: number): number {
  if (!isIdentifierLike(tokens[index])) return -1;
  if (tokens[index + 1]?.kind !== ts.SyntaxKind.ColonToken) return -1;
  return matchingClose(tokens, index + 2, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
}

function isLabeledLoopHead(tokens: readonly ScannedToken[], index: number): boolean {
  if (!isIdentifierLike(tokens[index])) return false;
  if (tokens[index + 1]?.kind !== ts.SyntaxKind.ColonToken) return false;
  const keyword = tokens[index + 2]?.kind;
  return keyword === ts.SyntaxKind.ForKeyword || keyword === ts.SyntaxKind.WhileKeyword;
}

/** Same-length filler that keeps every newline at its authored offset. */
function fillerFor(text: string, head: string): string | undefined {
  if (text.length < head.length) return undefined;
  for (let index = 0; index < head.length; index += 1) {
    if (LINE_BREAK.test(text[index]!)) return undefined;
  }
  let filler = head;
  for (let index = head.length; index < text.length; index += 1) {
    const character = text[index]!;
    filler += LINE_BREAK.test(character) ? character : " ";
  }
  return filler;
}

function isSpaceOrTab(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

/** Grow a protected span across the horizontal whitespace next to it. */
function protectAdjacentSpaces(source: string, start: number, end: number): { start: number; end: number } {
  let protectStart = start;
  let protectEnd = end;
  while (protectStart > 0 && isSpaceOrTab(source[protectStart - 1])) protectStart -= 1;
  while (protectEnd < source.length && isSpaceOrTab(source[protectEnd])) protectEnd += 1;
  return { start: protectStart, end: protectEnd };
}

interface MaskPlan {
  readonly masks: readonly Mask[];
  /** Authored spans whose interiors are formatted by recursion. */
  readonly regions: readonly { readonly start: number; readonly end: number }[];
}

function planMasks(source: string, tokens: readonly ScannedToken[]): MaskPlan {
  const masks: Mask[] = [];
  const regions: { start: number; end: number }[] = [];
  let regionCount = 0;

  const pushRegion = (startToken: number, endToken: number): boolean => {
    const start = tokens[startToken]!.start;
    const end = tokens[endToken]!.end;
    const filler = fillerFor(source.slice(start, end), `$v${regionCount}`);
    if (filler === undefined) return false;
    regionCount += 1;
    masks.push({ kind: "value-region", start, end, text: filler, protectStart: start, protectEnd: end });
    regions.push({ start, end });
    return true;
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];

    // `defer expression` / `errdefer expression` -> `defer;expression`
    if (isDeferMarkerWord(token) &&
      next !== undefined && startsExpression(next) &&
      isSpaceOrTab(source[token.end]) &&
      !LINE_BREAK.test(source.slice(token.end, next.start))) {
      masks.push({
        kind: "defer",
        start: token.end,
        end: token.end + 1,
        text: ";",
        protectStart: token.end,
        protectEnd: token.end + 1,
      });
      continue;
    }

    // `break :label value` -> `break ;label,value`
    if (token.kind === ts.SyntaxKind.BreakKeyword &&
      next?.kind === ts.SyntaxKind.ColonToken &&
      isIdentifierLike(tokens[index + 2])) {
      const label = tokens[index + 2]!;
      const value = tokens[index + 3];
      if (value && startsExpression(value) && isSpaceOrTab(source[label.end]) &&
        !LINE_BREAK.test(source.slice(label.end, value.start))) {
        const colonProtection = protectAdjacentSpaces(source, next.start, next.end);
        masks.push({
          kind: "break-value",
          start: next.start,
          end: next.end,
          text: ";",
          protectStart: colonProtection.start,
          protectEnd: next.end,
        });
        masks.push({
          kind: "break-value",
          start: label.end,
          end: label.end + 1,
          text: ",",
          protectStart: label.end,
          protectEnd: label.end + 1,
        });
        index += 2;
        continue;
      }
    }

    // `label: for (...) { ... } else value` -> `... void value`
    if (isLabeledLoopHead(tokens, index) && !labelIsIfBody(tokens, index)) {
      const closeParen = matchingClose(
        tokens, index + 3, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
      const closeBrace = closeParen < 0
        ? -1
        : matchingClose(tokens, closeParen + 1, ts.SyntaxKind.OpenBraceToken, ts.SyntaxKind.CloseBraceToken);
      const elseToken = closeBrace < 0 ? undefined : tokens[closeBrace + 1];
      if (elseToken?.kind === ts.SyntaxKind.ElseKeyword) {
        masks.push({
          kind: "loop-else",
          start: elseToken.start,
          end: elseToken.end,
          text: "void",
          protectStart: elseToken.start,
          protectEnd: elseToken.end,
        });
      }
    }

    // `if (const x = e; cond)` -> `if ($c0        , cond)`
    if (token.kind === ts.SyntaxKind.IfKeyword && next?.kind === ts.SyntaxKind.OpenParenToken) {
      const header = conditionalDeclarationHeader(tokens, index);
      if (header) {
        const start = tokens[header.declarationStart]!.start;
        const end = tokens[header.semicolon]!.end;
        const filler = fillerFor(source.slice(start, end - 1), `$c${masks.length}`);
        if (filler !== undefined) {
          masks.push({
            kind: "conditional-declaration",
            start,
            end,
            text: `${filler},`,
            protectStart: start,
            protectEnd: end,
          });
          // The declaration is an ordinary statement in isolation, so its own
          // interior is formatted by recursion rather than left as authored.
          regions.push({ start, end });
        }
      }
    }

    const construct = valueConstructAt(tokens, index);
    if (!construct) continue;

    const previous = tokens[index - 1];
    // `const x = <value construct>` / `x = <value construct>` -> `const x ; <statement>`
    if (previous?.kind === ts.SyntaxKind.EqualsToken) {
      const protection = protectAdjacentSpaces(source, previous.start, previous.end);
      masks.push({
        kind: "value-initializer",
        start: previous.start,
        end: previous.end,
        text: ";",
        protectStart: protection.start,
        protectEnd: protection.end,
      });
      continue;
    }
    // `return <value construct>` -> `rtn__: <statement>`
    if (previous?.kind === ts.SyntaxKind.ReturnKeyword &&
      !LINE_BREAK.test(source.slice(previous.end, token.start))) {
      masks.push({
        kind: "value-return",
        start: previous.start,
        end: previous.end,
        text: "rtn__:",
        protectStart: previous.start,
        protectEnd: previous.end,
      });
      continue;
    }
    if (previous?.kind === ts.SyntaxKind.ThrowKeyword &&
      !LINE_BREAK.test(source.slice(previous.end, token.start))) {
      masks.push({
        kind: "value-return",
        start: previous.start,
        end: previous.end,
        text: "thr__:",
        protectStart: previous.start,
        protectEnd: previous.end,
      });
      continue;
    }
    // Every other placement is masked opaquely and formatted by recursion.
    if (construct.extent >= 0 && isValuePlacement(tokens, index)) {
      if (!pushRegion(index, construct.extent)) continue;
      index = construct.extent;
    }
  }

  const ordered = [...masks].sort((left, right) => left.start - right.start);
  return { masks: ordered, regions };
}

/** True when a labeled statement is the direct body of an `if`, where `else` is ordinary TypeScript. */
function labelIsIfBody(tokens: readonly ScannedToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (!previous) return false;
  if (previous.kind === ts.SyntaxKind.ElseKeyword) return true;
  if (previous.kind !== ts.SyntaxKind.CloseParenToken) return false;
  let depth = 0;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const kind = tokens[cursor]!.kind;
    if (kind === ts.SyntaxKind.CloseParenToken) depth += 1;
    else if (kind === ts.SyntaxKind.OpenParenToken) {
      depth -= 1;
      if (depth === 0) return tokens[cursor - 1]?.kind === ts.SyntaxKind.IfKeyword;
    }
  }
  return false;
}

interface ConditionalDeclarationHeader {
  readonly declarationStart: number;
  readonly semicolon: number;
}

/**
 * `if (const x = e; cond)` is recognized exactly as the frontend recovers it:
 * a declaration keyword directly inside the header and exactly one `;` at
 * header depth.
 */
function conditionalDeclarationHeader(
  tokens: readonly ScannedToken[],
  ifIndex: number,
): ConditionalDeclarationHeader | undefined {
  const openParen = ifIndex + 1;
  const declaration = tokens[openParen + 1]?.kind;
  if (declaration !== ts.SyntaxKind.ConstKeyword && declaration !== ts.SyntaxKind.LetKeyword &&
    declaration !== ts.SyntaxKind.VarKeyword) return undefined;
  const closeParen = matchingClose(tokens, openParen, ts.SyntaxKind.OpenParenToken, ts.SyntaxKind.CloseParenToken);
  if (closeParen < 0) return undefined;
  let depth = 0;
  let semicolon = -1;
  for (let index = openParen; index < closeParen; index += 1) {
    const kind = tokens[index]!.kind;
    if (kind === ts.SyntaxKind.OpenParenToken || kind === ts.SyntaxKind.OpenBracketToken ||
      kind === ts.SyntaxKind.OpenBraceToken) depth += 1;
    else if (kind === ts.SyntaxKind.CloseParenToken || kind === ts.SyntaxKind.CloseBracketToken ||
      kind === ts.SyntaxKind.CloseBraceToken) depth -= 1;
    else if (kind === ts.SyntaxKind.SemicolonToken && depth === 1) {
      if (semicolon >= 0) return undefined;
      semicolon = index;
    }
  }
  if (semicolon < 0 || semicolon <= openParen + 1 || semicolon + 1 >= closeParen) return undefined;
  return { declarationStart: openParen + 1, semicolon };
}

interface ValueConstruct {
  /** Last token index of the construct, or -1 when the extent is not provable. */
  readonly extent: number;
}

function valueConstructAt(
  tokens: readonly ScannedToken[],
  index: number,
): ValueConstruct | undefined {
  const token = tokens[index]!;
  if (token.kind === ts.SyntaxKind.IfKeyword) {
    if (tokens[index + 1]?.kind !== ts.SyntaxKind.OpenParenToken) return undefined;
    if (!isValuePlacement(tokens, index)) return undefined;
    return { extent: valueIfExtent(tokens, index) };
  }
  if (token.kind === ts.SyntaxKind.SwitchKeyword) {
    if (!isValuePlacement(tokens, index)) return undefined;
    return { extent: valueSwitchExtent(tokens, index) };
  }
  if (isIdentifierLike(token) && tokens[index + 1]?.kind === ts.SyntaxKind.ColonToken) {
    if (!isValuePlacement(tokens, index)) return undefined;
    if (isLabeledLoopHead(tokens, index)) {
      // The `else` completion value has no token-provable end, so a loop value
      // is recognized (its `=` host is still masked) but never masked opaquely.
      return { extent: -1 };
    }
    const extent = labeledBlockExtent(tokens, index);
    return extent < 0 ? undefined : { extent };
  }
  return undefined;
}

function isValuePlacement(tokens: readonly ScannedToken[], index: number): boolean {
  const previous = tokens[index - 1];
  if (!previous) return false;
  if (previous.kind === ts.SyntaxKind.EqualsToken) return true;
  if (previous.kind === ts.SyntaxKind.ReturnKeyword || previous.kind === ts.SyntaxKind.ThrowKeyword) return true;
  if (previous.kind === ts.SyntaxKind.ColonToken) return isObjectPropertyColon(tokens, index - 1);
  return VALUE_CONSTRUCT_PREVIOUS.has(previous.kind);
}

function applyMasks(source: string, masks: readonly Mask[]): string | undefined {
  let masked = source;
  let previousEnd = -1;
  for (const mask of masks) {
    if (mask.start < previousEnd) return undefined;
    if (mask.text.length !== mask.end - mask.start) return undefined;
    previousEnd = mask.end;
    masked = masked.slice(0, mask.start) + mask.text + masked.slice(mask.end);
  }
  return masked.length === source.length ? masked : undefined;
}

/* -------------------------------------------------------------------------- */
/* Formatting engine                                                           */
/* -------------------------------------------------------------------------- */

function formatSettings(indentSize: number, newLine: string): ts.FormatCodeSettings {
  return {
    ...ts.getDefaultFormatCodeSettings(newLine),
    convertTabsToSpaces: true,
    indentSize,
    tabSize: indentSize,
    baseIndentSize: 0,
    indentStyle: ts.IndentStyle.Smart,
    newLineCharacter: newLine,
    // `.vibe` is written without statement semicolons; the formatter must never
    // introduce or remove one.
    semicolons: ts.SemicolonPreference.Ignore,
    trimTrailingWhitespace: true,
  };
}

function documentFormatEdits(
  text: string,
  fileName: string,
  settings: ts.FormatCodeSettings,
): readonly ts.TextChange[] {
  const snapshot = ts.ScriptSnapshot.fromString(text);
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [fileName],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => (name === fileName ? snapshot : undefined),
    getCurrentDirectory: () => "/",
    getCompilationSettings: () => ({ allowJs: true, target: ts.ScriptTarget.Latest }),
    getDefaultLibFileName: () => "lib.d.ts",
    fileExists: (name) => name === fileName,
    readFile: (name) => (name === fileName ? text : undefined),
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry(), ts.LanguageServiceMode.Syntactic);
  try {
    return service.getFormattingEditsForDocument(fileName, settings);
  } finally {
    service.dispose();
  }
}

/**
 * An edit may not reach into a masked span, because the authored text there is
 * restored verbatim and the edit was computed against different characters. A
 * zero-length insertion is refused strictly inside a mask and at its trailing
 * boundary (where it would land against restored text), and allowed at its
 * leading boundary, where indentation legitimately belongs.
 */
function editIsPermitted(edit: ts.TextChange, masks: readonly Mask[]): boolean {
  const start = edit.span.start;
  const end = start + edit.span.length;
  for (const mask of masks) {
    if (edit.span.length === 0) {
      if (start > mask.protectStart && start <= mask.protectEnd) return false;
    } else if (start < mask.protectEnd && end > mask.protectStart) {
      return false;
    }
  }
  return true;
}

/**
 * Rebuild the text left to right. The language service can emit several
 * insertions at one offset (a line break and then the indentation for the line
 * it opens); applying them in emission order at that offset is what keeps the
 * result a fixed point rather than a half-indented near-miss.
 */
function applyEdits(text: string, edits: readonly ts.TextChange[]): string {
  const ordered = edits
    .map((edit, index) => ({ edit, index }))
    .sort((left, right) => left.edit.span.start - right.edit.span.start || left.index - right.index);
  let output = "";
  let cursor = 0;
  for (const { edit } of ordered) {
    const start = edit.span.start;
    if (start < cursor) throw new TypeError("format edits overlap");
    output += text.slice(cursor, start) + edit.newText;
    cursor = start + edit.span.length;
  }
  return output + text.slice(cursor);
}

function shiftForOffset(edits: readonly ts.TextChange[], offset: number): number {
  let delta = 0;
  for (const edit of edits) {
    if (edit.span.start + edit.span.length <= offset) delta += edit.newText.length - edit.span.length;
  }
  return delta;
}

/* -------------------------------------------------------------------------- */
/* Whitespace normalization of VibeLang spellings                              */
/* -------------------------------------------------------------------------- */

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/**
 * Canonical spacing for the constructs the mask protects from the language
 * service. The language service can never reach inside a protected span, so
 * these spellings are normalized directly and idempotently: one space after a
 * `defer`/`errdefer` marker, `break :label value`, and one space on each side
 * of an `=` that introduces a value construct.
 */
function normalizeVibeSpelling(source: string, tokens: readonly ScannedToken[]): string {
  const replacements: Replacement[] = [];
  const collapse = (start: number, end: number, text: string): void => {
    if (start >= end && text === "") return;
    if (source.slice(start, end) === text) return;
    if (LINE_BREAK.test(source.slice(start, end))) return;
    replacements.push({ start, end, text });
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const next = tokens[index + 1];
    if (isDeferMarkerWord(token) &&
      next && startsExpression(next) && isSpaceOrTab(source[token.end])) {
      collapse(token.end, next.start, " ");
      continue;
    }
    if (token.kind === ts.SyntaxKind.BreakKeyword &&
      next?.kind === ts.SyntaxKind.ColonToken &&
      isIdentifierLike(tokens[index + 2])) {
      const label = tokens[index + 2]!;
      const value = tokens[index + 3];
      collapse(token.end, next.start, " ");
      collapse(next.end, label.start, "");
      if (value && startsExpression(value) && isSpaceOrTab(source[label.end])) {
        collapse(label.end, value.start, " ");
      }
      index += 2;
      continue;
    }
    if (token.kind === ts.SyntaxKind.EqualsToken && next && valueConstructAt(tokens, index + 1)) {
      const previous = tokens[index - 1];
      if (previous) collapse(previous.end, token.start, " ");
      collapse(token.end, next.start, " ");
      continue;
    }
    if (token.kind === ts.SyntaxKind.IfKeyword && next?.kind === ts.SyntaxKind.OpenParenToken) {
      const header = conditionalDeclarationHeader(tokens, index);
      const following = header ? tokens[header.semicolon + 1] : undefined;
      if (header && following) collapse(tokens[header.semicolon]!.end, following.start, " ");
    }
  }

  if (replacements.length === 0) return source;
  let output = source;
  for (const replacement of [...replacements].sort((left, right) => right.start - left.start)) {
    output = output.slice(0, replacement.start) + replacement.text + output.slice(replacement.end);
  }
  return output;
}

/** Delete whitespace that only precedes a line break, and end the file with one newline. */
function trimTrailingWhitespace(source: string, newLine: string): string {
  const all = scanAllTokens(source);
  const deletions: Replacement[] = [];
  for (let index = 0; index < all.length; index += 1) {
    const token = all[index]!;
    if (token.kind !== ts.SyntaxKind.WhitespaceTrivia) continue;
    const next = all[index + 1];
    if (next === undefined || next.kind === ts.SyntaxKind.NewLineTrivia) {
      deletions.push({ start: token.start, end: token.end, text: "" });
    }
  }
  let output = source;
  for (const deletion of deletions.reverse()) {
    output = output.slice(0, deletion.start) + output.slice(deletion.end);
  }
  const body = output.replace(/(?:\r\n|\n|\r|\u2028|\u2029)+$/u, "");
  return body.length === 0 ? "" : body + newLine;
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                  */
/* -------------------------------------------------------------------------- */

function positionOf(source: string, offset: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(offset, source.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < bounded; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: bounded - lineStart + 1 };
}

function diagnostic(
  source: string,
  code: FormatDiagnosticCode,
  message: string,
  start: number,
): FormatDiagnostic {
  const position = positionOf(source, start);
  return { severity: "error", code, message, start, line: position.line, column: position.column };
}

function failed(source: string, diagnostics: readonly FormatDiagnostic[]): FormatResult {
  return { ok: false, code: source, changed: false, diagnostics };
}

function detectNewLine(source: string): "\n" | "\r\n" {
  const firstNewLine = source.indexOf("\n");
  return firstNewLine > 0 && source[firstNewLine - 1] === "\r" ? "\r\n" : "\n";
}

function indentationOfLineContaining(source: string, offset: number): string {
  let lineStart = offset;
  while (lineStart > 0 && !LINE_BREAK.test(source[lineStart - 1]!)) lineStart -= 1;
  let cursor = lineStart;
  while (cursor < source.length && isSpaceOrTab(source[cursor])) cursor += 1;
  return source.slice(lineStart, cursor);
}

/** Re-indent every line after the first by `indent`. */
function reindent(text: string, indent: string): string {
  if (indent === "") return text;
  return text.split("\n").map((line, index) =>
    index === 0 || line.length === 0 ? line : indent + line).join("\n");
}

/**
 * Format one `.vibe` module. The result is byte-identical to the authored
 * source whenever `ok` is false, so a caller can always write `code` back.
 */
export function formatVibeSource(source: string, options: FormatOptions = {}): FormatResult {
  return formatModule(source, options, 0);
}

function formatModule(source: string, options: FormatOptions, depth: number): FormatResult {
  const fileName = options.fileName ?? "input.vibe";
  if (source.length > MAX_FORMAT_BYTES) {
    return failed(source, [diagnostic(
      source,
      "VIBE1900",
      `source exceeds the ${MAX_FORMAT_BYTES} UTF-16 unit formatter budget`,
      0,
    )]);
  }
  const indentSize = options.indentSize ?? 2;
  if (!Number.isInteger(indentSize) || indentSize < 1 || indentSize > 8) {
    throw new TypeError("formatVibeSource indentSize must be an integer between 1 and 8");
  }
  const newLine = options.newLine ?? detectNewLine(source);

  const normalized = normalizeVibeSpelling(source, codeTokens(scanAllTokens(source)));
  const tokens = codeTokens(scanAllTokens(normalized));
  const plan = planMasks(normalized, tokens);
  if (plan.masks.length > MAX_MASKS) {
    return failed(source, [diagnostic(
      source, "VIBE1900", `module masks more than ${MAX_MASKS} VibeLang constructs`, 0)]);
  }
  const masked = applyMasks(normalized, plan.masks);
  if (masked === undefined) {
    return failed(source, [diagnostic(
      source, "VIBE1901", "VibeLang construct masks overlap, so the module cannot be formatted soundly", 0)]);
  }

  const parseName = fileName.endsWith(".vibe") ? `${fileName}.ts` : fileName;
  const parsed = ts.createSourceFile(parseName, masked, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = internalParseDiagnostics(parsed);
  if (parseDiagnostics === undefined) {
    return failed(source, [diagnostic(
      source,
      "VIBE1002",
      "internal: typescript-js did not expose parser diagnostics, so the formatter cannot prove the module parses and fails closed",
      0,
    )]);
  }
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0]!;
    return failed(source, [diagnostic(
      source,
      "VIBE1901",
      `source does not parse after VibeLang recovery, so it is reported instead of rewritten: ${
        ts.flattenDiagnosticMessageText(first.messageText, " ")}`,
      Math.min(first.start ?? 0, source.length),
    )]);
  }

  const settings = formatSettings(indentSize, newLine);
  const edits = documentFormatEdits(masked, parseName, settings)
    .filter((edit) => editIsPermitted(edit, plan.masks));
  let output: string;
  try {
    output = applyEdits(normalized, edits);
  } catch {
    return failed(source, [diagnostic(
      source, "VIBE1902", "the language service produced overlapping formatting edits", 0)]);
  }

  if (depth < MAX_REGION_DEPTH) {
    const shifted = plan.regions
      .map((region) => ({
        start: region.start + shiftForOffset(edits, region.start),
        end: region.end + shiftForOffset(edits, region.end),
      }))
      .sort((left, right) => right.start - left.start);
    for (const region of shifted) {
      const text = output.slice(region.start, region.end);
      const inner = formatModule(text, { ...options, newLine }, depth + 1);
      if (!inner.ok) continue;
      const replaced = reindent(
        inner.code.replace(/(?:\r\n|\n)$/u, ""),
        indentationOfLineContaining(output, region.start),
      );
      if (replaced === text) continue;
      output = output.slice(0, region.start) + replaced + output.slice(region.end);
    }
  }

  output = trimTrailingWhitespace(output, newLine);

  const refusal = roundTripRefusal(source, normalized, output, plan, parsed, parseName);
  if (refusal) return failed(source, [diagnostic(source, "VIBE1902", refusal, 0)]);

  return { ok: true, code: output, changed: output !== source, diagnostics: [] };
}

/**
 * The formatter's correctness gate, applied to every result before it is
 * returned. Three independent checks, each rejecting a different way a
 * whitespace-only rewrite could still change the program:
 *
 * 1. The token and comment stream must be identical in kind and text, so no
 *    token, comment, string, template, or regular expression was touched.
 * 2. The masked module must re-mask to the same VibeLang construct plan and
 *    parse to the same AST structure, so no automatic semicolon and no
 *    restricted production moved. This is what allows the language service to
 *    join a brace onto its header or break a multi-line object literal open:
 *    both are line-break changes that provably do not change the parse.
 * 3. Line-break structure must be preserved on every line a VibeLang mask
 *    touches, and on the line after it. Stock TypeScript's AST cannot model
 *    `defer`'s same-line cleanup rule or the loop `else` value's line-break
 *    terminator, so those lines keep the strict invariant.
 */
function roundTripRefusal(
  source: string,
  normalized: string,
  output: string,
  plan: MaskPlan,
  maskedAuthoredFile: ts.SourceFile,
  parseName: string,
): string | undefined {
  const authoredStream = roundTripStream(source);
  const formattedStream = roundTripStream(output);
  const divergence = firstTokenDivergence(authoredStream, formattedStream);
  if (divergence >= 0) {
    const entry = authoredStream[divergence];
    return `formatting would change the module's token or comment stream at entry ${divergence}${
      entry ? ` (${JSON.stringify(entry.text.slice(0, 40))})` : ""
    }; the module is reported instead of rewritten`;
  }

  const outputTokens = codeTokens(scanAllTokens(output));
  const outputPlan = planMasks(output, outputTokens);
  if (outputPlan.masks.length !== plan.masks.length ||
    outputPlan.masks.some((mask, index) => mask.kind !== plan.masks[index]!.kind)) {
    return "formatting would change which VibeLang constructs the module contains; it is reported instead of rewritten";
  }
  const maskedOutput = applyMasks(output, outputPlan.masks);
  if (maskedOutput === undefined) {
    return "the formatted module could not be re-masked for verification; it is reported instead of rewritten";
  }
  const maskedOutputFile = ts.createSourceFile(
    parseName, maskedOutput, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if ((internalParseDiagnostics(maskedOutputFile) ?? [{}]).length > 0) {
    return "the formatted module would not parse after VibeLang recovery; it is reported instead of rewritten";
  }
  if (!signaturesMatch(structuralSignature(maskedAuthoredFile), structuralSignature(maskedOutputFile))) {
    return "formatting would change the module's parsed structure; it is reported instead of rewritten";
  }

  const lineOf = lineNumberIndex(normalized);
  const sensitiveLines = new Set<number>();
  for (const mask of plan.masks) {
    const first = lineOf(mask.protectStart);
    const last = lineOf(Math.max(mask.protectStart, mask.protectEnd - 1));
    for (let line = first; line <= last + 1; line += 1) sensitiveLines.add(line);
  }
  if (sensitiveLines.size === 0) return undefined;
  for (let index = 0; index < authoredStream.length; index += 1) {
    const authored = authoredStream[index]!;
    if (!sensitiveLines.has(lineOf(authored.start))) continue;
    if (authored.lineBreakBefore === formattedStream[index]!.lineBreakBefore) continue;
    return `formatting would move a line break next to a VibeLang construct at entry ${index} (${
      JSON.stringify(authored.text.slice(0, 40))}); the module is reported instead of rewritten`;
  }
  return undefined;
}

export interface VibeToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  /** UTF-16 offset of the token start, trivia excluded. */
  readonly start: number;
  readonly end: number;
}

/**
 * The token covering `offset`, or the token ending exactly at it when the
 * offset sits on a boundary (an editor caret placed after an identifier).
 * Comments and whitespace are skipped. This is the template- and regex-aware
 * scan the formatter itself uses, so a `${...}` substitution can never make a
 * caller read string content as ordinary tokens.
 */
export function vibeTokenAt(source: string, offset: number): VibeToken | undefined {
  let previous: ScannedToken | undefined;
  for (const token of codeTokens(scanAllTokens(source))) {
    if (token.start <= offset && offset < token.end) return token;
    if (token.start > offset) return previous?.end === offset ? previous : undefined;
    previous = token;
  }
  return previous?.end === offset ? previous : undefined;
}

/** True when `source` is already exactly what `formatVibeSource` produces. */
export function isFormattedVibeSource(source: string, options: FormatOptions = {}): boolean {
  const result = formatVibeSource(source, options);
  return result.ok && !result.changed;
}
