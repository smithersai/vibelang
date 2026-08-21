import type {
  AgentFunction,
  AgentFunctionContext,
  AgentFunctionTable,
  Awaitable,
} from "./types.ts"

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

export function defineFunction<Input, Output>(
  signature: string,
  invoke: (input: Input, context: AgentFunctionContext) => Awaitable<Output>,
  description?: string,
): AgentFunction<Input, Output> {
  if (!signature.trim().startsWith("(")) {
    throw new Error(`Agent function signature must be a function type, got: ${signature}`)
  }
  return { signature: signature.trim(), invoke, description }
}

export function declareCallableSurface(functions: AgentFunctionTable): string {
  const members = Object.entries(functions).map(([name, fn]) => {
    if (!IDENTIFIER.test(name)) {
      throw new Error(`Agent function name is not a TypeScript identifier: ${name}`)
    }
    return `  readonly ${name}: ${fn.signature};`
  })

  return [
    "interface Functions {",
    ...members,
    "}",
    "",
    "interface Console {",
    "  log(...values: unknown[]): void;",
    "  info(...values: unknown[]): void;",
    "  warn(...values: unknown[]): void;",
    "  error(...values: unknown[]): void;",
    "}",
    "declare const console: Console;",
    "",
  ].join("\n")
}
