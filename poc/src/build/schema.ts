// The native TypeScript 7 preview intentionally does not expose the historical
// JavaScript compiler API. This alias is temporary POC scaffolding until the Go
// compiler has a real Smithers extension/IR seam.
import * as ts from "typescript-js";
import { SmithersFailure } from "../runtime/failure.ts";

export type SchemaNode =
  | { kind: "string" | "number" | "boolean" | "null" | "unknown" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: SchemaNode }
  | { kind: "tuple"; elements: SchemaNode[] }
  | { kind: "union"; variants: SchemaNode[] }
  | { kind: "object"; properties: Record<string, { optional: boolean; schema: SchemaNode }> };

export class ValidationFailure extends SmithersFailure {
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
  const file = ts.createSourceFile("schema.sm.ts", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const parseDiagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    throw new SyntaxError(`Schema.derive input did not parse: ${parseDiagnostics
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      .join("; ")}`);
  }
  const declarations = new Map<string, ts.TypeNode | ts.InterfaceDeclaration>();
  for (const statement of file.statements) {
    if (ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement)) {
      if (declarations.has(statement.name.text)) {
        throw new Error(`Schema.derive found duplicate declaration '${statement.name.text}'`);
      }
      declarations.set(statement.name.text, ts.isTypeAliasDeclaration(statement) ? statement.type : statement);
    }
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
      if (Object.hasOwn(properties, name)) {
        throw new Error(`Schema.derive found duplicate property '${name}'`);
      }
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

  return freezeSchema(convert(root));
}

function freezeSchema(schema: SchemaNode): SchemaNode {
  switch (schema.kind) {
    case "array": freezeSchema(schema.element); break;
    case "tuple": schema.elements.forEach(freezeSchema); Object.freeze(schema.elements); break;
    case "union": schema.variants.forEach(freezeSchema); Object.freeze(schema.variants); break;
    case "object":
      for (const property of Object.values(schema.properties)) {
        freezeSchema(property.schema);
        Object.freeze(property);
      }
      Object.freeze(schema.properties);
      break;
  }
  return Object.freeze(schema);
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error(`computed schema property names are not durable: ${name.getText()}`);
}

export function parseWithSchema<T>(schema: SchemaNode, input: unknown): T {
  return decode(schema, input, "$input") as T;
}

function decode(schema: SchemaNode, input: unknown, path: string): unknown {
  switch (schema.kind) {
    case "unknown": return input;
    case "null": if (input === null) return input; break;
    case "string": if (typeof input === "string") return input; break;
    case "number": if (typeof input === "number" && Number.isFinite(input)) return input; break;
    case "boolean": if (typeof input === "boolean") return input; break;
    case "literal": if (input === schema.value) return input; break;
    case "array":
      if (Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype) {
        assertPlainArray(input, path);
        const output: unknown[] = [];
        for (let index = 0; index < input.length; index++) {
          output.push(decode(schema.element, arrayElement(input, index, path, schema.element), `${path}[${index}]`));
        }
        return output;
      }
      break;
    case "tuple":
      if (Array.isArray(input) && Object.getPrototypeOf(input) === Array.prototype && input.length === schema.elements.length) {
        assertPlainArray(input, path);
        return schema.elements.map((element, index) => {
          return decode(element, arrayElement(input, index, path, element), `${path}[${index}]`);
        });
      }
      break;
    case "union": {
      for (const variant of schema.variants) {
        try { return decode(variant, input, path); } catch (error) {
          if (!(error instanceof ValidationFailure)) throw error;
        }
      }
      break;
    }
    case "object":
      if (typeof input === "object" && input !== null && !Array.isArray(input)) {
        const object = input as Record<string, unknown>;
        const prototype = Object.getPrototypeOf(object);
        if (prototype !== Object.prototype && prototype !== null) break;
        const output = Object.create(null) as Record<string, unknown>;
        for (const [key, property] of Object.entries(schema.properties)) {
          if (!Object.hasOwn(object, key)) {
            if (property.optional) continue;
            throw new ValidationFailure(`${path}.${key}`, describe(property.schema));
          }
          const descriptor = Object.getOwnPropertyDescriptor(object, key);
          if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
            throw new ValidationFailure(`${path}.${key}`, describe(property.schema));
          }
          output[key] = decode(property.schema, descriptor.value, `${path}.${key}`);
        }
        return output;
      }
      break;
  }
  throw new ValidationFailure(path, describe(schema));
}

function assertPlainArray(input: unknown[], path: string): void {
  for (const key of Reflect.ownKeys(input)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= input.length) {
      throw new ValidationFailure(path, "plain array");
    }
  }
}

function arrayElement(input: unknown[], index: number, path: string, schema: SchemaNode): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(input, index);
  if (!descriptor || descriptor.enumerable !== true || !("value" in descriptor)) {
    throw new ValidationFailure(`${path}[${index}]`, describe(schema));
  }
  return descriptor.value;
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
