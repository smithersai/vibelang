import * as ts from "typescript-js";

export type Portability = "portable" | "typescript-required" | "forbidden" | "undecided";

export interface PortabilityDiagnostic {
  code: string;
  message: string;
  line: number;
  column: number;
  severity: "error" | "warning";
}

export interface FunctionCompatibility {
  name: string;
  requirements: string[];
  requirementPaths: Record<string, string[]>;
  nativePinned: boolean;
}

export interface CompatibilityAnalysis {
  functions: Record<string, FunctionCompatibility>;
  diagnostics: PortabilityDiagnostic[];
}

interface Facts {
  name: string;
  node: ts.FunctionDeclaration;
  nativePinned: boolean;
  direct: Map<string, string[]>;
  calls: Array<{ name: string; node: ts.Node }>;
}

interface RuntimeImports {
  bindings: Map<string, string>;
  sideEffects: Set<string>;
}

const undecidedGlobals = new Set(["Proxy", "WeakRef", "FinalizationRegistry"]);
const hostGlobals = new Set(["process", "window", "document"]);

/**
 * A checker-side experiment for the three-way portability table and native-pin
 * dependency diagnostics. `@native` is deliberately POC-only because spelling
 * is still open in the spec.
 */
export function analyzeCompatibility(source: string): CompatibilityAnalysis {
  const file = ts.createSourceFile("compat.vibe.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const diagnostics: PortabilityDiagnostic[] = [];
  const runtimeImports = collectRuntimeImports(file);
  const moduleBindings = collectTopLevelBindings(file);
  const facts = new Map<string, Facts>();
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !statement.body) continue;
    facts.set(statement.name.text, {
      name: statement.name.text,
      node: statement,
      nativePinned: ts.getJSDocTags(statement).some((tag) => tag.tagName.text === "native"),
      direct: new Map(),
      calls: [],
    });
  }

  for (const fact of facts.values()) {
    const shadowed = collectFunctionBindings(fact.node);
    for (const requirement of runtimeImports.sideEffects) addRequirement(fact, requirement, fact.name);
    const isUnboundGlobal = (name: string): boolean => !shadowed.has(name) && !moduleBindings.has(name);
    const markAnyInType = (node: ts.Node | undefined): void => {
      if (!node) return;
      if (node.kind === ts.SyntaxKind.AnyKeyword) addRequirement(fact, "TypeScript", fact.name);
      ts.forEachChild(node, markAnyInType);
    };
    for (const parameter of fact.node.parameters) markAnyInType(parameter.type);
    markAnyInType(fact.node.type);
    const visit = (node: ts.Node): void => {
      if (node.kind === ts.SyntaxKind.AnyKeyword) addRequirement(fact, "TypeScript", fact.name);
      if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) {
        diagnostics.push(at(file, node, "VIBE3004", "type assertion portability is undecided; safe/reifiable/TypeScript-required classification needs checker proof", "warning"));
      }
      if (ts.isWithStatement(node)) {
        diagnostics.push(at(file, node, "VIBE3003", "with statements are forbidden in authored .vibe code", "error"));
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) addRequirement(fact, "TypeScript", fact.name);
        if (ts.isIdentifier(node.expression)) {
          if (
            (node.expression.text === "eval" || node.expression.text === "Function") &&
            isUnboundGlobal(node.expression.text)
          ) {
            addRequirement(fact, "TypeScript", fact.name);
          }
          if (facts.has(node.expression.text) && !shadowed.has(node.expression.text)) {
            fact.calls.push({ name: node.expression.text, node });
          }
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "Function" &&
        isUnboundGlobal("Function")
      ) addRequirement(fact, "TypeScript", fact.name);
      if (ts.isIdentifier(node) && isValueReferenceIdentifier(node)) {
        const imported = runtimeImports.bindings.get(node.text);
        if (imported && !shadowed.has(node.text)) addRequirement(fact, imported, fact.name);
        if (hostGlobals.has(node.text) && isUnboundGlobal(node.text)) {
          addRequirement(fact, `Host<${JSON.stringify(node.text)}>`, fact.name);
        }
        if (undecidedGlobals.has(node.text) && isUnboundGlobal(node.text)) {
          diagnostics.push(at(file, node, "VIBE3002", `${node.text} portability is not classified yet`, "warning"));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(fact.node.body!);
  }

  // Set propagation with one retained dependency path per requirement.
  let changed = true;
  while (changed) {
    changed = false;
    for (const fact of facts.values()) {
      for (const call of fact.calls) {
        const callee = facts.get(call.name);
        if (!callee) continue;
        for (const [requirement, path] of callee.direct) {
          if (!fact.direct.has(requirement)) {
            fact.direct.set(requirement, [fact.name, ...path]);
            changed = true;
          }
        }
      }
    }
  }

  const functions: Record<string, FunctionCompatibility> = {};
  for (const fact of facts.values()) {
    const requirementPaths = Object.fromEntries([...fact.direct].sort(([left], [right]) => left.localeCompare(right)));
    functions[fact.name] = {
      name: fact.name,
      requirements: Object.keys(requirementPaths),
      requirementPaths,
      nativePinned: fact.nativePinned,
    };
    if (fact.nativePinned) {
      const incompatible = [...fact.direct].find(([requirement]) =>
        requirement === "TypeScript" || requirement.startsWith("Module<") || requirement.startsWith("Host<"),
      );
      if (incompatible) {
        const [requirement, path] = incompatible;
        diagnostics.push(at(
          file,
          fact.node,
          "VIBE3001",
          `native pin failed: ${requirement} is required through ${path.join(" -> ")}`,
          "error",
        ));
      }
    }
  }
  return { functions, diagnostics };
}

function collectRuntimeImports(file: ts.SourceFile): RuntimeImports {
  const bindings = new Map<string, string>();
  const sideEffects = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const clause = statement.importClause;
    const moduleName = statement.moduleSpecifier.text;
    const requirement = requirementForModule(moduleName);
    if (!requirement) continue;
    if (!clause) {
      sideEffects.add(requirement);
      continue;
    }
    if (clause.isTypeOnly) continue;
    if (clause.name) bindings.set(clause.name.text, requirement);
    if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
      bindings.set(clause.namedBindings.name.text, requirement);
    }
    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if (!element.isTypeOnly) bindings.set(element.name.text, requirement);
      }
    }
  }
  return { bindings, sideEffects };
}

function requirementForModule(moduleName: string): string | undefined {
  if (moduleName.startsWith("node:")) return `Module<${JSON.stringify(moduleName)}>`;
  if (moduleName.startsWith("vibelang:") || moduleName.startsWith("@vibelang/")) return undefined;
  return "TypeScript";
}

function collectTopLevelBindings(file: ts.SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const statement of file.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) &&
      statement.name
    ) bindings.add(statement.name.text);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) addBindingName(declaration.name, bindings);
    }
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const clause = statement.importClause;
      if (clause.name) bindings.add(clause.name.text);
      if (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        bindings.add(clause.namedBindings.name.text);
      }
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) bindings.add(element.name.text);
      }
    }
  }
  return bindings;
}

function collectFunctionBindings(fn: ts.FunctionDeclaration): Set<string> {
  const bindings = new Set<string>();
  for (const parameter of fn.parameters) addBindingName(parameter.name, bindings);
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node)) addBindingName(node.name, bindings);
    if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) {
      bindings.add(node.name.text);
      if (node !== fn) return;
    }
    if (ts.isCatchClause(node) && node.variableDeclaration) addBindingName(node.variableDeclaration.name, bindings);
    if (node !== fn && (ts.isFunctionLike(node) || ts.isClassLike(node))) return;
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
  return bindings;
}

function addBindingName(name: ts.BindingName, bindings: Set<string>): void {
  if (ts.isIdentifier(name)) {
    bindings.add(name.text);
    return;
  }
  for (const element of name.elements) {
    if (ts.isBindingElement(element)) addBindingName(element.name, bindings);
  }
}

function isValueReferenceIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return false;
  if (ts.isQualifiedName(parent) && parent.right === node) return false;
  if (
    (ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) ||
      ts.isGetAccessorDeclaration(parent) || ts.isSetAccessorDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === node
  ) return false;
  if (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) return false;
  if (
    ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) ||
      ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) ||
      ts.isEnumDeclaration(parent) || ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent)) && parent.name === node) ||
    ts.isImportClause(parent) || ts.isImportSpecifier(parent) || ts.isNamespaceImport(parent)
  ) return false;
  if (
    (ts.isLabeledStatement(parent) && parent.label === node) ||
    ((ts.isBreakStatement(parent) || ts.isContinueStatement(parent)) && parent.label === node)
  ) return false;
  for (let current: ts.Node | undefined = parent; current; current = current.parent) {
    if (ts.isTypeNode(current)) return false;
    if (ts.isExpression(current) || ts.isStatement(current)) break;
  }
  return true;
}

function addRequirement(fact: Facts, requirement: string, path: string): void {
  if (!fact.direct.has(requirement)) fact.direct.set(requirement, [path]);
}

function at(
  file: ts.SourceFile,
  node: ts.Node,
  code: string,
  message: string,
  severity: "error" | "warning",
): PortabilityDiagnostic {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { code, message, severity, line: position.line + 1, column: position.character + 1 };
}
