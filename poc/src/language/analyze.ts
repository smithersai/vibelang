import type {
  Analysis,
  CatchArm,
  Diagnostic,
  ErrorDeclaration,
  FunctionDeclaration,
  FunctionRows,
  RequirementBinding,
} from "./model";
import { lineAndColumn, matchPair, scanFunctionTail, tokenize, type Token } from "./syntax";

interface CallEdge {
  readonly callee: string;
  readonly offset: number;
  readonly mode: "try" | "catch" | "naked";
  readonly catchArms?: readonly CatchArm[];
}

interface FunctionFacts {
  readonly declaration: FunctionDeclaration;
  readonly directFailures: Set<string>;
  readonly directRequirements: Set<string>;
  readonly calls: CallEdge[];
}

interface MutableRows {
  failures: Set<string>;
  requirements: Set<string>;
}

export function analyzeSource(source: string): Analysis {
  const tokens = tokenize(source);
  const errors = parseErrors(source, tokens);
  const functions = parseFunctions(source, tokens);
  const errorNames = new Set(errors.map((error) => error.name));
  const functionNames = new Set(functions.map((fn) => fn.name));
  const facts = functions.map((declaration) =>
    collectFunctionFacts(tokens, declaration, errorNames, functionNames),
  );
  const rows = inferRows(facts);
  const pendingDiagnostics: Array<Omit<Diagnostic, "line" | "column">> = [];

  for (const fact of facts) {
    const inferred = rows.get(fact.declaration.name)!;
    for (const call of fact.calls) {
      const calleeRows = rows.get(call.callee)!;
      if (call.mode === "naked" && calleeRows.failures.size > 0) {
        pendingDiagnostics.push({
          severity: "error",
          code: "VIBE1001",
          message: `call to '${call.callee}' can fail with ${formatSet(calleeRows.failures)}; use try or catch`,
          start: call.offset,
        });
      }
      if (call.mode === "catch" && call.catchArms) {
        const covered = new Set(call.catchArms.map((arm) => arm.failure));
        const missing = difference(calleeRows.failures, covered);
        if (missing.size > 0) {
          pendingDiagnostics.push({
            severity: "error",
            code: "VIBE1002",
            message: `catch switch for '${call.callee}' is not exhaustive; missing ${formatSet(missing)}`,
            start: call.offset,
          });
        }
      }
    }

    const declared = fact.declaration.declaredFailures;
    if (declared) {
      const bodyFailures = inferBodyFailures(fact, rows);
      const undeclared = difference(bodyFailures, declared);
      if (undeclared.size > 0) {
        pendingDiagnostics.push({
          severity: "error",
          code: "VIBE1003",
          message: `'${fact.declaration.name}' throws undeclared failures ${formatSet(undeclared)}`,
          start: fact.declaration.start,
        });
      }
    }

    if (fact.declaration.exported && !declared && inferred.failures.size > 0) {
      pendingDiagnostics.push({
        severity: "warning",
        code: "VIBE1004",
        message: `exported function '${fact.declaration.name}' should pin its inferred failure row with throws`,
        start: fact.declaration.start,
      });
    }

    if (fact.declaration.exported) {
      const pinnedRequirements = new Set(
        fact.declaration.requirements.map((requirement) => requirement.capability),
      );
      const unpinned = difference(inferred.requirements, pinnedRequirements);
      if (unpinned.size > 0) {
        pendingDiagnostics.push({
          severity: "warning",
          code: "VIBE1005",
          message: `exported function '${fact.declaration.name}' should pin requirements ${formatSet(unpinned)}`,
          start: fact.declaration.start,
        });
      }
    }
  }

  checkProvidedScopes(tokens, rows, pendingDiagnostics);
  checkSurfaceCoverage(source, tokens, functions, pendingDiagnostics);

  const diagnostics = pendingDiagnostics.map((diagnostic) => ({
    ...diagnostic,
    ...lineAndColumn(source, diagnostic.start),
  }));
  const publicRows: Record<string, FunctionRows> = {};
  for (const [name, row] of rows) {
    publicRows[name] = {
      failures: [...row.failures].sort(),
      requirements: [...row.requirements].sort(),
    };
  }

  return { errors, functions, rows: publicRows, diagnostics };
}

export function parseErrors(source: string, tokens: readonly Token[]): ErrorDeclaration[] {
  const declarations: ErrorDeclaration[] = [];
  for (let index = 0; index < tokens.length - 2; index++) {
    if (tokens[index]!.text !== "error" || tokens[index + 1]!.kind !== "identifier") continue;
    if (tokens[index + 2]!.text !== "{") continue;
    const close = matchPair(tokens, index + 2);
    declarations.push({
      name: tokens[index + 1]!.text,
      fieldsSource: source.slice(tokens[index + 2]!.end, tokens[close]!.start),
      start: tokens[index]!.start,
      end: tokens[close]!.end,
    });
    index = close;
  }
  return declarations;
}

export function parseFunctions(source: string, tokens: readonly Token[]): FunctionDeclaration[] {
  const declarations: FunctionDeclaration[] = [];
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index]!.text !== "function") continue;
    const nameToken = tokens[index + 1];
    if (!nameToken || nameToken.kind !== "identifier") continue;
    let openParameters = index + 2;
    while (openParameters < tokens.length && tokens[openParameters]!.text !== "(") openParameters++;
    if (openParameters === tokens.length) continue;
    const closeParameters = matchPair(tokens, openParameters);
    const tail = scanFunctionTail(tokens, closeParameters);
    if (!tail) continue;
    const { bodyOpen, throwsIndex, usesIndex, bangIndex } = tail;
    const bodyClose = matchPair(tokens, bodyOpen);

    let declarationStart = index;
    let exported = false;
    let isAsync = false;
    for (let lookBehind = index - 1; lookBehind >= 0 && lookBehind >= index - 3; lookBehind--) {
      const text = tokens[lookBehind]!.text;
      if (text === "export") {
        exported = true;
        declarationStart = lookBehind;
      } else if (text === "async") {
        isAsync = true;
        declarationStart = lookBehind;
      } else if (text === "default") {
        declarationStart = lookBehind;
      } else {
        break;
      }
    }

    const declaredFailures = throwsIndex === -1
      ? undefined
      : new Set(
          tokens
            .slice(throwsIndex + 1, usesIndex === -1 ? bodyOpen : usesIndex)
            .filter((token) => token.kind === "identifier" && token.text !== "never")
            .map((token) => token.text),
        );

    declarations.push({
      name: nameToken.text,
      exported,
      async: isAsync,
      inferFailures: bangIndex !== -1,
      declaredFailures,
      requirements: usesIndex === -1 ? [] : parseRequirements(tokens, usesIndex + 1, bodyOpen),
      start: tokens[declarationStart]!.start,
      end: tokens[bodyClose]!.end,
      bodyStart: tokens[bodyOpen]!.end,
      bodyEnd: tokens[bodyClose]!.start,
    });
    index = bodyClose;
  }
  return declarations;
}

function parseRequirements(tokens: readonly Token[], start: number, end: number): RequirementBinding[] {
  const requirements: RequirementBinding[] = [];
  let index = start;
  while (index < end) {
    const binding = tokens[index];
    if (!binding || binding.kind !== "identifier" || tokens[index + 1]?.text !== ":") break;
    const capability = tokens[index + 2];
    if (!capability || capability.kind !== "identifier") break;
    requirements.push({ name: binding.text, capability: capability.text });
    index += 3;
    let nesting = 0;
    while (index < end) {
      const text = tokens[index]!.text;
      if (text === "<" || text === "(" || text === "[") nesting++;
      else if (text === ">" || text === ")" || text === "]") nesting--;
      if (text === "," && nesting === 0) {
        index++;
        break;
      }
      index++;
    }
  }
  return requirements;
}

function collectFunctionFacts(
  tokens: readonly Token[],
  declaration: FunctionDeclaration,
  errorNames: ReadonlySet<string>,
  functionNames: ReadonlySet<string>,
): FunctionFacts {
  const directFailures = new Set<string>();
  const directRequirements = new Set<string>(
    declaration.requirements.map((requirement) => requirement.capability),
  );
  const calls: CallEdge[] = [];
  const start = lowerBound(tokens, declaration.bodyStart);
  const end = lowerBound(tokens, declaration.bodyEnd);

  for (let index = start; index < end; index++) {
    if (tokens[index]!.text === "any") directRequirements.add("TypeScript");
    if (tokens[index]!.text === "eval" && tokens[index + 1]?.text === "(") {
      directRequirements.add("TypeScript");
    }
    if (tokens[index]!.text === "throw") {
      const possibleNew = tokens[index + 1]?.text === "new" ? index + 2 : index + 1;
      const failure = tokens[possibleNew]?.text;
      if (failure && errorNames.has(failure)) directFailures.add(failure);
    }

    const callee = tokens[index]!.text;
    if (!functionNames.has(callee) || tokens[index + 1]?.text !== "(") continue;
    const close = matchPair(tokens, index + 1);
    const catchIndex = tokens[close + 1]?.text === "catch" ? close + 1 : -1;
    const previous = tokens[index - 1]?.text;
    const previousPrevious = tokens[index - 2]?.text;
    const markedTry = previous === "try" || (previous === "await" && previousPrevious === "try");
    calls.push({
      callee,
      offset: tokens[index]!.start,
      mode: catchIndex !== -1 ? "catch" : markedTry ? "try" : "naked",
      catchArms: catchIndex === -1 ? undefined : parseCatchArms(tokens, catchIndex),
    });
  }

  // `any` in the signature has the same classification as `any` in the body.
  const declarationStart = lowerBound(tokens, declaration.start);
  for (let index = declarationStart; index < start; index++) {
    if (tokens[index]!.text === "any") directRequirements.add("TypeScript");
  }

  return { declaration, directFailures, directRequirements, calls };
}

function parseCatchArms(tokens: readonly Token[], catchIndex: number): CatchArm[] | undefined {
  let index = catchIndex + 1;
  if (tokens[index]?.text === "|") {
    index += 3; // | binding |
  }
  if (tokens[index]?.text !== "switch") return undefined;
  if (tokens[index + 1]?.text !== "(") return [];
  const closeCondition = matchPair(tokens, index + 1);
  const bodyOpen = closeCondition + 1;
  if (tokens[bodyOpen]?.text !== "{") return [];
  const bodyClose = matchPair(tokens, bodyOpen);
  const arms: CatchArm[] = [];
  let cursor = bodyOpen + 1;
  while (cursor < bodyClose) {
    if (tokens[cursor]!.text === ",") {
      cursor++;
      continue;
    }
    const failure = tokens[cursor];
    if (!failure || failure.kind !== "identifier" || tokens[cursor + 1]?.text !== "=>") break;
    const expressionStart = cursor + 2;
    const expressionEnd = findArmEnd(tokens, expressionStart, bodyClose);
    arms.push({
      failure: failure.text,
      rethrows: tokens[expressionStart]?.text === "throw",
    });
    cursor = expressionEnd + (tokens[expressionEnd]?.text === "," ? 1 : 0);
  }
  return arms;
}

function findArmEnd(tokens: readonly Token[], start: number, bodyClose: number): number {
  const expected: string[] = [];
  const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < bodyClose; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && text === ",") return index;
  }
  return bodyClose;
}

function inferRows(facts: readonly FunctionFacts[]): Map<string, MutableRows> {
  const rows = new Map<string, MutableRows>();
  for (const fact of facts) {
    rows.set(fact.declaration.name, {
      failures: new Set(fact.declaration.declaredFailures ?? fact.directFailures),
      requirements: new Set(fact.directRequirements),
    });
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts) {
      const row = rows.get(fact.declaration.name)!;
      const bodyFailures = inferBodyFailures(fact, rows);
      for (const failure of bodyFailures) {
        if (!row.failures.has(failure)) {
          row.failures.add(failure);
          changed = true;
        }
      }
      for (const call of fact.calls) {
        for (const requirement of rows.get(call.callee)!.requirements) {
          if (!row.requirements.has(requirement)) {
            row.requirements.add(requirement);
            changed = true;
          }
        }
      }
    }
  }
  return rows;
}

function checkSurfaceCoverage(
  source: string,
  tokens: readonly Token[],
  functions: readonly FunctionDeclaration[],
  diagnostics: Array<Omit<Diagnostic, "line" | "column">>,
): void {
  const containingFunction = (offset: number): FunctionDeclaration | undefined =>
    functions.find((fn) => offset >= fn.start && offset < fn.end);
  const moduleBindings = collectModuleBindings(tokens, containingFunction);
  for (const fn of functions) moduleBindings.add(fn.name);
  const bindings = new Map(
    functions.map((fn) => [fn, collectFunctionBindings(tokens, fn, moduleBindings)] as const),
  );

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (
      (token.text === "defer" || token.text === "errdefer") &&
      isDeferredDirective(tokens, index)
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE3003",
        message: `${token.text} is recognized but intentionally rejected by this POC; async/failure cleanup semantics need the real control-flow IR`,
        start: token.start,
      });
    }

    if (token.text === "if" && tokens[index + 1]?.text === "(") {
      const close = matchPair(tokens, index + 1);
      if (tokens[close + 1]?.text === "|") {
        diagnostics.push({
          severity: "error",
          code: "VIBE3001",
          message: "optional payload capture is recognized but not lowered by this POC",
          start: token.start,
        });
      } else if (
        ["=", "return", "=>"].includes(tokens[index - 1]?.text ?? "") &&
        tokens[close + 1]?.text === "{"
      ) {
        diagnostics.push({
          severity: "error",
          code: "VIBE3002",
          message: "block-valued if expressions require control-flow IR; this POC only lowers expression arms",
          start: token.start,
        });
      } else if (["=", "return", "=>"].includes(tokens[index - 1]?.text ?? "")) {
        const elseIndex = findTopLevelElse(tokens, close + 1);
        if (elseIndex !== -1 && tokens[elseIndex + 1]?.text === "if") {
          diagnostics.push({
            severity: "error",
            code: "VIBE3007",
            message: "chained else-if expressions are recognized but not lowered by this POC",
            start: token.start,
          });
        }
      }
    }

    if (
      token.text === "switch" &&
      ["=", "return", "=>"].includes(tokens[index - 1]?.text ?? "")
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE3004",
        message: "general switch expressions are recognized but only typed-failure catch switches are lowered in this POC",
        start: token.start,
      });
    }

    if (
      (token.text === "for" || token.text === "while") &&
      isExpressionPosition(tokens, index)
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE3006",
        message: `${token.text} expressions require control-flow IR and are not lowered by this POC`,
        start: token.start,
      });
    }

    const fn = containingFunction(token.start);
    if (
      ["process", "window", "document"].includes(token.text) &&
      fn &&
      !bindings.get(fn)?.has(token.text) &&
      !isPropertyName(tokens, index)
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE4001",
        message: `ambient host global '${token.text}' is unavailable; request a typed platform capability`,
        start: token.start,
      });
    }

    if (token.text === "import") {
      let cursor = index + 1;
      while (cursor < tokens.length && tokens[cursor]!.text !== ";") {
        if (tokens[cursor]!.kind === "string") {
          const moduleName = tokens[cursor]!.text.slice(1, -1);
          if (/^(node:|bun:|deno:)/.test(moduleName)) {
            diagnostics.push({
              severity: "warning",
              code: "VIBE4002",
              message: `runtime import '${moduleName}' adds the exact requirement Module<${JSON.stringify(moduleName)}>`,
              start: tokens[cursor]!.start,
            });
          }
          break;
        }
        cursor++;
      }
    }
  }

  // Make unsupported complex optional spellings fail loudly instead of being
  // silently emitted as subtly different TypeScript.
  for (let index = 0; index < tokens.length; index++) {
    if (
      tokens[index]!.text === "?" &&
      [":", "!"].includes(tokens[index - 1]?.text ?? "") &&
      ["<", "["].includes(tokens[index + 2]?.text ?? "")
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE3005",
        message: "this POC lowers only simple ?T optionals; generic/compound optional types are recognized but rejected",
        start: tokens[index]!.start,
      });
    }
    if (
      tokens[index]!.text === "." &&
      ["?", "?."].includes(tokens[index + 1]?.text ?? "") &&
      hasAmbiguousUnwrapLeft(tokens, index)
    ) {
      diagnostics.push({
        severity: "error",
        code: "VIBE3008",
        message: "asserted unwrap beside an unparenthesized operator is not lowered by this POC; parenthesize the operand",
        start: tokens[index]!.start,
      });
    }
  }

  void source;
}

function hasAmbiguousUnwrapLeft(tokens: readonly Token[], dotIndex: number): boolean {
  const expected: string[] = [];
  const openFor: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" };
  const operators = new Set([
    "+", "-", "*", "/", "%", "&&", "||", "??", "==", "===", "!=", "!==",
    "<", ">", "<=", ">=", "&", "|", "^", "<<", ">>", ">>>", "in", "instanceof",
    "await", "yield",
  ]);
  for (let index = dotIndex - 1; index >= 0; index--) {
    const text = tokens[index]!.text;
    if (openFor[text]) expected.push(openFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && operators.has(text)) return true;
    else if (
      expected.length === 0 &&
      ["=", ";", ",", "{", "}", ":", "return", "=>"].includes(text)
    ) return false;
  }
  return false;
}

function isDeferredDirective(tokens: readonly Token[], index: number): boolean {
  if (isPropertyName(tokens, index)) return false;
  const next = tokens[index + 1];
  if (!next || next.text === "(" || [";", ":", "=", ","].includes(next.text)) return false;
  return next.kind === "identifier" || next.kind === "string" || next.kind === "number" ||
    ["{", "[", "|", "!"].includes(next.text);
}

function isPropertyName(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1]?.text;
  const next = tokens[index + 1]?.text;
  if (previous === "." || previous === "?.") return true;
  if (next === ":") return true;
  return next === "(" && ["{", ",", ";"].includes(previous ?? "");
}

function isExpressionPosition(tokens: readonly Token[], index: number): boolean {
  const previous = tokens[index - 1]?.text;
  if (["=", "return", "=>"].includes(previous ?? "")) return true;
  return previous === ":" &&
    tokens[index - 2]?.kind === "identifier" &&
    ["=", "return", "=>"].includes(tokens[index - 3]?.text ?? "");
}

function findTopLevelElse(tokens: readonly Token[], start: number): number {
  const expected: string[] = [];
  const closeFor: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < tokens.length; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && text === "else") return index;
    else if (expected.length === 0 && [";", ","].includes(text)) return -1;
  }
  return -1;
}

function collectModuleBindings(
  tokens: readonly Token[],
  containingFunction: (offset: number) => FunctionDeclaration | undefined,
): Set<string> {
  const bindings = new Set<string>();
  for (let index = 0; index < tokens.length - 1; index++) {
    if (containingFunction(tokens[index]!.start)) continue;
    if (["const", "let", "var", "class", "function"].includes(tokens[index]!.text)) {
      const name = tokens[index + 1];
      if (name?.kind === "identifier") bindings.add(name.text);
    }
  }
  return bindings;
}

function collectFunctionBindings(
  tokens: readonly Token[],
  fn: FunctionDeclaration,
  moduleBindings: ReadonlySet<string>,
): Set<string> {
  const bindings = new Set(moduleBindings);
  for (const requirement of fn.requirements) bindings.add(requirement.name);
  const declarationStart = lowerBound(tokens, fn.start);
  let parametersOpen = declarationStart;
  while (parametersOpen < tokens.length && tokens[parametersOpen]!.start < fn.bodyStart) {
    if (tokens[parametersOpen]!.text === "(") break;
    parametersOpen++;
  }
  if (tokens[parametersOpen]?.text === "(") {
    const parametersClose = matchPair(tokens, parametersOpen);
    const expected: string[] = [];
    const closeFor: Readonly<Record<string, string>> = { "(": ")", "[": "]", "{": "}", "<": ">" };
    let atSegmentStart = true;
    for (let index = parametersOpen + 1; index < parametersClose; index++) {
      const token = tokens[index]!;
      if (expected.length === 0 && token.text === ",") {
        atSegmentStart = true;
        continue;
      }
      if (expected.length === 0 && atSegmentStart && token.kind === "identifier") {
        bindings.add(token.text);
        atSegmentStart = false;
      }
      if (closeFor[token.text]) expected.push(closeFor[token.text]!);
      else if (expected.at(-1) === token.text) expected.pop();
    }
  }

  const bodyStart = lowerBound(tokens, fn.bodyStart);
  const bodyEnd = lowerBound(tokens, fn.bodyEnd);
  for (let index = bodyStart; index < bodyEnd - 1; index++) {
    if (["const", "let", "var", "class", "function"].includes(tokens[index]!.text)) {
      const name = tokens[index + 1];
      if (name?.kind === "identifier") bindings.add(name.text);
    }
    if (
      tokens[index]!.text === "catch" &&
      tokens[index + 1]?.text === "(" &&
      tokens[index + 2]?.kind === "identifier"
    ) bindings.add(tokens[index + 2]!.text);
  }
  return bindings;
}

function inferBodyFailures(fact: FunctionFacts, rows: ReadonlyMap<string, MutableRows>): Set<string> {
  const failures = new Set(fact.directFailures);
  for (const call of fact.calls) {
    const calleeFailures = rows.get(call.callee)!.failures;
    if (call.mode !== "catch" || !call.catchArms) {
      for (const failure of call.mode === "catch" ? [] : calleeFailures) failures.add(failure);
      continue;
    }
    const arms = new Map(call.catchArms.map((arm) => [arm.failure, arm]));
    for (const failure of calleeFailures) {
      const arm = arms.get(failure);
      if (!arm || arm.rethrows) failures.add(failure);
    }
  }
  return failures;
}

function checkProvidedScopes(
  tokens: readonly Token[],
  rows: ReadonlyMap<string, MutableRows>,
  diagnostics: Array<Omit<Diagnostic, "line" | "column">>,
): void {
  const layerVariables = collectLayerVariables(tokens);
  for (let index = 0; index < tokens.length - 4; index++) {
    if (!isLayerCall(tokens, index, "provide")) continue;
    const open = index + 3;
    const close = matchPair(tokens, open);
    const comma = findComma(tokens, open + 1, close);
    if (comma === -1) continue;
    const provided = resolveLayerExpression(tokens, open + 1, comma, layerVariables);
    const required = new Set<string>();
    for (let cursor = comma + 1; cursor < close; cursor++) {
      const name = tokens[cursor]!.text;
      if (rows.has(name) && tokens[cursor + 1]?.text === "(") {
        for (const requirement of rows.get(name)!.requirements) required.add(requirement);
      }
    }
    const missing = difference(required, provided);
    if (missing.size > 0) {
      diagnostics.push({
        severity: "error",
        code: "VIBE2001",
        message: `Layer.provide is missing ${formatSet(missing)}`,
        start: tokens[index]!.start,
      });
    }
    index = close;
  }
}

function collectLayerVariables(tokens: readonly Token[]): Map<string, Set<string>> {
  const variables = new Map<string, Set<string>>();
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 0; index < tokens.length - 4; index++) {
      if (tokens[index]!.text !== "const" || tokens[index + 1]?.kind !== "identifier") continue;
      if (tokens[index + 2]?.text !== "=") continue;
      const expressionStart = index + 3;
      if (tokens[expressionStart]?.text !== "Layer" && !variables.has(tokens[expressionStart]!.text)) continue;
      const expressionEnd = layerExpressionEnd(tokens, expressionStart);
      const provided = resolveLayerExpression(tokens, expressionStart, expressionEnd, variables);
      const name = tokens[index + 1]!.text;
      const old = variables.get(name);
      if (!old || old.size !== provided.size || [...provided].some((item) => !old.has(item))) {
        variables.set(name, provided);
        changed = true;
      }
    }
  }
  return variables;
}

function layerExpressionEnd(tokens: readonly Token[], start: number): number {
  if (tokens[start]?.text === "Layer" && tokens[start + 1]?.text === "." && tokens[start + 3]?.text === "(") {
    return matchPair(tokens, start + 3) + 1;
  }
  return start + 1;
}

function resolveLayerExpression(
  tokens: readonly Token[],
  start: number,
  end: number,
  variables: ReadonlyMap<string, Set<string>>,
): Set<string> {
  const provided = new Set<string>();
  if (end - start === 1 && variables.has(tokens[start]!.text)) {
    for (const item of variables.get(tokens[start]!.text)!) provided.add(item);
    return provided;
  }
  for (let index = start; index < end; index++) {
    if (isLayerCall(tokens, index, "succeed")) {
      const capability = tokens[index + 4];
      if (capability?.kind === "identifier") provided.add(capability.text);
    } else if (tokens[index]!.kind === "identifier" && variables.has(tokens[index]!.text)) {
      for (const item of variables.get(tokens[index]!.text)!) provided.add(item);
    }
  }
  return provided;
}

function isLayerCall(tokens: readonly Token[], index: number, method: string): boolean {
  return (
    tokens[index]?.text === "Layer" &&
    tokens[index + 1]?.text === "." &&
    tokens[index + 2]?.text === method &&
    tokens[index + 3]?.text === "("
  );
}

function findComma(tokens: readonly Token[], start: number, end: number): number {
  const expected: string[] = [];
  const closeFor: Record<string, string> = { "(": ")", "[": "]", "{": "}" };
  for (let index = start; index < end; index++) {
    const text = tokens[index]!.text;
    if (closeFor[text]) expected.push(closeFor[text]!);
    else if (expected.at(-1) === text) expected.pop();
    else if (expected.length === 0 && text === ",") return index;
  }
  return -1;
}

function findToken(tokens: readonly Token[], start: number, end: number, text: string): number {
  for (let index = start; index < end; index++) if (tokens[index]!.text === text) return index;
  return -1;
}

function lowerBound(tokens: readonly Token[], offset: number): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (tokens[middle]!.start < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

function difference(left: ReadonlySet<string>, right: ReadonlySet<string>): Set<string> {
  return new Set([...left].filter((item) => !right.has(item)));
}

function formatSet(values: ReadonlySet<string>): string {
  return [...values].sort().join(" | ") || "never";
}
