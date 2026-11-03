// docs/design/vips/0034-compiler-and-tooling.md#1eb5649782c8696d
// VIP-34: real tooling reads Vibe imports exports and declarations.
// docs/design/vips/0034-compiler-and-tooling.md#723d204e746beecc
// VIP-34: Knip sees real Vibe imports and exports; ESLint, register and bundler suites are complementary tool readers.
import { strict as assert } from "node:assert"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"
import { test } from "node:test"
import { fileURLToPath } from "node:url"
import compile from "../knip.mjs"

// vibelang/knip gives Knip a .vibe module's imports and exports as TypeScript.
const repo = fileURLToPath(new URL("../../../", import.meta.url))
const native = process.env.VIBELANG_BINARY || join(repo, "typescript/built/local/tsc")
const modules = process.env.EFFECT_NODE_MODULES || join(repo, "experiments/node_modules")
const missing = [native, join(modules, "typescript")].find((path) => !existsSync(path))
const skip = missing !== undefined && `run typescript/vibelang/smoke.sh first; missing ${missing}`
if (!process.env.VIBELANG_BINARY && !skip) process.env.VIBELANG_BINARY = native

const source = `import { a } from "./a.vibe"
import * as Users from "./users.vibe"
import type { T } from "./t.ts"
import "./side-effect.vibe"

export error NotFound { id: string }
export schema User { name: String }
export type Id = string
export interface Box { v: number }
export function find(x: T): number {
  return Users.count(x) + a
}
export const c = 1, { d, e: [f] } = { d: 2, e: [3] }
export class K {}
export { a as b } from "./a.vibe"
export * from "./all.vibe"
export default find
const lazy = () => import("./lazy.vibe")
const user: Users.Row = Users.first()
`

// Chapter 007 / Knip reads the actual Vibe module: docs/design/src/007-tooling.md#b351eadf7aa7995c

test("a .vibe module compiles to its imports, export stubs, dynamic imports and namespace reads", { skip }, () => {
  assert.equal(compile(source, "src/module.vibe"), [
    'import "vibelang-runtime"',
    'import { a } from "./a.vibe"',
    'import * as Users from "./users.vibe"',
    'import type { T } from "./t.ts"',
    'import "./side-effect.vibe"',
    "export class NotFound {}",
    "export const User = 0 as unknown as [typeof String]",
    "export type Id = unknown",
    "export interface Box {}",
    "export function find(..._: [T]) {}",
    "export const c = 0, d = 0, f = 0",
    "export class K {}",
    'export { a as b } from "./a.vibe"',
    'export * from "./all.vibe"',
    "export default 0",
    "Users.count",
    'import("./lazy.vibe")',
    "Users.Row",
    "Users.first",
    ""
  ].join("\n"))
})

// Knip counts a type an exported declaration's signature reads, outside its
// bodies, as a use of the export it names, and a read in a body as none. The
// stub keeps the first (drive-t3code: OpenCode's probeResponses fixture
// exports a constant only a typeof in replayOpenCodeServer's parameter reads).
test("an export's stub reads the types its signature reads, not those its body reads", { skip }, () => {
  const text = `export const sample = { value: 1 }
export function read(input: typeof sample): number { const hidden: Hidden = 1; return input.value }
export const arrow = (input: typeof sample): Out => input.value
export type Box<V> = { v: V; s: Sample }
export class K { field?: Sample; m(): number { const b: Hidden = 1; return b } }
export interface Shape { s: typeof sample }
`
  assert.equal(compile(text, "src/reads.vibe"), [
    'import "vibelang-runtime"',
    "export const sample = 0",
    "export function read(..._: [typeof sample]) {}",
    "export const arrow = 0 as unknown as [typeof sample, Out]",
    "export type Box = [Sample]",
    "export class K { _?: [Sample] }",
    "export interface Shape { _?: [typeof sample] }",
    ""
  ].join("\n"))
})

// Knip keeps an export no module imports when its JSDoc says `@public`
// (drive-t3code: shared Net exports make with that marker and uses it only
// for its own layer). Each stub carries the JSDoc comments written between the
// export and the statement before it, as TypeScript attaches them: across a
// blank line or a line comment. A variable statement keeps its bindings together,
// so Knip gives its tags the original statement scope; not a comment that belongs to an earlier statement, such as
// one on the line where that statement ends.
test("an export's stub keeps the JSDoc written before it, whose tags Knip reads", { skip }, () => {
  const text = `/** @public */
export const make = (): number => 1
export const layer = make()
/**
 * Two lines.
 * @internal
 */
export function f() {}
/** @public */

// a line comment between
export class K {}
/** @public */
export const a = 1, b = 2
/** @public */
const local = 1
export const none = local
/* @public, not JSDoc */
export const block = 1 /** @public */
export const trailing = 1
/** @public */
export schema User { name: String }
/** @public */
export { local as renamed }
`
  assert.equal(compile(text, "src/docs.vibe"), [
    'import "vibelang-runtime"',
    "/** @public */",
    "export const make = 0",
    "export const layer = 0",
    "/**",
    " * Two lines.",
    " * @internal",
    " */",
    "export function f() {}",
    "/** @public */",
    "",
    "// a line comment between",
    "export class K {}",
    "/** @public */",
    "export const a = 0, b = 0",
    "export const none = 0",
    "export const block = 0",
    "0; /** @public */",
    "export const trailing = 0",
    "/** @public */",
    "export const User = 0 as unknown as [typeof String]",
    "/** @public */",
    "export { local as renamed }",
    ""
  ].join("\n"))
})

test("the output is TypeScript that TypeScript parses without a syntax error", { skip }, () => {
  const ts = createRequire(join(modules, "typescript/package.json"))("typescript")
  const file = ts.createSourceFile("module.ts", compile(source, "src/module.vibe"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  assert.deepEqual(file.parseDiagnostics.map((d) => d.messageText), [])
})

test("a syntax error throws at its position", { skip }, () => {
  assert.throws(() => compile("export const = 1\n", "src/bad.vibe"), SyntaxError)
})

test("nested defaults and rest bindings preserve every exported name", { skip }, () => {
  const text = `export const {
    plain,
    renamed: alias,
    nested: { value = 1, ...nestedRest } = {},
    items: [first = 2, , ...remaining],
    ...objectRest
  } = input
  export const [head, , { key: renamed = 3 }, ...tail] = values
  `
  assert.equal(compile(text, "src/bindings.vibe"), [
    'import "vibelang-runtime"',
    "export const plain = 0, alias = 0, value = 0, nestedRest = 0, first = 0, remaining = 0, objectRest = 0",
    "export const head = 0, renamed = 0, tail = 0",
    ""
  ].join("\n"))
})
