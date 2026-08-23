import * as ts from "typescript-js";
import { scanTokens as scanRecoveryTokens } from "./recover.ts";

export interface ControlFlowPlanDiagnostic {
  readonly code: "SMITHERS1705" | "SMITHERS1706" | "SMITHERS1714" | "SMITHERS1715" | "SMITHERS1716";
  readonly message: string;
  readonly start: number;
}

export type ControlFlowExpressionHost = ts.VariableStatement | ts.ReturnStatement;
export type ControlFlowValueExit = ts.ExpressionStatement | ts.ThrowStatement;

export interface IfExpressionPlan {
  readonly kind: "if";
  readonly host: ControlFlowExpressionHost;
  readonly control: ts.IfStatement;
  readonly consequent: ControlFlowValueExit;
  readonly alternate: ControlFlowValueExit;
}

export interface SwitchExpressionClausePlan {
  readonly clause: ts.CaseOrDefaultClause;
  readonly exit: ControlFlowValueExit;
}

export interface SwitchExpressionPlan {
  readonly kind: "switch";
  readonly host: ControlFlowExpressionHost;
  readonly control: ts.SwitchStatement;
  readonly clauses: readonly SwitchExpressionClausePlan[];
}

/** One rewritten `break :label value` site: `{ value; break label; }`. */
export interface LabeledBlockValueSite {
  readonly block: ts.Block;
  readonly value: ts.ExpressionStatement;
  readonly jump: ts.BreakStatement;
}

/**
 * A labeled block value construct. Unlike if/switch plans, the pre-parse
 * recovery places the labeled statement FIRST and a marker-initialized host
 * declaration directly after it, so the plan is keyed by the control.
 */
export interface LabeledBlockPlan {
  readonly kind: "labeled-block";
  readonly host: ts.VariableStatement;
  readonly control: ts.LabeledStatement;
  readonly sites: readonly LabeledBlockValueSite[];
}

/**
 * A labeled loop expression: the pre-parse recovery wraps the authored loop
 * in a compiler-labeled block whose second statement holds the `else`
 * completion value; `break :label value` sites target the outer block.
 */
export interface LoopValuePlan {
  readonly kind: "loop";
  readonly host: ts.VariableStatement;
  /** The compiler-labeled wrapper block statement. */
  readonly control: ts.LabeledStatement;
  /** The authored labeled loop inside the wrapper. */
  readonly loop: ts.LabeledStatement;
  readonly sites: readonly LabeledBlockValueSite[];
  readonly elseBlock: ts.Block;
  readonly elseValue: ts.ExpressionStatement;
}

export type ControlFlowExpressionPlan =
  | IfExpressionPlan
  | SwitchExpressionPlan
  | LabeledBlockPlan
  | LoopValuePlan;

/**
 * A labeled value construct recovered by the pre-parse pass, located by
 * derived offsets. Only constructs named here are claimed; authored labeled
 * statements are never reinterpreted.
 */
export interface DerivedLabeledValue {
  readonly labelStart: number;
  readonly markerName: string;
  readonly valueStarts: readonly number[];
}

export interface DerivedLoopValue {
  readonly loopLabelStart: number;
  readonly markerName: string;
  readonly valueStarts: readonly number[];
  readonly elseStart: number;
}

export interface ControlFlowPlanCollection {
  /** Keyed by the FIRST statement of the recovered pair. */
  readonly byHost: ReadonlyMap<ts.Statement, ControlFlowExpressionPlan>;
  readonly byControl: ReadonlyMap<ts.Statement, ControlFlowExpressionPlan>;
  readonly diagnostics: readonly ControlFlowPlanDiagnostic[];
  readonly recoveredKeywordStarts: ReadonlySet<number>;
  /** Labeled statements owned by the labeled-value recovery, plans or errors. */
  readonly claimedLabels: ReadonlySet<ts.LabeledStatement>;
  /** Default-less switch plans whose closed-union coverage was proven. */
  readonly exhaustiveSwitches: ReadonlySet<ts.SwitchStatement>;
}

interface ScannedToken {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

// Template- and regex-aware: a `${...}` substitution must not skew the token
// adjacency this planner's host recognition relies on.
const scan = (source: string): readonly ScannedToken[] => scanRecoveryTokens(source);

const isMissingExpression = (node: ts.Expression | undefined): boolean =>
  node !== undefined && ts.isIdentifier(node) && node.pos === node.end;

const isExpressionHost = (
  statement: ts.Statement,
  previousToken: ScannedToken | undefined,
  source: string,
  controlStart: number,
): statement is ControlFlowExpressionHost => {
  if (ts.isReturnStatement(statement)) {
    return previousToken?.text === "return" && isMissingExpression(statement.expression) &&
      !/[\n\r\u2028\u2029]/.test(source.slice(previousToken.end, controlStart));
  }
  if (!ts.isVariableStatement(statement) || previousToken?.text !== "=") return false;
  const declarations = statement.declarationList.declarations;
  return declarations.length === 1 && ts.isIdentifier(declarations[0]!.name) &&
    isMissingExpression(declarations[0]!.initializer);
};

const finalValueExit = (statement: ts.Statement): ControlFlowValueExit | undefined => {
  if (ts.isExpressionStatement(statement) || ts.isThrowStatement(statement)) return statement;
  if (!ts.isBlock(statement) || statement.statements.length === 0) return undefined;
  const final = statement.statements[statement.statements.length - 1]!;
  return ts.isExpressionStatement(final) || ts.isThrowStatement(final) ? final : undefined;
};

const branchMessage = (kind: "if" | "switch"): string =>
  `${kind} expression branches must end in a value expression or throw statement`;

const isIterationStatement = (node: ts.Node): node is ts.IterationStatement =>
  ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isForStatement(node) ||
  ts.isForInStatement(node) || ts.isForOfStatement(node);

const isInside = (node: ts.Node, boundary: ts.Node): boolean => {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === boundary) return true;
    current = current.parent;
  }
  return false;
};

/**
 * A value-producing control construct cannot complete through an authored
 * jump which bypasses its selected value. Jumps wholly contained by a nested
 * ordinary loop/switch remain valid; jumps targeting this switch or an outer
 * construct do not.
 */
const escapingJump = (
  control: ts.IfStatement | ts.SwitchStatement,
): ts.BreakStatement | ts.ContinueStatement | undefined => {
  let escaped: ts.BreakStatement | ts.ContinueStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (escaped) return;
    if (node !== control && ts.isFunctionLike(node)) return;
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      if (node.label) {
        escaped = node;
        return;
      }
      let target: ts.Node | undefined = node.parent;
      while (target && !ts.isFunctionLike(target)) {
        if (isIterationStatement(target) || (ts.isBreakStatement(node) && ts.isSwitchStatement(target))) break;
        target = target.parent;
      }
      if (!target || target === control || !isInside(target, control)) {
        escaped = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(control);
  return escaped;
};

/**
 * TypeScript's recovery parser retains an expression-form `if`/`switch` as a
 * statement immediately after a zero-width missing initializer/return value.
 * This pass recognizes only that exact recovery shape and turns it into a
 * checked evaluation-order plan. Everything else remains a hard diagnostic.
 */
export function collectControlFlowExpressionPlans(
  source: string,
  sourceFile: ts.SourceFile,
  labeledValues: readonly DerivedLabeledValue[] = [],
  loopValues: readonly DerivedLoopValue[] = [],
  checker?: ts.TypeChecker,
): ControlFlowPlanCollection {
  const tokens = scan(source);
  const previousTokenAt = (position: number): ScannedToken | undefined => {
    let previous: ScannedToken | undefined;
    for (const token of tokens) {
      if (token.start >= position) break;
      previous = token;
    }
    return previous;
  };
  const byHost = new Map<ts.Statement, ControlFlowExpressionPlan>();
  const byControl = new Map<ts.Statement, ControlFlowExpressionPlan>();
  const diagnostics: ControlFlowPlanDiagnostic[] = [];
  const recoveredKeywordStarts = new Set<number>();
  const claimedLabels = new Set<ts.LabeledStatement>();
  const exhaustiveSwitches = new Set<ts.SwitchStatement>();

  const addDiagnostic = (node: ts.Node, code: ControlFlowPlanDiagnostic["code"], message: string): void => {
    diagnostics.push({ code, message, start: node.getStart(sourceFile) });
  };

  const inspectNode = (node: ts.Node): void => {
    if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) {
      inspectSequence(node.statements);
      return;
    }
    if (ts.isCaseClause(node)) {
      inspectNode(node.expression);
      inspectSequence(node.statements);
      return;
    }
    if (ts.isDefaultClause(node)) {
      inspectSequence(node.statements);
      return;
    }
    ts.forEachChild(node, inspectNode);
  };

  const inspectSequence = (statements: readonly ts.Statement[]): void => {
    for (let index = 0; index < statements.length; index += 1) {
      const host = statements[index]!;
      const control = statements[index + 1];
      if (control && (ts.isIfStatement(control) || ts.isSwitchStatement(control))) {
        const controlStart = control.getStart(sourceFile);
        const keyword = ts.isIfStatement(control) ? "if" : "switch";
        if (source.slice(controlStart, controlStart + keyword.length) === keyword &&
          isExpressionHost(host, previousTokenAt(controlStart), source, controlStart)) {
          recoveredKeywordStarts.add(controlStart);
          const jump = escapingJump(control);
          if (jump) {
            addDiagnostic(
              jump,
              "SMITHERS1706",
              `${ts.isBreakStatement(jump) ? "break" : "continue"} may not escape a value-producing ${keyword} expression`,
            );
          }
          if (ts.isIfStatement(control)) {
            const consequent = finalValueExit(control.thenStatement);
            const alternate = control.elseStatement ? finalValueExit(control.elseStatement) : undefined;
            if (!control.elseStatement) {
              addDiagnostic(control, "SMITHERS1705", "a value-producing if expression requires an else branch");
            } else if (!consequent) {
              addDiagnostic(control.thenStatement, "SMITHERS1705", branchMessage("if"));
            } else if (!alternate) {
              addDiagnostic(control.elseStatement, "SMITHERS1705", branchMessage("if"));
            } else if (!jump) {
              const plan: IfExpressionPlan = { kind: "if", host, control, consequent, alternate };
              byHost.set(host, plan);
              byControl.set(control, plan);
            }
          } else {
            const clauses: SwitchExpressionClausePlan[] = [];
            let valid = true;
            let hasDefault = false;
            for (const clause of control.caseBlock.clauses) {
              if (ts.isDefaultClause(clause)) hasDefault = true;
              const final = clause.statements[clause.statements.length - 1];
              const exit = final && (ts.isExpressionStatement(final) || ts.isThrowStatement(final))
                ? final
                : undefined;
              if (!exit) {
                valid = false;
                addDiagnostic(clause, "SMITHERS1705", branchMessage("switch"));
              } else {
                clauses.push({ clause, exit });
              }
            }
            if (!hasDefault) {
              const coverage = checker ? closedUnionCoverage(control, checker) : undefined;
              if (!coverage) {
                valid = false;
                addDiagnostic(control, "SMITHERS1705", "a switch expression requires a default clause until closed-union exhaustiveness is proven");
              } else if (coverage.unprovable) {
                valid = false;
                addDiagnostic(control, "SMITHERS1716", "a closed-union switch expression has non-literal case labels, so exhaustiveness cannot be proven; add a default clause");
              } else if (coverage.missing.length > 0) {
                valid = false;
                addDiagnostic(control, "SMITHERS1716", `a closed-union switch expression must be exhaustive; missing ${coverage.missing.join(", ")}`);
              }
            }
            if (control.caseBlock.clauses.length === 0) {
              valid = false;
              addDiagnostic(control, "SMITHERS1705", "a switch expression requires at least one value-producing clause");
            }
            if (valid && !jump) {
              const plan: SwitchExpressionPlan = { kind: "switch", host, control, clauses };
              byHost.set(host, plan);
              byControl.set(control, plan);
              if (!hasDefault) exhaustiveSwitches.add(control);
            }
          }
          // The selected branches may themselves contain recovered value
          // control flow. The adjacent host/control pair is consumed here, so
          // descend explicitly before skipping it in this statement list.
          inspectNode(control);
          index += 1;
          continue;
        }
      }
      inspectNode(host);
    }
  };
  inspectNode(sourceFile);

  for (const derived of labeledValues) {
    resolveLabeledPlan(derived, sourceFile, byHost, byControl, claimedLabels, addDiagnostic);
  }
  for (const derived of loopValues) {
    resolveLoopPlan(derived, sourceFile, byHost, byControl, claimedLabels, addDiagnostic);
  }

  diagnostics.sort((left, right) => left.start - right.start || (left.code < right.code ? -1 : 1));
  return { byHost, byControl, diagnostics, recoveredKeywordStarts, claimedLabels, exhaustiveSwitches };
}

interface ClosedUnionCoverage {
  readonly missing: readonly string[];
  readonly unprovable: boolean;
}

function literalMemberKey(type: ts.Type, checker: ts.TypeChecker): string | undefined {
  if ((type.flags & ts.TypeFlags.StringLiteral) !== 0) {
    return `s:${(type as ts.StringLiteralType).value}`;
  }
  if ((type.flags & ts.TypeFlags.NumberLiteral) !== 0) {
    return `n:${(type as ts.NumberLiteralType).value}`;
  }
  if ((type.flags & ts.TypeFlags.BooleanLiteral) !== 0) {
    return `b:${checker.typeToString(type)}`;
  }
  return undefined;
}

/**
 * Case coverage for a checker-known closed literal union scrutinee. Switch
 * selection is `===`, so literal-value keys are exactly the runtime match
 * semantics (string-enum members equal their literal values). Returns
 * undefined when the scrutinee is not a closed literal union, keeping the
 * existing default-required rule for open types.
 */
function closedUnionCoverage(control: ts.SwitchStatement, checker: ts.TypeChecker): ClosedUnionCoverage | undefined {
  const scrutinee = checker.getTypeAtLocation(control.expression);
  const members = scrutinee.isUnion() ? scrutinee.types : [scrutinee];
  const memberKeys = new Map<string, ts.Type>();
  for (const member of members) {
    const key = literalMemberKey(member, checker);
    if (key === undefined) return undefined;
    memberKeys.set(key, member);
  }
  let unprovable = false;
  const covered = new Set<string>();
  for (const clause of control.caseBlock.clauses) {
    if (!ts.isCaseClause(clause)) continue;
    const key = literalMemberKey(checker.getTypeAtLocation(clause.expression), checker);
    if (key === undefined) {
      unprovable = true;
      continue;
    }
    covered.add(key);
  }
  const missing = [...memberKeys.entries()]
    .filter(([key]) => !covered.has(key))
    .map(([, member]) => checker.typeToString(member))
    .sort();
  return { missing, unprovable: unprovable && missing.length > 0 };
}

function findLabeledStatementAt(sourceFile: ts.SourceFile, labelStart: number): ts.LabeledStatement | undefined {
  let found: ts.LabeledStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (found || node.end <= labelStart || node.getStart(sourceFile) > labelStart) return;
    if (ts.isLabeledStatement(node) && node.label.getStart(sourceFile) === labelStart) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return found;
}

/**
 * Resolve one recovered labeled block value against the parsed derived tree
 * and validate every rule that keeps the join sound: sites must be the exact
 * rewritten `{ value; break label; }` blocks in the same function, no other
 * jump may target or escape the construct, and the block must be unable to
 * complete without producing a value.
 */
function resolveLabeledPlan(
  derived: DerivedLabeledValue,
  sourceFile: ts.SourceFile,
  byHost: Map<ts.Statement, ControlFlowExpressionPlan>,
  byControl: Map<ts.Statement, ControlFlowExpressionPlan>,
  claimedLabels: Set<ts.LabeledStatement>,
  addDiagnostic: (node: ts.Node, code: ControlFlowPlanDiagnostic["code"], message: string) => void,
): void {
  const control = findLabeledStatementAt(sourceFile, derived.labelStart);
  if (!control || !ts.isBlock(control.statement)) return; // recovery/parse mismatch: fail closed silently into SMITHERS1000
  claimedLabels.add(control);
  const labelName = control.label.text;

  const parent = control.parent;
  const siblings = parent && (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent) ||
    ts.isCaseClause(parent) || ts.isDefaultClause(parent))
    ? parent.statements
    : undefined;
  const hostStatement = siblings?.[siblings.indexOf(control) + 1];
  const host = hostStatement && ts.isVariableStatement(hostStatement) ? hostStatement : undefined;
  const hostDeclaration = host && host.declarationList.declarations.length === 1
    ? host.declarationList.declarations[0]
    : undefined;
  if (!host || !hostDeclaration || !hostDeclaration.initializer ||
    !ts.isIdentifier(hostDeclaration.initializer) || hostDeclaration.initializer.text !== derived.markerName) {
    addDiagnostic(control, "SMITHERS1714", "internal: a recovered labeled value block lost its host declaration; the construct is rejected");
    return;
  }

  const sites: LabeledBlockValueSite[] = [];
  let valid = true;
  for (const valueStart of derived.valueStarts) {
    const site = resolveLabeledSite(control, sourceFile, valueStart, labelName);
    if (!site) {
      addDiagnostic(control, "SMITHERS1714", "internal: a recovered labeled break value does not match its rewritten site; the construct is rejected");
      valid = false;
      continue;
    }
    if (functionBoundaryBetween(site.block, control)) {
      addDiagnostic(site.value, "SMITHERS1714", "a `break :label value` may not sit inside a nested function body");
      valid = false;
      continue;
    }
    sites.push(site);
  }

  const siteJumps = new Set<ts.BreakStatement>(sites.map((site) => site.jump));
  const escaping = labeledEscapeJump(control, labelName, siteJumps);
  if (escaping) {
    addDiagnostic(
      escaping,
      "SMITHERS1714",
      ts.isBreakStatement(escaping) && escaping.label?.text === labelName
        ? "a labeled value block may not complete through a plain `break label`; every exit must carry a value"
        : "a jump may not escape a labeled value block without carrying its value",
    );
    valid = false;
  }

  if (statementMayCompleteNormally(control.statement)) {
    addDiagnostic(control, "SMITHERS1714", "a labeled value block may complete without a value; end every path with `break :label value`, a throw, or a return");
    valid = false;
  }

  if (!valid || sites.length === 0) return;
  const plan: LabeledBlockPlan = { kind: "labeled-block", host, control, sites };
  byHost.set(control, plan);
  byControl.set(control, plan);
}

/**
 * Resolve one recovered loop value: the compiler wrapper label must contain
 * exactly the authored labeled loop and the else block, every value site must
 * target the wrapper from inside the loop's own function, and no authored
 * jump may escape the wrapper. Loop completion (including a plain labeled
 * break) flows into the else value, so no completion check applies.
 */
function resolveLoopPlan(
  derived: DerivedLoopValue,
  sourceFile: ts.SourceFile,
  byHost: Map<ts.Statement, ControlFlowExpressionPlan>,
  byControl: Map<ts.Statement, ControlFlowExpressionPlan>,
  claimedLabels: Set<ts.LabeledStatement>,
  addDiagnostic: (node: ts.Node, code: ControlFlowPlanDiagnostic["code"], message: string) => void,
): void {
  const loop = findLabeledStatementAt(sourceFile, derived.loopLabelStart);
  if (!loop || !isIterationStatement(loop.statement)) return; // recovery/parse mismatch: fail closed
  const wrapperBlock = loop.parent;
  const control = wrapperBlock?.parent;
  if (!wrapperBlock || !ts.isBlock(wrapperBlock) || !control || !ts.isLabeledStatement(control) ||
    wrapperBlock.statements.length !== 2 || wrapperBlock.statements[0] !== loop) {
    return; // recovery/parse mismatch: fail closed
  }
  claimedLabels.add(control);
  claimedLabels.add(loop);

  const elseStatement = wrapperBlock.statements[1]!;
  const elseBlock = ts.isBlock(elseStatement) ? elseStatement : undefined;
  const elseValue = elseBlock && elseBlock.statements.length === 1 ? elseBlock.statements[0] : undefined;
  if (!elseBlock || !elseValue || !ts.isExpressionStatement(elseValue) ||
    elseValue.getStart(sourceFile) !== derived.elseStart) {
    addDiagnostic(control, "SMITHERS1715", "internal: a recovered loop else value does not match its rewritten block; the construct is rejected");
    return;
  }

  const parent = control.parent;
  const siblings = parent && (ts.isBlock(parent) || ts.isSourceFile(parent) || ts.isModuleBlock(parent) ||
    ts.isCaseClause(parent) || ts.isDefaultClause(parent))
    ? parent.statements
    : undefined;
  const hostStatement = siblings?.[siblings.indexOf(control) + 1];
  const host = hostStatement && ts.isVariableStatement(hostStatement) ? hostStatement : undefined;
  const hostDeclaration = host && host.declarationList.declarations.length === 1
    ? host.declarationList.declarations[0]
    : undefined;
  if (!host || !hostDeclaration || !hostDeclaration.initializer ||
    !ts.isIdentifier(hostDeclaration.initializer) || hostDeclaration.initializer.text !== derived.markerName) {
    addDiagnostic(control, "SMITHERS1715", "internal: a recovered loop value lost its host declaration; the construct is rejected");
    return;
  }

  const wrapperLabel = control.label.text;
  const sites: LabeledBlockValueSite[] = [];
  let valid = true;
  for (const valueStart of derived.valueStarts) {
    const site = resolveLabeledSite(control, sourceFile, valueStart, wrapperLabel);
    if (!site) {
      addDiagnostic(control, "SMITHERS1715", "internal: a recovered loop break value does not match its rewritten site; the construct is rejected");
      valid = false;
      continue;
    }
    if (functionBoundaryBetween(site.block, control)) {
      addDiagnostic(site.value, "SMITHERS1715", "a `break :label value` may not sit inside a nested function body");
      valid = false;
      continue;
    }
    sites.push(site);
  }

  const siteJumps = new Set<ts.BreakStatement>(sites.map((site) => site.jump));
  const escaping = labeledEscapeJump(control, wrapperLabel, siteJumps);
  if (escaping) {
    addDiagnostic(escaping, "SMITHERS1715", "a jump may not escape a value loop without carrying its value");
    valid = false;
  }

  if (!valid) return;
  const plan: LoopValuePlan = { kind: "loop", host, control, loop, sites, elseBlock, elseValue };
  byHost.set(control, plan);
  byControl.set(control, plan);
}

function resolveLabeledSite(
  control: ts.LabeledStatement,
  sourceFile: ts.SourceFile,
  valueStart: number,
  labelName: string,
): LabeledBlockValueSite | undefined {
  let value: ts.ExpressionStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (value || node.end <= valueStart || node.getStart(sourceFile) > valueStart) return;
    if (ts.isExpressionStatement(node) && node.getStart(sourceFile) === valueStart &&
      node.expression.getStart(sourceFile) === valueStart) {
      value = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(control.statement);
  if (!value) return undefined;
  const block = value.parent;
  if (!block || !ts.isBlock(block) || block.statements.length !== 2 || block.statements[0] !== value) return undefined;
  const jump = block.statements[1]!;
  if (!ts.isBreakStatement(jump) || jump.label?.text !== labelName) return undefined;
  return { block, value, jump };
}

function functionBoundaryBetween(node: ts.Node, boundary: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && current !== boundary) {
    if (ts.isFunctionLike(current)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Find an authored jump which could bypass the labeled value join: a plain
 * `break label`/`continue label` targeting the construct, or any jump whose
 * target lies outside the construct. Jumps wholly contained by nested loops,
 * switches, or inner labeled statements remain valid.
 */
function labeledEscapeJump(
  control: ts.LabeledStatement,
  labelName: string,
  valueJumps: ReadonlySet<ts.BreakStatement>,
): ts.BreakStatement | ts.ContinueStatement | undefined {
  let escaped: ts.BreakStatement | ts.ContinueStatement | undefined;
  const visit = (node: ts.Node): void => {
    if (escaped) return;
    if (node !== control && ts.isFunctionLike(node)) return;
    if (ts.isBreakStatement(node) || ts.isContinueStatement(node)) {
      if (ts.isBreakStatement(node) && valueJumps.has(node)) return;
      if (node.label) {
        if (node.label.text === labelName) {
          escaped = node;
          return;
        }
        // A jump to another label is contained only when that labeled
        // statement lies inside this construct.
        let target: ts.Node | undefined = node.parent;
        while (target && target !== control && !ts.isFunctionLike(target)) {
          if (ts.isLabeledStatement(target) && target.label.text === node.label.text) return;
          target = target.parent;
        }
        escaped = node;
        return;
      }
      let target: ts.Node | undefined = node.parent;
      while (target && target !== control && !ts.isFunctionLike(target)) {
        if (isIterationStatement(target) || (ts.isBreakStatement(node) && ts.isSwitchStatement(target))) return;
        target = target.parent;
      }
      escaped = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(control.statement);
  return escaped;
}

/**
 * Conservative normal-completion analysis for the labeled value block.
 * Uncertain constructs count as completing, which fails closed into the
 * missing-value diagnostic.
 */
function statementMayCompleteNormally(statement: ts.Statement): boolean {
  if (ts.isReturnStatement(statement) || ts.isThrowStatement(statement) ||
    ts.isBreakStatement(statement) || ts.isContinueStatement(statement)) return false;
  if (ts.isBlock(statement)) {
    const meaningful = statement.statements.filter((child) => !ts.isEmptyStatement(child));
    if (meaningful.length === 0) return true;
    return statementMayCompleteNormally(meaningful[meaningful.length - 1]!);
  }
  if (ts.isIfStatement(statement)) {
    if (!statement.elseStatement) return true;
    return statementMayCompleteNormally(statement.thenStatement) ||
      statementMayCompleteNormally(statement.elseStatement);
  }
  if (ts.isTryStatement(statement)) {
    if (statement.finallyBlock && !statementMayCompleteNormally(statement.finallyBlock)) return false;
    const tryCompletes = statementMayCompleteNormally(statement.tryBlock);
    return statement.catchClause
      ? tryCompletes || statementMayCompleteNormally(statement.catchClause.block)
      : tryCompletes;
  }
  return true;
}

export function controlFlowValueExpression(exit: ControlFlowValueExit): ts.Expression | undefined {
  return ts.isExpressionStatement(exit) ? exit.expression : undefined;
}
