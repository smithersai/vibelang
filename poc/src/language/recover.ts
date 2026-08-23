import * as ts from "typescript-js";

/**
 * Pre-parse recovery for Smithers expression syntax stock TypeScript cannot
 * parse in general expression positions.
 *
 * Strategy: detect expression-position `if`/`switch` value constructs with a
 * template- and regex-aware token scan, prove each construct's extent through
 * the parser's own missing-initializer recovery shape, mask the constructs to
 * obtain a clean AST of the containing statement, and then hoist each
 * construct (plus every impure operand that must evaluate before it) to a
 * compiler temporary declared immediately before the containing statement.
 * The hoisted declaration is exactly the bounded initializer host form the
 * checked join planner already lowers, so joins, types, and Result exits are
 * checked by the existing machinery.
 *
 * The derived parse source is related to the authored source by an exact
 * piecewise offset map: moved text keeps character-exact provenance and
 * compiler glue is conservative-or-unmapped. Placements whose evaluation
 * order cannot be preserved fail closed with stable diagnostics.
 */

export interface RecoveryDiagnostic {
  readonly severity: "error";
  readonly code: "SMITHERS1707" | "SMITHERS1708" | "SMITHERS1709" | "SMITHERS1714" | "SMITHERS1715" | "SMITHERS1717";
  readonly message: string;
  /** UTF-16 offset in the authored source. */
  readonly start: number;
}

/**
 * A callee deliberately left in evaluation position ahead of a hoisted
 * construct. Semantic analysis must prove the binding (and member) cannot be
 * reassigned between the authored fetch point and the derived fetch point,
 * and must reject the compile otherwise.
 */
export interface StableCalleeAssumption {
  /** Authored offset of the callee expression start. */
  readonly authoredStart: number;
  /** Authored offset one past the callee expression end. */
  readonly authoredEnd: number;
}

export interface RecoveredLabeledValue {
  /** Authored offset of the label identifier. */
  readonly labelStart: number;
  /** Compiler marker identifier used as the derived host initializer. */
  readonly markerName: string;
  /** Authored offsets of each break-value expression. */
  readonly valueStarts: readonly number[];
}

export interface RecoveredLoopValue {
  /** Authored offset of the loop's own label identifier. */
  readonly loopLabelStart: number;
  /** Compiler marker identifier used as the derived host initializer. */
  readonly markerName: string;
  /** Authored offsets of each break-value expression. */
  readonly valueStarts: readonly number[];
  /** Authored offset of the else completion value expression. */
  readonly elseStart: number;
}

export interface VerbatimRun {
  readonly derivedStart: number;
  readonly authoredStart: number;
  readonly length: number;
}

interface GlueRun {
  readonly derivedStart: number;
  readonly length: number;
  /** Conservative authored anchor for diagnostics; never used for source maps. */
  readonly anchor: number;
}

export interface RecoveredSource {
  readonly authoredSource: string;
  readonly parseSource: string;
  readonly changed: boolean;
  readonly diagnostics: readonly RecoveryDiagnostic[];
  /**
   * Derived offsets of expression-position construct keywords recovery
   * refused. The unsupported-syntax pass keeps its fail-closed behavior for
   * them but must not double-report or lose parse-noise suppression.
   */
  readonly rejectedStarts: ReadonlySet<number>;
  /**
   * Derived offsets of construct keywords proven to be ordinary statement
   * positions (for example after `case x:` or a label). The token-level
   * expression heuristic must not misreport them as value expressions.
   */
  readonly statementStarts: ReadonlySet<number>;
  readonly assumptions: readonly StableCalleeAssumption[];
  /**
   * Recovered labeled block-value constructs, in AUTHORED coordinates. Each
   * names the derived host-initializer marker so the checked planner can
   * claim exactly these constructs and no authored look-alikes.
   */
  readonly labeledValues: readonly RecoveredLabeledValue[];
  /** Recovered loop-value constructs, in AUTHORED coordinates. */
  readonly loopValues: readonly RecoveredLoopValue[];
  /** Character-exact derived-to-authored runs for source-map composition. */
  readonly verbatim: readonly VerbatimRun[];
  /** Exact mapping only; undefined inside compiler glue. */
  toAuthored(derivedOffset: number): number | undefined;
  /** Exact where possible, nearest construct/operand anchor otherwise. */
  toAuthoredAnchor(derivedOffset: number): number;
  /** Exact mapping only; undefined when the authored text was replaced. */
  toDerived(authoredOffset: number): number | undefined;
}

const MAX_ITERATIONS = 32;
const MAX_CONSTRUCTS = 256;
const PROBE_PREFIX = "const __smithers_probe = ";

export interface RecoveryToken {
  readonly kind: ts.SyntaxKind;
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

type Token = RecoveryToken;

/**
 * Template- and regex-aware token scan. Both re-scans are biased so a wrong
 * guess swallows tokens (making recovery abstain and fail closed) instead of
 * exposing string/regex content as spurious expression tokens. Shared with
 * the planner and the unsupported-syntax pass so template substitutions can
 * never skew their downstream token positions.
 */
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

/**
 * True when a token of `kind` can be the final token of an expression, so a
 * following operator would have a left operand. This is exactly the negation
 * of the regular-expression-allowed decision the scanner already makes: a `/`
 * starts a regex precisely where no expression has been completed yet.
 *
 * `}` is deliberately *not* an expression terminator here. It closes a block
 * far more often than it closes an object literal, and the retired-syntax pass
 * relies on that to keep statement-form `try { } catch { }` legal.
 */
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

const EXPRESSION_PREVIOUS_KINDS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.ReturnKeyword,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBracketToken,
  ts.SyntaxKind.ColonToken,
  ts.SyntaxKind.EqualsGreaterThanToken,
  ts.SyntaxKind.PlusToken,
  ts.SyntaxKind.MinusToken,
  ts.SyntaxKind.AsteriskToken,
  ts.SyntaxKind.AsteriskAsteriskToken,
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
  ts.SyntaxKind.LessThanLessThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken,
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.QuestionToken,
]);

type CandidateKeyword = "if" | "switch" | "while" | "for" | "label";

/** One authored `break :label value` inside a labeled value block. */
interface LabeledBreakSite {
  readonly breakStart: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

interface LabeledValueDetails {
  readonly name: string;
  readonly sites: readonly LabeledBreakSite[];
  /** Offset one past the construct (block close, or loop else value end). */
  readonly end: number;
  /** Present for `label: for/while (...) { ... } else value` loop constructs. */
  readonly loop?: { readonly bodyEnd: number; readonly elseStart: number; readonly elseEnd: number };
  /** Set when the construct is recognizably a value form but unrecoverable. */
  readonly malformed?: { readonly start: number; readonly code: "SMITHERS1714" | "SMITHERS1715"; readonly message: string };
}

interface Candidate {
  readonly keyword: CandidateKeyword;
  readonly start: number;
  readonly label?: LabeledValueDetails;
}

const CANDIDATE_KEYWORDS = new Map<ts.SyntaxKind, CandidateKeyword>([
  [ts.SyntaxKind.IfKeyword, "if"],
  [ts.SyntaxKind.SwitchKeyword, "switch"],
  // Loop keywords participate only so statement-position uses after a label
  // or case colon are classified precisely; loop expressions stay fail-closed.
  [ts.SyntaxKind.WhileKeyword, "while"],
  [ts.SyntaxKind.ForKeyword, "for"],
]);

function detectCandidates(source: string, tokens: readonly Token[]): readonly Candidate[] {
  const candidates: Candidate[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    const previous = tokens[index - 1];
    const keyword = CANDIDATE_KEYWORDS.get(token.kind);
    if (keyword && tokens[index + 1]?.kind === ts.SyntaxKind.OpenParenToken) {
      if (!previous || !EXPRESSION_PREVIOUS_KINDS.has(previous.kind)) continue;
      // Bounded host positions (initializer `=` and `return`) belong to the
      // existing recovery planner and remain untouched. A statement-position
      // `if` after an ASI return is also excluded by the same rule.
      if (previous.kind === ts.SyntaxKind.EqualsToken || previous.kind === ts.SyntaxKind.ReturnKeyword) continue;
      candidates.push({ keyword, start: token.start });
      continue;
    }
    // A labeled value block: `label: { ... break :label value ... }` in an
    // expression position, including the bounded `=` and `return` hosts the
    // stock parser cannot recover at all for this shape. Recognition requires
    // at least one `break :label` so valid ternary/object colons stay
    // untouched.
    if (token.kind === ts.SyntaxKind.Identifier &&
      tokens[index + 1]?.kind === ts.SyntaxKind.ColonToken &&
      previous && EXPRESSION_PREVIOUS_KINDS.has(previous.kind)) {
      if (tokens[index + 2]?.kind === ts.SyntaxKind.OpenBraceToken) {
        const details = scanLabeledValueBlock(source, tokens, index);
        if (details) candidates.push({ keyword: "label", start: token.start, label: details });
      } else if (tokens[index + 2]?.kind === ts.SyntaxKind.ForKeyword ||
        tokens[index + 2]?.kind === ts.SyntaxKind.WhileKeyword) {
        const details = scanLabeledValueLoop(source, tokens, index);
        if (details) candidates.push({ keyword: "label", start: token.start, label: details });
      }
    }
  }
  return candidates;
}

/**
 * Delimit a labeled value block and its `break :label value` sites at token
 * level. The braces of the block are provably balanced by the template- and
 * regex-aware scan, and each break value extends to a `;`, the block-closing
 * brace, or an ASI newline after an expression-ending token.
 */
function scanLabeledValueBlock(
  source: string,
  tokens: readonly Token[],
  labelIndex: number,
): LabeledValueDetails | undefined {
  const name = tokens[labelIndex]!.text;
  const openIndex = labelIndex + 2;
  let depth = 0;
  let closeIndex = -1;
  for (let index = openIndex; index < tokens.length; index++) {
    const kind = tokens[index]!.kind;
    if (kind === ts.SyntaxKind.OpenBraceToken) depth += 1;
    else if (kind === ts.SyntaxKind.CloseBraceToken) {
      depth -= 1;
      if (depth === 0) {
        closeIndex = index;
        break;
      }
    }
  }
  if (closeIndex < 0) return undefined;

  const sites: LabeledBreakSite[] = [];
  for (let index = openIndex + 1; index < closeIndex; index++) {
    if (tokens[index]!.kind !== ts.SyntaxKind.BreakKeyword) continue;
    if (tokens[index + 1]?.kind !== ts.SyntaxKind.ColonToken) continue;
    const target = tokens[index + 2];
    if (target?.kind !== ts.SyntaxKind.Identifier || target.text !== name) continue;
    const value = scanBreakValue(source, tokens, index + 3, closeIndex);
    if (!value) {
      return {
        name,
        sites: [],
        end: tokens[closeIndex]!.end,
        malformed: {
          start: tokens[index]!.start,
          code: "SMITHERS1714",
          message: "a `break :label` inside a labeled value block needs one value expression ending at `;`, the block end, or a line break",
        },
      };
    }
    sites.push({ breakStart: tokens[index]!.start, valueStart: value.start, valueEnd: value.end });
    index = value.lastTokenIndex;
  }
  if (sites.length === 0) return undefined;

  // Shadowed reuse of the label name would make the rewrite ambiguous.
  for (let index = openIndex + 1; index < closeIndex; index++) {
    if (tokens[index]!.kind === ts.SyntaxKind.Identifier && tokens[index]!.text === name &&
      tokens[index + 1]?.kind === ts.SyntaxKind.ColonToken &&
      tokens[index + 2]?.kind === ts.SyntaxKind.OpenBraceToken) {
      return {
        name,
        sites: [],
        end: tokens[closeIndex]!.end,
        malformed: {
          start: tokens[index]!.start,
          code: "SMITHERS1714",
          message: "a labeled value block may not shadow its own label inside the block",
        },
      };
    }
  }

  return { name, sites, end: tokens[closeIndex]!.end };
}

/**
 * Delimit a `label: for/while (...) { ... } else value` loop construct. The
 * `else` after a loop has no valid TypeScript reading, so recognition on the
 * else keyword (or a `break :label` site) never reclassifies valid code.
 */
function scanLabeledValueLoop(
  source: string,
  tokens: readonly Token[],
  labelIndex: number,
): LabeledValueDetails | undefined {
  const name = tokens[labelIndex]!.text;
  let cursor = labelIndex + 3;
  if (tokens[cursor]?.kind === ts.SyntaxKind.AwaitKeyword) cursor += 1;
  if (tokens[cursor]?.kind !== ts.SyntaxKind.OpenParenToken) return undefined;
  let depth = 0;
  let headerClose = -1;
  for (let index = cursor; index < tokens.length; index++) {
    const kind = tokens[index]!.kind;
    if (kind === ts.SyntaxKind.OpenParenToken) depth += 1;
    else if (kind === ts.SyntaxKind.CloseParenToken) {
      depth -= 1;
      if (depth === 0) {
        headerClose = index;
        break;
      }
    }
  }
  if (headerClose < 0) return undefined;
  const bodyOpen = headerClose + 1;
  if (tokens[bodyOpen]?.kind !== ts.SyntaxKind.OpenBraceToken) return undefined;
  let braceDepth = 0;
  let bodyClose = -1;
  for (let index = bodyOpen; index < tokens.length; index++) {
    const kind = tokens[index]!.kind;
    if (kind === ts.SyntaxKind.OpenBraceToken) braceDepth += 1;
    else if (kind === ts.SyntaxKind.CloseBraceToken) {
      braceDepth -= 1;
      if (braceDepth === 0) {
        bodyClose = index;
        break;
      }
    }
  }
  if (bodyClose < 0) return undefined;

  const sites: LabeledBreakSite[] = [];
  for (let index = bodyOpen + 1; index < bodyClose; index++) {
    if (tokens[index]!.kind !== ts.SyntaxKind.BreakKeyword) continue;
    if (tokens[index + 1]?.kind !== ts.SyntaxKind.ColonToken) continue;
    const target = tokens[index + 2];
    if (target?.kind !== ts.SyntaxKind.Identifier || target.text !== name) continue;
    const value = scanBreakValue(source, tokens, index + 3, bodyClose);
    if (!value) {
      return {
        name,
        sites: [],
        end: tokens[bodyClose]!.end,
        malformed: {
          start: tokens[index]!.start,
          code: "SMITHERS1715",
          message: "a `break :label` inside a value loop needs one value expression ending at `;`, the body end, or a line break",
        },
      };
    }
    sites.push({ breakStart: tokens[index]!.start, valueStart: value.start, valueEnd: value.end });
    index = value.lastTokenIndex;
  }

  const elseToken = tokens[bodyClose + 1];
  if (elseToken?.kind !== ts.SyntaxKind.ElseKeyword) {
    if (sites.length === 0) return undefined; // an ordinary labeled loop
    return {
      name,
      sites: [],
      end: tokens[bodyClose]!.end,
      malformed: {
        start: tokens[labelIndex]!.start,
        code: "SMITHERS1715",
        message: "a value loop requires an `else` completion value for the path where no `break :label value` runs",
      },
    };
  }
  // A loop else in expression position ends at any enclosing comma: the
  // construct sits in argument lists, array elements, and declarator lists,
  // where a depth-zero comma always belongs to the container.
  const elseValue = scanBreakValue(source, tokens, bodyClose + 2, tokens.length, true);
  if (!elseValue) {
    return {
      name,
      sites: [],
      end: tokens[bodyClose]!.end,
      malformed: {
        start: elseToken.start,
        code: "SMITHERS1715",
        message: "a value loop `else` needs one completion value expression",
      },
    };
  }
  return {
    name,
    sites,
    end: elseValue.end,
    loop: { bodyEnd: tokens[bodyClose]!.end, elseStart: elseValue.start, elseEnd: elseValue.end },
  };
}

function scanBreakValue(
  source: string,
  tokens: readonly Token[],
  valueTokenIndex: number,
  closeIndex: number,
  stopAtComma = false,
): { readonly start: number; readonly end: number; readonly lastTokenIndex: number } | undefined {
  const first = tokens[valueTokenIndex];
  if (!first || valueTokenIndex >= closeIndex) return undefined;
  if (first.kind === ts.SyntaxKind.SemicolonToken || first.kind === ts.SyntaxKind.CloseBraceToken) {
    return undefined; // `break :label` without a value stays unrecognized
  }
  let depth = 0;
  let last = valueTokenIndex;
  for (let index = valueTokenIndex; index < tokens.length; index++) {
    const token = tokens[index]!;
    const previous = tokens[index - 1]!;
    if (index > valueTokenIndex && depth === 0 &&
      /[\n\r\u2028\u2029]/.test(source.slice(previous.end, token.start)) &&
      !regularExpressionAllowed(previous.kind)) {
      break; // ASI after an expression-ending token
    }
    if (token.kind === ts.SyntaxKind.SemicolonToken && depth === 0) break;
    if (stopAtComma && token.kind === ts.SyntaxKind.CommaToken && depth === 0) break;
    if (token.kind === ts.SyntaxKind.OpenParenToken || token.kind === ts.SyntaxKind.OpenBracketToken ||
      token.kind === ts.SyntaxKind.OpenBraceToken) depth += 1;
    if (token.kind === ts.SyntaxKind.CloseParenToken || token.kind === ts.SyntaxKind.CloseBracketToken ||
      token.kind === ts.SyntaxKind.CloseBraceToken) {
      if (depth === 0) break; // closes an enclosing bracket
      depth -= 1;
    }
    if (token.kind === ts.SyntaxKind.BreakKeyword && depth === 0) {
      return undefined; // malformed: a break can never begin or continue an expression
    }
    last = index;
  }
  if (last < valueTokenIndex) return undefined;
  return { start: tokens[valueTokenIndex]!.start, end: tokens[last]!.end, lastTokenIndex: last };
}

interface Extent {
  readonly start: number;
  readonly end: number;
  readonly keyword: CandidateKeyword;
  readonly braced: boolean;
  readonly label?: LabeledValueDetails;
}

function matchesCandidateKeyword(statement: ts.Statement, keyword: CandidateKeyword): boolean {
  switch (keyword) {
    case "if":
      return ts.isIfStatement(statement);
    case "switch":
      return ts.isSwitchStatement(statement);
    case "while":
      return ts.isWhileStatement(statement);
    case "for":
      return ts.isForStatement(statement) || ts.isForInStatement(statement) || ts.isForOfStatement(statement);
    case "label":
      return false; // labeled extents are delimited at token level, never probed
  }
}

/**
 * Prove a construct's extent by asking the parser to recover it in the known
 * bounded initializer shape. Braced branches make the recovered statement end
 * exactly at the construct's closing brace.
 */
function probeExtent(source: string, candidate: Candidate): Extent | undefined {
  const probe = PROBE_PREFIX + source.slice(candidate.start);
  const file = ts.createSourceFile("__smithers_probe__.ts", probe, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const control = file.statements[1];
  if (!control) return undefined;
  if (!matchesCandidateKeyword(control, candidate.keyword)) return undefined;
  if (control.getStart(file) !== PROBE_PREFIX.length) return undefined;
  return {
    start: candidate.start,
    end: candidate.start + (control.end - PROBE_PREFIX.length),
    keyword: candidate.keyword,
    braced: ts.isIfStatement(control) ? ifChainIsBraced(control) : true,
  };
}

function ifChainIsBraced(statement: ts.IfStatement): boolean {
  if (!ts.isBlock(statement.thenStatement)) return false;
  if (!statement.elseStatement) return true;
  if (ts.isBlock(statement.elseStatement)) return true;
  if (ts.isIfStatement(statement.elseStatement)) return ifChainIsBraced(statement.elseStatement);
  return false;
}

/** Replace a span with a marker identifier plus spaces, preserving newlines. */
function maskSpan(masked: string[], start: number, end: number, marker: string): void {
  let offset = start;
  for (const character of marker) {
    masked[offset] = character;
    offset += 1;
  }
  for (; offset < end; offset++) {
    const code = masked[offset]!.charCodeAt(0);
    if (code !== 10 && code !== 13 && code !== 0x2028 && code !== 0x2029) masked[offset] = " ";
  }
}

interface MarkerInfo {
  readonly name: string;
  readonly extent: Extent;
  /** Authored construct text of the CURRENT iteration source. */
  readonly text: string;
}

interface Rejection {
  readonly code: "SMITHERS1707" | "SMITHERS1708" | "SMITHERS1709" | "SMITHERS1714" | "SMITHERS1715";
  readonly message: string;
  /** Offset in the current iteration source. */
  readonly start: number;
}

type EvaluationUnit =
  | { readonly kind: "operand"; readonly node: ts.Expression }
  | { readonly kind: "shorthand"; readonly node: ts.ShorthandPropertyAssignment }
  | { readonly kind: "spread"; readonly node: ts.Node }
  | { readonly kind: "construct"; readonly info: MarkerInfo };

interface HostPlan {
  readonly insertionOffset: number;
  readonly units: readonly EvaluationUnit[];
  readonly assumptions: readonly StableCalleeAssumption[];
}

class Reject extends Error {
  constructor(readonly code: Rejection["code"], readonly reason: string) {
    super(reason);
  }
}

class IdentifierAllocator {
  private readonly used: Set<string>;
  private counter = 0;
  constructor(tokens: readonly Token[]) {
    this.used = new Set(
      tokens.filter((token) => token.kind === ts.SyntaxKind.Identifier).map((token) => token.text),
    );
  }
  noteSource(tokens: readonly Token[]): void {
    for (const token of tokens) {
      if (token.kind === ts.SyntaxKind.Identifier) this.used.add(token.text);
    }
  }
  allocate(purpose: string): string {
    for (;;) {
      const candidate = `__smithers_${purpose}_${++this.counter}`;
      if (!this.used.has(candidate)) {
        this.used.add(candidate);
        return candidate;
      }
    }
  }
}

interface Edit {
  readonly start: number;
  readonly end: number;
  /** Verbatim sub-slices interleaved with glue text. */
  readonly pieces: readonly EditPiece[];
}

type EditPiece =
  | { readonly kind: "glue"; readonly text: string; readonly anchor: number }
  | { readonly kind: "verbatim"; readonly start: number; readonly end: number };

interface IterationResult {
  readonly edits: readonly Edit[];
  readonly rejections: readonly Rejection[];
  /** Coordinates of the CURRENT iteration source. */
  readonly assumptions: readonly StableCalleeAssumption[];
  /** Coordinates of the CURRENT iteration source. */
  readonly labeledValues: readonly RecoveredLabeledValue[];
  /** Coordinates of the CURRENT iteration source. */
  readonly loopValues: readonly RecoveredLoopValue[];
  /** Construct keywords proven to be ordinary statement positions. */
  readonly statementStarts: readonly number[];
  readonly candidateCount: number;
}

function isPureOperand(node: ts.Expression): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
      return true;
    case ts.SyntaxKind.Identifier:
      return (node as ts.Identifier).text === "undefined";
    default:
      return false;
  }
}

function isDeferMarkerLike(node: ts.Statement | undefined): boolean {
  return node !== undefined && ts.isExpressionStatement(node) && ts.isIdentifier(node.expression) &&
    (node.expression.text === "defer" || node.expression.text === "errdefer");
}

function statementListOf(node: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node) ||
    ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    return node.statements;
  }
  return undefined;
}

/**
 * Recover the checked expression placements of one authored source. When the
 * source contains none, the authored text passes through byte-identically.
 */
export function recoverSmithersSyntax(authoredSource: string): RecoveredSource {
  const initialTokens = scanTokens(authoredSource);
  const allocator = new IdentifierAllocator(initialTokens);

  // Mapping runs describing the CURRENT iteration source against authored.
  let verbatim: VerbatimRun[] = [{ derivedStart: 0, authoredStart: 0, length: authoredSource.length }];
  let glue: GlueRun[] = [];
  let current = authoredSource;
  let currentTokens = initialTokens;
  let changed = false;
  const diagnostics: RecoveryDiagnostic[] = [];
  const rejectedStarts = new Set<number>();
  const statementStarts = new Set<number>();
  const assumptions: StableCalleeAssumption[] = [];
  const labeledValues: RecoveredLabeledValue[] = [];
  const loopValues: RecoveredLoopValue[] = [];
  let aborted = false;

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

  // Conditional declarations are rewritten before anything else: the form does
  // not parse at all, so every later pass needs the parseable shape. Authored
  // offsets of refused constructs are converted to derived offsets at the end,
  // once every other edit has settled.
  const conditionalRejectedAuthored: number[] = [];
  for (let round = 0; ; round++) {
    const plan = planConditionalDeclarations(currentTokens);
    if (round >= MAX_ITERATIONS || plan.count > MAX_CONSTRUCTS) {
      diagnostics.push({
        severity: "error",
        code: "SMITHERS1717",
        message: `conditional-declaration recovery exceeded the ${MAX_CONSTRUCTS} construct / ${MAX_ITERATIONS} round bound of the checked POC`,
        start: 0,
      });
      aborted = true;
      break;
    }
    if (plan.edits.length === 0) {
      for (const rejection of plan.rejections) {
        const start = anchorAt(rejection.start);
        conditionalRejectedAuthored.push(start);
        diagnostics.push({ severity: "error", code: "SMITHERS1717", message: rejection.message, start });
      }
      break;
    }
    const applied = applyEdits(current, plan.edits, verbatim, glue);
    current = applied.source;
    verbatim = applied.verbatim;
    glue = applied.glue;
    currentTokens = scanTokens(current);
    allocator.noteSource(currentTokens);
    changed = true;
  }
  if (aborted) return identityRecovery(authoredSource, diagnostics);

  // Constructs proven to be ordinary statements are re-examined without
  // masking so candidates inside them stay visible. Their offsets are only
  // valid while no edit has moved text, so edits reset the set.
  let knownStatementStarts = new Set<number>();
  let editRounds = 0;
  let classificationRounds = 0;
  for (;;) {
    if (editRounds >= MAX_ITERATIONS || classificationRounds > MAX_CONSTRUCTS) {
      diagnostics.push({
        severity: "error",
        code: "SMITHERS1707",
        message: "expression construct recovery did not reach a fixed point within the POC iteration bound",
        start: 0,
      });
      aborted = true;
      break;
    }
    const result = runIteration(current, currentTokens, allocator, knownStatementStarts);
    if (result.candidateCount > MAX_CONSTRUCTS) {
      diagnostics.push({
        severity: "error",
        code: "SMITHERS1707",
        message: `this module exceeds the ${MAX_CONSTRUCTS} recovered expression-construct bound of the checked POC`,
        start: 0,
      });
      aborted = true;
      break;
    }
    if (result.edits.length === 0) {
      const freshStatements = result.statementStarts.filter((start) => !knownStatementStarts.has(start));
      if (freshStatements.length > 0) {
        for (const start of freshStatements) knownStatementStarts.add(start);
        classificationRounds += 1;
        continue;
      }
      // Fixed point: report every remaining expression-position construct.
      for (const rejection of result.rejections) {
        diagnostics.push({
          severity: "error",
          code: rejection.code,
          message: rejection.message,
          start: anchorAt(rejection.start),
        });
        rejectedStarts.add(rejection.start);
      }
      for (const start of result.statementStarts) statementStarts.add(start);
      for (const start of knownStatementStarts) statementStarts.add(start);
      // Any `break :` sequence still present cannot belong to a recovered
      // construct; report it instead of leaving only raw grammar noise.
      for (let index = 0; index < currentTokens.length; index++) {
        if (currentTokens[index]!.kind === ts.SyntaxKind.BreakKeyword &&
          currentTokens[index + 1]?.kind === ts.SyntaxKind.ColonToken &&
          !rejectedStarts.has(currentTokens[index]!.start)) {
          const start = currentTokens[index]!.start;
          if (![...rejectedStarts].some((rejected) => Math.abs(rejected - start) < 4096)) {
            diagnostics.push({
              severity: "error",
              code: "SMITHERS1714",
              message: "a `break :label value` is only defined inside a labeled block used as a value",
              start: anchorAt(start),
            });
          }
          rejectedStarts.add(start);
        }
      }
      break;
    }
    // Callee-stability assumptions belong to the edits being applied. The
    // callee text itself stays in place, so its authored position is exact.
    for (const assumption of result.assumptions) {
      const start = exactAt(verbatim, assumption.authoredStart);
      const last = exactAt(verbatim, assumption.authoredEnd - 1);
      if (start !== undefined && last !== undefined) {
        assumptions.push({ authoredStart: start, authoredEnd: last + 1 });
      }
    }
    for (const labeled of result.labeledValues) {
      const labelStart = exactAt(verbatim, labeled.labelStart);
      const valueStarts = labeled.valueStarts.map((offset) => exactAt(verbatim, offset));
      if (labelStart !== undefined && valueStarts.every((offset) => offset !== undefined)) {
        labeledValues.push({
          labelStart,
          markerName: labeled.markerName,
          valueStarts: valueStarts as number[],
        });
      }
    }
    for (const loop of result.loopValues) {
      const loopLabelStart = exactAt(verbatim, loop.loopLabelStart);
      const elseStart = exactAt(verbatim, loop.elseStart);
      const valueStarts = loop.valueStarts.map((offset) => exactAt(verbatim, offset));
      if (loopLabelStart !== undefined && elseStart !== undefined &&
        valueStarts.every((offset) => offset !== undefined)) {
        loopValues.push({
          loopLabelStart,
          markerName: loop.markerName,
          valueStarts: valueStarts as number[],
          elseStart,
        });
      }
    }
    const applied = applyEdits(current, result.edits, verbatim, glue);
    current = applied.source;
    verbatim = applied.verbatim;
    glue = applied.glue;
    currentTokens = scanTokens(current);
    allocator.noteSource(currentTokens);
    changed = true;
    knownStatementStarts = new Set();
    editRounds += 1;
  }

  if (aborted) {
    // Never emit a partially transformed module: abstain entirely and keep
    // the diagnostics, so the ordinary fail-closed grammar path applies.
    return identityRecovery(authoredSource, diagnostics);
  }

  const finalGlue = glue;
  const derivedIndex = [...verbatim].sort((left, right) => left.derivedStart - right.derivedStart);
  const authoredIndex = [...verbatim].sort((left, right) => left.authoredStart - right.authoredStart);

  // A refused conditional declaration keeps its authored text, so its `if`
  // keyword still exists in the derived source. Suppress the parser's grammar
  // noise there without losing the specific SMITHERS1717 report.
  for (const authored of conditionalRejectedAuthored) {
    for (const run of authoredIndex) {
      if (authored >= run.authoredStart && authored < run.authoredStart + run.length) {
        rejectedStarts.add(run.derivedStart + (authored - run.authoredStart));
        break;
      }
    }
  }

  return {
    authoredSource,
    parseSource: current,
    changed,
    diagnostics,
    rejectedStarts,
    statementStarts,
    assumptions,
    labeledValues,
    loopValues,
    verbatim: derivedIndex,
    toAuthored: (offset) => exactAt(derivedIndex, offset),
    toAuthoredAnchor: (offset) => {
      const exact = exactAt(derivedIndex, offset);
      if (exact !== undefined) return exact;
      for (const run of finalGlue) {
        if (offset >= run.derivedStart && offset < run.derivedStart + run.length) return run.anchor;
      }
      // Past-the-end and boundary positions: nearest preceding exact mapping.
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
    statementStarts: new Set(),
    assumptions: [],
    labeledValues: [],
    loopValues: [],
    verbatim: runs,
    toAuthored: (offset) => (offset >= 0 && offset <= source.length ? offset : undefined),
    toAuthoredAnchor: (offset) => Math.max(0, Math.min(offset, source.length)),
    toDerived: (offset) => (offset >= 0 && offset <= source.length ? offset : undefined),
  };
}

function runIteration(
  source: string,
  tokens: readonly Token[],
  allocator: IdentifierAllocator,
  knownStatementStarts: ReadonlySet<number>,
): IterationResult {
  const candidates = detectCandidates(source, tokens)
    .filter((candidate) => !knownStatementStarts.has(candidate.start));
  if (candidates.length === 0) {
    return { edits: [], rejections: [], assumptions: [], labeledValues: [], loopValues: [], statementStarts: [], candidateCount: 0 };
  }

  // Probe extents; mask every probeable construct so one clean parse serves
  // the container analysis. Constructs nested inside another masked extent
  // stay for later iterations.
  const markers = new Map<string, MarkerInfo>();
  const rejections: Rejection[] = [];
  const rejectionStartsHere = new Set<number>();
  const statementStarts: number[] = [];
  const rejectHere = (code: Rejection["code"], message: string, start: number): void => {
    if (rejectionStartsHere.has(start)) return;
    rejectionStartsHere.add(start);
    rejections.push({ code, message, start });
  };
  const maskedCharacters = [...source];
  const maskedExtents: Extent[] = [];
  for (const candidate of candidates) {
    if (maskedExtents.some((extent) => candidate.start > extent.start && candidate.start < extent.end)) continue;
    if (candidate.keyword === "label" && candidate.label?.malformed !== undefined) {
      rejectHere(candidate.label.malformed.code, candidate.label.malformed.message, candidate.start);
      continue;
    }
    const extent = candidate.keyword === "label"
      ? candidate.label && {
          start: candidate.start,
          end: candidate.label.end,
          keyword: candidate.keyword,
          braced: true,
          label: candidate.label,
        }
      : probeExtent(source, candidate);
    if (!extent) continue; // unmatched shape: the existing fail-closed path owns it
    const markerLength = extent.end - extent.start;
    const name = allocator.allocate("expr");
    if (name.length > markerLength) {
      rejectHere(
        "SMITHERS1707",
        `this ${candidate.keyword} expression is too short to recover in place`,
        candidate.start,
      );
      continue;
    }
    maskSpan(maskedCharacters, extent.start, extent.end, name);
    markers.set(name, { name, extent, text: source.slice(extent.start, extent.end) });
    maskedExtents.push(extent);
  }
  if (markers.size === 0) {
    return { edits: [], rejections, assumptions: [], labeledValues: [], loopValues: [], statementStarts, candidateCount: candidates.length };
  }

  const maskedSource = maskedCharacters.join("");
  const maskedFile = ts.createSourceFile(
    "__smithers_masked__.ts",
    maskedSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const parseDiagnosticStarts = (
    (maskedFile as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.DiagnosticWithLocation[] })
      .parseDiagnostics ?? []
  ).map((diagnostic) => diagnostic.start ?? 0);

  // Locate marker identifier nodes.
  const markerNodes = new Map<string, ts.Identifier>();
  const findMarkers = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && markers.has(node.text) && !markerNodes.has(node.text)) {
      markerNodes.set(node.text, node);
    }
    ts.forEachChild(node, findMarkers);
  };
  findMarkers(maskedFile);

  const edits: Edit[] = [];
  const planAssumptions: StableCalleeAssumption[] = [];
  const planLabeledValues: RecoveredLabeledValue[] = [];
  const planLoopValues: RecoveredLoopValue[] = [];
  const wrappedArrowSpans: Array<{ readonly start: number; readonly end: number }> = [];
  const hostGroups = new Map<ts.Statement, MarkerInfo[]>();
  /** Loop-keyword constructs in true expression position; stage-3 territory. */
  const unhandledStarts = new Set<number>();

  /** The mask can end inside padding; grow a span to cover masked extents. */
  const coverMaskedExtents = (start: number, end: number): number => {
    let covered = end;
    for (;;) {
      let grew = false;
      for (const extent of maskedExtents) {
        if (extent.start >= start && extent.start < covered && extent.end > covered) {
          covered = extent.end;
          grew = true;
        }
      }
      if (!grew) return covered;
    }
  };

  for (const [name, info] of markers) {
    const node = markerNodes.get(name);
    if (!node) {
      rejectHere(
        "SMITHERS1707",
        `this ${info.extent.keyword} expression placement could not be recovered from the parse`,
        info.extent.start,
      );
      continue;
    }
    if (node.parent && ts.isExpressionStatement(node.parent) && node.parent.expression === node) {
      if (info.extent.keyword === "label") {
        // A statement-position labeled construct has no value destination,
        // so a value-carrying break or loop else is unrecoverable.
        if (info.extent.label?.loop) {
          rejectHere(
            "SMITHERS1715",
            "a value loop with `break :label value` or `else` must be used as a value; a statement-position loop takes plain `break label`",
            info.extent.start,
          );
        } else {
          rejectHere(
            "SMITHERS1714",
            "a `break :label value` requires the labeled block to be used as a value; a statement-position labeled block must use plain `break label`",
            info.extent.start,
          );
        }
        continue;
      }
      // The construct was an ordinary statement all along (for example after
      // `case x:` or a label). Leave it untouched and record the proof so the
      // unsupported-syntax scan does not misreport valid statement TypeScript.
      statementStarts.push(info.extent.start);
      continue;
    }
    if (info.extent.keyword === "while" || info.extent.keyword === "for") {
      // Loop expression values are not implemented; keep the existing
      // fail-closed diagnostics but suppress edits sharing this statement.
      unhandledStarts.add(info.extent.start);
      continue;
    }
    if (!info.extent.braced) {
      rejectHere(
        "SMITHERS1709",
        `a value ${info.extent.keyword} expression in a general expression position requires braced branches`,
        info.extent.start,
      );
      continue;
    }
    const placement = locatePlacement(node);
    if (placement.kind === "reject") {
      rejectHere(placement.code, placement.message, info.extent.start);
      continue;
    }
    if (placement.kind === "arrow-wrap") {
      const bodyStart = placement.body.getStart(maskedFile);
      const bodyEnd = coverMaskedExtents(bodyStart, placement.body.end);
      if (!wrappedArrowSpans.some((span) => span.start === bodyStart)) {
        wrappedArrowSpans.push({ start: bodyStart, end: bodyEnd });
        edits.push({
          start: bodyStart,
          end: bodyEnd,
          pieces: [
            { kind: "glue", text: "{ return ", anchor: bodyStart },
            { kind: "verbatim", start: bodyStart, end: bodyEnd },
            { kind: "glue", text: "; }", anchor: bodyEnd - 1 },
          ],
        });
      }
      continue;
    }
    const group = hostGroups.get(placement.host) ?? [];
    group.push(info);
    hostGroups.set(placement.host, group);
  }

  // Parse noise expected from bounded missing-initializer recovery is not a
  // reason to distrust the containing statement.
  const expectedNoise = expectedRecoveryNoise(maskedFile);

  for (const [host, group] of hostGroups) {
    const hostStart = host.getStart(maskedFile);
    const hostEnd = host.end;
    const overlapsWrap = wrappedArrowSpans.some((span) => hostStart < span.end && span.start < hostEnd);
    if (overlapsWrap) continue; // handled after the wrap lands, next iteration
    const overlapsRejected = [...rejectionStartsHere, ...unhandledStarts]
      .some((start) => start >= hostStart && start < hostEnd);
    const hasParseNoise = parseDiagnosticStarts.some((start) =>
      start >= hostStart && start < hostEnd && !expectedNoise.has(start));
    if (overlapsRejected || hasParseNoise) {
      for (const info of group) {
        rejectHere(
          "SMITHERS1707",
          `this ${info.extent.keyword} expression shares a statement with unrecoverable syntax, so its evaluation order cannot be checked`,
          info.extent.start,
        );
      }
      continue;
    }
    try {
      const plan = planHost(host, maskedFile, markers);
      edits.push(...editsForHostPlan(plan, maskedFile, allocator, planLabeledValues, planLoopValues));
      planAssumptions.push(...plan.assumptions);
    } catch (error) {
      if (!(error instanceof Reject)) throw error;
      for (const info of group) {
        rejectHere(error.code, error.reason, info.extent.start);
      }
    }
  }

  // Overlapping edits cannot be composed into a provable mapping.
  const ordered = [...edits].sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index]!.start < ordered[index - 1]!.end) {
      return {
        edits: [],
        rejections: [
          {
            code: "SMITHERS1707",
            message: "overlapping expression recovery edits cannot preserve checked evaluation order",
            start: ordered[index]!.start,
          },
          ...rejections,
        ],
        assumptions: [],
        labeledValues: [],
        loopValues: [],
        statementStarts,
        candidateCount: candidates.length,
      };
    }
  }

  return {
    edits: ordered,
    rejections,
    assumptions: planAssumptions,
    labeledValues: planLabeledValues,
    loopValues: planLoopValues,
    statementStarts,
    candidateCount: candidates.length,
  };
}

/**
 * "Expression expected." positions produced by the bounded missing-initializer
 * and same-line-return recovery shapes. These are the deliberate recovery
 * forms of the checked planner, not evidence of unrecoverable syntax.
 */
function expectedRecoveryNoise(file: ts.SourceFile): ReadonlySet<number> {
  const allowed = new Set<number>();
  const visitList = (statements: readonly ts.Statement[]): void => {
    for (let index = 1; index < statements.length; index++) {
      const control = statements[index]!;
      if (!ts.isIfStatement(control) && !ts.isSwitchStatement(control) &&
        !ts.isWhileStatement(control) && !ts.isForStatement(control) &&
        !ts.isForInStatement(control) && !ts.isForOfStatement(control)) continue;
      if (boundedHostInsertionOffset(control, file) !== undefined) {
        allowed.add(control.getStart(file));
      }
    }
  };
  const visit = (node: ts.Node): void => {
    const statements = statementListOf(node);
    if (statements) visitList(statements);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return allowed;
}

type Placement =
  | { readonly kind: "host"; readonly host: ts.Statement }
  | { readonly kind: "arrow-wrap"; readonly body: ts.Expression }
  | { readonly kind: "reject"; readonly code: Rejection["code"]; readonly message: string };

function locatePlacement(marker: ts.Identifier): Placement {
  let node: ts.Node = marker;
  for (;;) {
    const parent: ts.Node | undefined = node.parent;
    if (!parent) {
      return { kind: "reject", code: "SMITHERS1707", message: "this expression placement has no recoverable containing statement" };
    }
    if (ts.isArrowFunction(parent) && parent.body === node && !ts.isBlock(node)) {
      return { kind: "arrow-wrap", body: node as ts.Expression };
    }
    if (ts.isStatement(node as ts.Statement)) {
      if (statementListOf(parent)) return { kind: "host", host: node as ts.Statement };
      if ((ts.isIfStatement(parent) && (parent.thenStatement === node || parent.elseStatement === node)) ||
        ((ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isForStatement(parent) ||
          ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.statement === node) ||
        ts.isLabeledStatement(parent)) {
        return {
          kind: "reject",
          code: "SMITHERS1707",
          message: "a value expression inside a braceless branch or labeled statement cannot receive checked hoist statements; wrap the branch in braces",
        };
      }
    }
    node = parent;
  }
}

function planHost(
  host: ts.Statement,
  maskedFile: ts.SourceFile,
  markersByName: ReadonlyMap<string, MarkerInfo>,
): HostPlan {
  // Statements adjacent to a defer/errdefer marker must keep same-line
  // pairing, which hoisted statements would break.
  const siblings = host.parent ? statementListOf(host.parent) : undefined;
  if (siblings) {
    const index = siblings.indexOf(host);
    if (isDeferMarkerLike(siblings[index - 1])) {
      throw new Reject(
        "SMITHERS1707",
        "a value expression inside a defer/errdefer cleanup cannot receive hoisted statements without breaking cleanup registration",
      );
    }
  }

  const markerCache = new Map<ts.Node, boolean>();
  const containsMarker = (node: ts.Node): boolean => {
    const cached = markerCache.get(node);
    if (cached !== undefined) return cached;
    let found = ts.isIdentifier(node) && markersByName.has(node.text);
    if (!found) {
      ts.forEachChild(node, (child) => {
        if (!found && containsMarker(child)) found = true;
      });
    }
    markerCache.set(node, found);
    return found;
  };

  const units: EvaluationUnit[] = [];
  const assumptions: StableCalleeAssumption[] = [];

  const reject = (message: string, code: Rejection["code"] = "SMITHERS1707"): never => {
    throw new Reject(code, message);
  };

  const noteCallee = (callee: ts.Expression): void => {
    let expression: ts.Expression = callee;
    while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
    if (ts.isIdentifier(expression)) {
      assumptions.push({ authoredStart: expression.getStart(maskedFile), authoredEnd: expression.end });
      return;
    }
    if (ts.isPropertyAccessExpression(expression) && !expression.questionDotToken &&
      (ts.isIdentifier(expression.expression) || expression.expression.kind === ts.SyntaxKind.ThisKeyword) &&
      ts.isIdentifier(expression.name)) {
      assumptions.push({ authoredStart: expression.getStart(maskedFile), authoredEnd: expression.end });
      return;
    }
    if (expression.kind === ts.SyntaxKind.SuperKeyword) {
      reject("a value expression inside a super(...) call cannot preserve checked evaluation order");
    }
    reject(
      "the callee evaluated ahead of this value expression cannot be proven order-stable; bind it to a checked local first",
      "SMITHERS1708",
    );
  };

  const emitArguments = (nodes: readonly ts.Expression[]): void => {
    for (const argument of nodes) {
      if (ts.isSpreadElement(argument)) {
        if (containsMarker(argument)) emit(argument.expression);
        else units.push({ kind: "spread", node: argument });
      } else {
        emit(argument);
      }
    }
  };

  const emit = (node: ts.Expression): void => {
    if (ts.isIdentifier(node) && markersByName.has(node.text)) {
      units.push({ kind: "construct", info: markersByName.get(node.text)! });
      return;
    }
    if (!containsMarker(node)) {
      units.push({ kind: "operand", node });
      return;
    }
    if (ts.isParenthesizedExpression(node)) {
      emit(node.expression);
      return;
    }
    if (ts.isAsExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) {
      emit(node.expression);
      return;
    }
    if (ts.isCallExpression(node)) {
      if (node.questionDotToken) reject("a value expression cannot preserve evaluation order inside an optional call chain");
      if (containsMarker(node.expression)) emit(node.expression);
      else noteCallee(node.expression);
      emitArguments(node.arguments);
      return;
    }
    if (ts.isNewExpression(node)) {
      if (containsMarker(node.expression)) emit(node.expression);
      else noteCallee(node.expression);
      emitArguments(node.arguments ?? []);
      return;
    }
    if (ts.isBinaryExpression(node)) {
      const operator = node.operatorToken.kind;
      const markerInRight = containsMarker(node.right);
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken || operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken) {
        if (markerInRight) reject("a value expression on a short-circuit right side cannot preserve checked evaluation order");
        emit(node.left);
        units.push({ kind: "operand", node: node.right });
        return;
      }
      if (operator === ts.SyntaxKind.EqualsToken) {
        if (!markerInRight || containsMarker(node.left)) {
          reject("a value expression is only recoverable on the right of a plain assignment to a local name");
        }
        if (!ts.isIdentifier(node.left)) {
          reject("a value expression assigned through a member target cannot preserve checked evaluation order");
        }
        emit(node.right);
        return;
      }
      if (isCompoundAssignmentOperator(operator)) {
        reject("a value expression inside a compound assignment reads its target out of order");
      }
      emit(node.left);
      emit(node.right);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      if (containsMarker(node.whenTrue) || containsMarker(node.whenFalse)) {
        reject("a value expression inside a conditional branch cannot preserve checked evaluation order");
      }
      emit(node.condition);
      units.push({ kind: "operand", node: node.whenTrue });
      units.push({ kind: "operand", node: node.whenFalse });
      return;
    }
    if (ts.isPrefixUnaryExpression(node)) {
      if (node.operator === ts.SyntaxKind.PlusPlusToken || node.operator === ts.SyntaxKind.MinusMinusToken) {
        reject("a value expression inside an update expression cannot preserve checked evaluation order");
      }
      emit(node.operand);
      return;
    }
    if (ts.isTypeOfExpression(node) || ts.isVoidExpression(node) || ts.isAwaitExpression(node)) {
      emit(node.expression);
      return;
    }
    if (ts.isPropertyAccessExpression(node)) {
      if (node.questionDotToken) reject("a value expression cannot preserve evaluation order inside an optional chain");
      emit(node.expression);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) reject("a value expression cannot preserve evaluation order inside an optional chain");
      emit(node.expression);
      emit(node.argumentExpression);
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) {
          if (containsMarker(element)) emit(element.expression);
          else units.push({ kind: "spread", node: element });
        } else if (!ts.isOmittedExpression(element)) {
          emit(element);
        }
      }
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name)) {
            if (containsMarker(property.name)) {
              reject("a value expression inside a computed property name is not recovered by this POC");
            }
            units.push({ kind: "operand", node: property.name.expression });
          }
          emit(property.initializer);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          units.push({ kind: "shorthand", node: property });
        } else if (ts.isSpreadAssignment(property)) {
          if (containsMarker(property)) {
            reject("a value expression inside an object spread is not recovered by this POC");
          }
          units.push({ kind: "spread", node: property });
        } else if (containsMarker(property)) {
          reject("a value expression in this object member placement is not recovered by this POC");
        }
        // Marker-free methods/accessors only create closures, without effects.
      }
      return;
    }
    reject(`a value expression inside this ${ts.SyntaxKind[node.kind]} placement cannot preserve checked evaluation order in this POC`);
  };

  // Root per statement kind.
  let insertionOffset = host.getStart(maskedFile);
  const earlierDeclaratorNames: string[] = [];
  if (ts.isExpressionStatement(host)) {
    emit(host.expression);
  } else if (ts.isReturnStatement(host)) {
    if (!host.expression || !containsMarker(host.expression)) reject("internal: marker missing from return");
    emit(host.expression!);
  } else if (ts.isThrowStatement(host)) {
    emit(host.expression);
  } else if (ts.isVariableStatement(host)) {
    const declarations = host.declarationList.declarations;
    let markerIndex = -1;
    for (let index = 0; index < declarations.length; index++) {
      const initializer = declarations[index]!.initializer;
      if (initializer && containsMarker(initializer)) {
        markerIndex = index;
        break;
      }
      if (containsMarker(declarations[index]!)) {
        reject("a value expression inside a binding pattern or type position is not recovered by this POC");
      }
    }
    if (markerIndex < 0) reject("internal: marker missing from declaration");
    for (let index = 0; index < markerIndex; index++) {
      const declaration = declarations[index]!;
      if (declaration.initializer && !isPureOperand(declaration.initializer)) {
        reject("earlier declarators with effectful initializers cannot be reordered around a value expression");
      }
      earlierDeclaratorNames.push(...boundNames(declaration.name));
    }
    emit(declarations[markerIndex]!.initializer!);
  } else if (ts.isIfStatement(host)) {
    if (!containsMarker(host.expression)) {
      reject("a value expression in this branch placement needs a braced branch to receive checked hoists");
    }
    emit(host.expression);
    // When this if statement is itself the control of a bounded
    // missing-initializer host, hoists must precede the host statement to
    // keep the recovered adjacency intact.
    insertionOffset = boundedHostInsertionOffset(host, maskedFile) ?? insertionOffset;
  } else if (ts.isSwitchStatement(host)) {
    if (!containsMarker(host.expression)) {
      reject("a value expression inside a case label cannot preserve checked selection order");
    }
    emit(host.expression);
    insertionOffset = boundedHostInsertionOffset(host, maskedFile) ?? insertionOffset;
  } else {
    reject(`a value expression inside this ${ts.SyntaxKind[host.kind]} statement is not recovered by this POC`);
  }

  if (earlierDeclaratorNames.length > 0) {
    // Everything hoisted before the statement loses access to names the
    // statement itself declares; any such reference would become a TDZ read.
    let lastConstruct = -1;
    for (let index = 0; index < units.length; index++) {
      if (units[index]!.kind === "construct") lastConstruct = index;
    }
    for (let index = 0; index <= lastConstruct; index++) {
      const unit = units[index]!;
      const hoistedText = unit.kind === "construct"
        ? unit.info.text
        : unit.kind === "operand" && !isPureOperand(unit.node)
          ? maskedFile.text.slice(unit.node.getStart(maskedFile), unit.node.end)
          : unit.kind === "shorthand"
            ? unit.node.name.text
            : undefined;
      if (hoistedText !== undefined &&
        earlierDeclaratorNames.some((name) => textReferencesName(hoistedText, name))) {
        reject("a hoisted value expression or operand may not reference a name declared earlier in the same statement");
      }
    }
  }

  return { insertionOffset, units, assumptions };
}

function textReferencesName(text: string, name: string): boolean {
  return scanTokens(text).some((token) => token.kind === ts.SyntaxKind.Identifier && token.text === name);
}

function boundNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isBindingElement(node) && ts.isIdentifier(node.name)) names.push(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(name);
  return names;
}

function boundedHostInsertionOffset(control: ts.Statement, maskedFile: ts.SourceFile): number | undefined {
  const siblings = control.parent ? statementListOf(control.parent) : undefined;
  if (!siblings) return undefined;
  const index = siblings.indexOf(control);
  const previous = siblings[index - 1];
  if (!previous) return undefined;
  if (ts.isVariableStatement(previous)) {
    const declarations = previous.declarationList.declarations;
    const single = declarations.length === 1 ? declarations[0] : undefined;
    if (single && ts.isIdentifier(single.name) && single.initializer &&
      ts.isIdentifier(single.initializer) && single.initializer.pos === single.initializer.end) {
      return previous.getStart(maskedFile);
    }
  }
  if (ts.isReturnStatement(previous) && previous.expression && ts.isIdentifier(previous.expression) &&
    previous.expression.pos === previous.expression.end) {
    return previous.getStart(maskedFile);
  }
  return undefined;
}

function isCompoundAssignmentOperator(operator: ts.SyntaxKind): boolean {
  switch (operator) {
    case ts.SyntaxKind.PlusEqualsToken:
    case ts.SyntaxKind.MinusEqualsToken:
    case ts.SyntaxKind.AsteriskEqualsToken:
    case ts.SyntaxKind.AsteriskAsteriskEqualsToken:
    case ts.SyntaxKind.SlashEqualsToken:
    case ts.SyntaxKind.PercentEqualsToken:
    case ts.SyntaxKind.LessThanLessThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken:
    case ts.SyntaxKind.AmpersandEqualsToken:
    case ts.SyntaxKind.BarEqualsToken:
    case ts.SyntaxKind.CaretEqualsToken:
    case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
    case ts.SyntaxKind.BarBarEqualsToken:
    case ts.SyntaxKind.QuestionQuestionEqualsToken:
      return true;
    default:
      return false;
  }
}

function editsForHostPlan(
  plan: HostPlan,
  maskedFile: ts.SourceFile,
  allocator: IdentifierAllocator,
  labeledOut: RecoveredLabeledValue[],
  loopOut: RecoveredLoopValue[],
): Edit[] {
  const { units } = plan;
  let lastConstruct = -1;
  for (let index = 0; index < units.length; index++) {
    if (units[index]!.kind === "construct") lastConstruct = index;
  }
  if (lastConstruct < 0) {
    throw new Reject("SMITHERS1707", "internal: host plan lost its construct");
  }

  const hoistPieces: EditPiece[] = [];
  const replacements: Edit[] = [];

  for (let index = 0; index <= lastConstruct; index++) {
    const unit = units[index]!;
    if (unit.kind === "spread") {
      throw new Reject(
        "SMITHERS1707",
        "a spread evaluated before a value expression cannot be reordered without changing iteration timing",
      );
    }
    if (unit.kind === "operand") {
      if (isPureOperand(unit.node)) continue;
      const start = unit.node.getStart(maskedFile);
      const end = unit.node.end;
      const temporary = allocator.allocate("operand");
      hoistPieces.push(
        { kind: "glue", text: `const ${temporary} = `, anchor: start },
        { kind: "verbatim", start, end },
        { kind: "glue", text: ";\n", anchor: end - 1 },
      );
      replacements.push({
        start,
        end,
        pieces: [{ kind: "glue", text: temporary, anchor: start }],
      });
      continue;
    }
    if (unit.kind === "shorthand") {
      const nameStart = unit.node.name.getStart(maskedFile);
      const nameEnd = unit.node.name.end;
      const temporary = allocator.allocate("operand");
      hoistPieces.push(
        { kind: "glue", text: `const ${temporary} = `, anchor: nameStart },
        { kind: "verbatim", start: nameStart, end: nameEnd },
        { kind: "glue", text: ";\n", anchor: nameEnd - 1 },
      );
      replacements.push({
        start: nameStart,
        end: nameEnd,
        pieces: [
          { kind: "verbatim", start: nameStart, end: nameEnd },
          { kind: "glue", text: `: ${temporary}`, anchor: nameStart },
        ],
      });
      continue;
    }
    // Construct: hoist the authored construct text into the bounded
    // initializer host form the checked join planner already lowers.
    const { extent } = unit.info;
    const temporary = allocator.allocate("expr_value");
    if (extent.label?.loop) {
      // A value loop wraps the authored labeled loop in a compiler-labeled
      // block: `break :label value` sites target the outer block (skipping
      // the else), while plain labeled breaks and loop completion fall into
      // the else block, which becomes the completion value.
      const hostMarker = allocator.allocate("labeled");
      const doneLabel = allocator.allocate("loop_done");
      const loop = extent.label.loop;
      hoistPieces.push({ kind: "glue", text: `${doneLabel}: { `, anchor: extent.start });
      let cursor = extent.start;
      for (const site of extent.label.sites) {
        if (site.breakStart > cursor) hoistPieces.push({ kind: "verbatim", start: cursor, end: site.breakStart });
        hoistPieces.push({ kind: "glue", text: "{ ", anchor: site.breakStart });
        hoistPieces.push({ kind: "verbatim", start: site.valueStart, end: site.valueEnd });
        hoistPieces.push({ kind: "glue", text: `; break ${doneLabel}; }`, anchor: site.valueEnd - 1 });
        cursor = site.valueEnd;
      }
      if (cursor < loop.bodyEnd) hoistPieces.push({ kind: "verbatim", start: cursor, end: loop.bodyEnd });
      hoistPieces.push({ kind: "glue", text: "\n{ ", anchor: loop.elseStart });
      hoistPieces.push({ kind: "verbatim", start: loop.elseStart, end: loop.elseEnd });
      hoistPieces.push({ kind: "glue", text: "; } }", anchor: loop.elseEnd - 1 });
      hoistPieces.push({
        kind: "glue",
        text: `\nconst ${temporary} = ${hostMarker};\n`,
        anchor: extent.start,
      });
      loopOut.push({
        loopLabelStart: extent.start,
        markerName: hostMarker,
        valueStarts: extent.label.sites.map((site) => site.valueStart),
        elseStart: loop.elseStart,
      });
    } else if (extent.label) {
      // A labeled value block becomes a parseable labeled statement whose
      // `break :label value` sites turn into `{ value; break label; }`,
      // followed by a marker-initialized host the planner replaces with the
      // typed join temporary.
      const hostMarker = allocator.allocate("labeled");
      let cursor = extent.start;
      for (const site of extent.label.sites) {
        if (site.breakStart > cursor) hoistPieces.push({ kind: "verbatim", start: cursor, end: site.breakStart });
        hoistPieces.push({ kind: "glue", text: "{ ", anchor: site.breakStart });
        hoistPieces.push({ kind: "verbatim", start: site.valueStart, end: site.valueEnd });
        hoistPieces.push({ kind: "glue", text: `; break ${extent.label.name}; }`, anchor: site.valueEnd - 1 });
        cursor = site.valueEnd;
      }
      if (cursor < extent.end) hoistPieces.push({ kind: "verbatim", start: cursor, end: extent.end });
      hoistPieces.push({
        kind: "glue",
        text: `\nconst ${temporary} = ${hostMarker};\n`,
        anchor: extent.start,
      });
      labeledOut.push({
        labelStart: extent.start,
        markerName: hostMarker,
        valueStarts: extent.label.sites.map((site) => site.valueStart),
      });
    } else {
      hoistPieces.push(
        { kind: "glue", text: `const ${temporary} = `, anchor: extent.start },
        { kind: "verbatim", start: extent.start, end: extent.end },
        { kind: "glue", text: ";\n", anchor: extent.end - 1 },
      );
    }
    replacements.push({
      start: extent.start,
      end: extent.end,
      pieces: [{ kind: "glue", text: temporary, anchor: extent.start }],
    });
  }

  return [
    { start: plan.insertionOffset, end: plan.insertionOffset, pieces: hoistPieces },
    ...replacements,
  ];
}

interface ConditionalRejection {
  readonly start: number;
  readonly message: string;
}

interface ConditionalPlan {
  readonly edits: readonly Edit[];
  readonly rejections: readonly ConditionalRejection[];
  readonly count: number;
}

/** Index of the token closing the group opened at `openIndex`, if balanced. */
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

/**
 * Header of `if (declaration; condition)`. The separating `;` is only counted
 * at parenthesis depth 1 and brace depth 0, so a `;` inside a nested call,
 * arrow body, or object literal never splits the header.
 */
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

/**
 * End offset of a whole `if`/`else if`/`else` chain, proven only when every
 * branch is braced. A braceless branch has no textually provable extent, so
 * the construct is refused rather than scoped by guesswork.
 */
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

/**
 * Recover `if (const user = cache.get(id); user !== null) { ... }`.
 *
 * Stock TypeScript cannot parse the form at all, so it is rewritten before
 * parsing into the equivalent scoped shape
 * `{ const user = cache.get(id); if (user !== null) { ... } }`. The synthetic
 * block is what scopes the binding to the conditional construct: it is opened
 * before the `if` and closed after the last `else` branch, so both the `then`
 * and every `else` branch see the binding and nothing after the construct does.
 *
 * Provisional semantics (POC evidence, not a locked decision): the binding is
 * visible in `else`/`else if` branches, matching Go's `if v := f(); cond` and
 * the scoping the block rewrite can actually prove. A specification that wants
 * `else` to be outside the binding's scope needs a different lowering.
 *
 * Everything whose scoping cannot be proven textually fails closed: a braceless
 * branch (no provable extent), `var` (hoists out of the block), a header
 * without exactly one depth-1 `;`, an empty declaration or condition, and any
 * unbalanced chain.
 */
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
    // No depth-1 separator: an ordinary TypeScript `if`, untouched.
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
      reject("a conditional declaration requires braced `{ ... }` branches so the binding's scope is provable");
      continue;
    }
    // Nested candidates are found in a later round, after the outer rewrite
    // has moved its text; claiming both at once would produce overlapping
    // edits over the same span.
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
    // Split the current-source slice along the previous runs so authored
    // provenance never crosses previous glue.
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
