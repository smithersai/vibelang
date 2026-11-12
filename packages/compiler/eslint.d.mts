/** Dependency-free ESTree shapes, including nodes added by VibeLang. */
export interface Position { line: number; column: number }
export interface ESTreeNode {
  type: string
  range: [number, number]
  loc?: { start: Position; end: Position }
  /** Node-specific ESTree fields depend on the node's type. */
  [key: string]: unknown
}
export interface ESTreeToken extends ESTreeNode { value: string }
export interface Program extends ESTreeNode {
  type: "Program"
  sourceType: "module" | "script"
  body: ESTreeNode[]
  tokens: ESTreeToken[]
  comments: ESTreeToken[]
}
export interface ParserOptions {
  filePath?: string
  sourceType?: "module" | "script"
  lib?: string[]
  jsxPragma?: string | null
  jsxFragmentName?: string | null
}
export interface ParseResult {
  ast: Program
  /** The scope manager supplied by the project's typescript-eslint install. */
  scopeManager: unknown
  services: {
    emitDecoratorMetadata: undefined
    experimentalDecorators: undefined
    isolatedDeclarations: undefined
    program: null
    esTreeNodeToTSNodeMap: WeakMap<object, unknown>
    tsNodeToESTreeNodeMap: WeakMap<object, unknown>
  }
  visitorKeys: Record<string, string[]>
}
export const meta: { name: string; version: string }
export const vibeVisitorKeys: Readonly<Record<string, readonly string[]>>
export function parseESTree(code: string, filePath: string): Program
export function parseForESLint(code: string, options?: ParserOptions): ParseResult
export function parse(code: string, options?: ParserOptions): Program
/** Build a program with the project's installed TypeScript. */
export function typedProgram(options?: {
  project?: string
  tsconfigRootDir?: string
  compiler?: string
}): import("typescript").Program
declare const parser: {
  meta: typeof meta
  parse: typeof parse
  parseForESLint: typeof parseForESLint
}
export default parser
