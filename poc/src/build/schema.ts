// The native TypeScript 7 preview intentionally does not expose the historical
// JavaScript compiler API. This alias is temporary POC scaffolding until the Go
// compiler has a real VibeLang extension/IR seam.
import * as ts from "typescript-js";
import { VibeFailure } from "../runtime/failure.ts";

export type SchemaNode =
  | { kind: "string" | "number" | "boolean" | "null" | "unknown" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: SchemaNode }
  | { kind: "tuple"; elements: SchemaNode[] }
  | { kind: "union"; variants: SchemaNode[] }
  | { kind: "object"; properties: Record<string, { optional: boolean; schema: SchemaNode }> };

export class ValidationFailure extends VibeFailure {
  declare readonly _tag: "ValidationFailure";
  constructor(readonly path: string, readonly expected: string) {
    super("ValidationFailure");
    this.message = `${path} expected ${expected}`;
  }
}

/**
 * POC for `comptime Schema.derive<T>()`: inspect a normal TypeScript declaration
 * and emit backend-neutral schema IR. The real compiler already owns this AST.
 */
export function deriveSchema(source: string, typeName: string): SchemaNode {
  const file = ts.createSourceFile("schema.vibe.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const declarations = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement)) declarations.set(statement.name.text, statement.type);
    if (ts.isInterfaceDeclaration(statement)) declarations.set(statement.name.text, statement);
  }
  const root = declarations.get(typeName);
  if (!root) throw new Error(`type '${typeName}' was not found`);
  const visiting = new Set<string>();

  const convertMembers = (members: ts.NodeArray<ts.TypeElement>): SchemaNode => {
    const properties = Object.create(null) as Record<string, { optional: boolean; schema: SchemaNode }>;
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !member.type || !member.name) {
        throw new Error(`Schema.derive only supports property signatures (${member.getText(file)})`);
      }
      const name = propertyName(member.name);
      properties[name] = { optional: Boolean(member.questionToken), schema: convert(member.type) };
    }
    return { kind: "object", properties };
  };

  const convert = (node: ts.TypeNode | ts.InterfaceDeclaration): SchemaNode => {
    if (ts.isInterfaceDeclaration(node)) {
      if (node.heritageClauses?.length) {
        throw new Error(`Schema.derive does not support interface inheritance yet (${node.name.text})`);
      }
      return convertMembers(node.members);
    }
    switch (node.kind) {
      case ts.SyntaxKind.StringKeyword: return { kind: "string" };
      case ts.SyntaxKind.NumberKeyword: return { kind: "number" };
      case ts.SyntaxKind.BooleanKeyword: return { kind: "boolean" };
      case ts.SyntaxKind.UnknownKeyword: return { kind: "unknown" };
      case ts.SyntaxKind.NullKeyword: return { kind: "null" };
    }
    if (ts.isLiteralTypeNode(node)) {
      if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
      if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
      if (ts.isStringLiteral(node.literal) || ts.isNumericLiteral(node.literal)) {
        return { kind: "literal", value: ts.isNumericLiteral(node.literal) ? Number(node.literal.text) : node.literal.text };
      }
    }
    if (ts.isArrayTypeNode(node)) return { kind: "array", element: convert(node.elementType) };
    if (ts.isTupleTypeNode(node)) return { kind: "tuple", elements: node.elements.map(convert) };
    if (ts.isUnionTypeNode(node)) return { kind: "union", variants: node.types.map(convert) };
    if (ts.isTypeLiteralNode(node)) return convertMembers(node.members);
    if (ts.isTypeReferenceNode(node)) {
      const name = node.typeName.getText(file);
      if (name === "Array" && node.typeArguments?.length === 1) return { kind: "array", element: convert(node.typeArguments[0]) };
      const declaration = declarations.get(name);
      if (!declaration) throw new Error(`Schema.derive cannot resolve '${name}'`);
      if (visiting.has(name)) throw new Error(`recursive durable schema '${name}' needs an explicit representation`);
      visiting.add(name);
      const result = convert(declaration);
      visiting.delete(name);
      return result;
    }
    throw new Error(`Schema.derive does not support ${ts.SyntaxKind[node.kind]} yet`);
  };

  return convert(root);
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`computed schema property names are not durable: ${name.getText()}`);
}

export function parseWithSchema<T>(schema: SchemaNode, input: unknown): T {
  validate(schema, input, "$input");
  return input as T;
}

function validate(schema: SchemaNode, input: unknown, path: string): void {
  switch (schema.kind) {
    case "unknown": return;
    case "null": if (input === null) return; break;
    case "string": if (typeof input === "string") return; break;
    case "number": if (typeof input === "number" && Number.isFinite(input)) return; break;
    case "boolean": if (typeof input === "boolean") return; break;
    case "literal": if (input === schema.value) return; break;
    case "array":
      if (Array.isArray(input)) {
        input.forEach((value, index) => validate(schema.element, value, `${path}[${index}]`));
        return;
      }
      break;
    case "tuple":
      if (Array.isArray(input) && input.length === schema.elements.length) {
        schema.elements.forEach((element, index) => validate(element, input[index], `${path}[${index}]`));
        return;
      }
      break;
    case "union": {
      for (const variant of schema.variants) {
        try { validate(variant, input, path); return; } catch (error) {
          if (!(error instanceof ValidationFailure)) throw error;
        }
      }
      break;
    }
    case "object":
      if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        const object = input as Record<string, unknown>;
        for (const [key, property] of Object.entries(schema.properties)) {
          if (!Object.hasOwn(object, key)) {
            if (property.optional) continue;
            throw new ValidationFailure(`${path}.${key}`, describe(property.schema));
          }
          validate(property.schema, object[key], `${path}.${key}`);
        }
        return;
      }
      break;
  }
  throw new ValidationFailure(path, describe(schema));
}

function describe(schema: SchemaNode): string {
  switch (schema.kind) {
    case "literal": return JSON.stringify(schema.value);
    case "array": return `Array<${describe(schema.element)}>`;
    case "tuple": return `[${schema.elements.map(describe).join(", ")}]`;
    case "union": return schema.variants.map(describe).join(" | ");
    case "object": return "object";
    default: return schema.kind;
  }
}
