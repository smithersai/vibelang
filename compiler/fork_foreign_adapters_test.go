package compiler

import "testing"

func TestPinnedForkForeignAdapters(t *testing.T) {
	const support = `/** @module @throws {never} */
export class Declined extends Error {
  constructor(message: string) { super(message); this.name = "Declined" }
}
/** @throws {Declined} */
export function decline(value: boolean): string { if (value) throw new Declined("declined"); return "ok" }
export const client = {
  /** @throws {never} */
  get value(): string { return "safe" },
  get unsafe(): string { throw new Error("unsafe") },
  /** @throws {never} */
  get count(): number { return 1 },
  set count(value: number) { throw new Error(String(value)) },
  /** @throws {never} */
  get pending(): Promise<string> { return Promise.reject(new Error("unsafe")) }
};`
	runFailClosedCases(t, []failClosedCase{
		{name: "a synchronous mapper owns the explicit Result adapter", source: `
class Mapped extends Error {}
function read(): Result<string, Mapped | Panic> {
  return Result.try(() => { throw new Error("raw") }, () => new Mapped("mapped"));
}
export function main(): string[] { return [read().match({ok: value => value, error: error => error.message})] }
`, stdout: "mapped"},
		{name: "an asynchronous mapper owns the explicit Result adapter", source: `
class Mapped extends Error {}
async function read(): Promise<Result<string, Mapped | Panic>> {
  return await Result.tryPromise(async () => { throw new Error("raw") }, () => new Mapped("mapped"));
}
export async function main(): Promise<string[]> { return [(await read()).match({ok: value => value, error: error => error.message})] }
`, stdout: "mapped"},
		{name: "foreign error contracts use a named import alias", support: support, source: `import { decline, Declined as Failure } from "./foreign.ts";
function read(): Result<string, Failure | Panic> { return decline(true)! }
export function main(): string[] { return [read().match({ok: value => value, error: error => error.name === "Declined" ? "declined" : "wrong"})] }
`, stdout: "declined"},
		{name: "foreign error contracts use a namespace import", support: support, source: `import * as foreign from "./foreign.ts";
function read(): Result<string, foreign.Declined | Panic> { return foreign.decline(true)! }
export function main(): string[] { return [read().match({ok: value => value, error: error => error.name === "Declined" ? "declined" : "wrong"})] }
`, stdout: "declined"},
		{name: "a resolved trusted getter remains usable", support: support, source: `import { client } from "./foreign.ts";
export function main(): string[] { return [client.value] }
`, stdout: "safe"},
		{name: "a computed trusted getter remains usable", support: support, source: `import { client } from "./foreign.ts";
export function main(): string[] { const key = "value"; return [client[key], String(client.count)] }
`, stdout: "safe\n1"},
		{name: "type-only Error imports cannot supply the runtime mapper", support: support, source: `import { decline, type Declined } from "./foreign.ts";
function read(): Result<string, Declined | Panic> {
  return decline(true)!
}
`, reject: []string{"VIBE1502@3:10"}},
		{name: "a shadowed class is not the declaration's Error constructor", support: support, source: `import { decline, Declined } from "./foreign.ts";
function read(Declined: typeof Error): Result<string, Error | Panic> {
  return decline(true)!
}
`, reject: []string{"VIBE1502@3:10"}},
		{name: "a same-named local class cannot substitute for the declaration's Error", support: support, source: `import { decline } from "./foreign.ts";
class Declined extends Error {}
function read(): Result<string, Error | Panic> {
  return decline(true)!
}
`, reject: []string{"VIBE1502@4:10"}},
		{name: "instanceof cannot silently invoke foreign Symbol.hasInstance", support: support, source: `import { decline, Declined as Failure } from "./foreign.ts";
function read(): Result<string, Failure | Panic> { return decline(true)! }
export function main(): string[] { return [read().match({ok: value => value, error: error => error instanceof Failure ? error.message : "wrong"})] }
`, reject: []string{"VIBE1303@3:85", "VIBE1506@3:111"}},
		{name: "a cast cannot invent a trusted getter contract", support: support, source: `import { client } from "./foreign.ts";
function read(): string {
  return (client as {readonly value: string}).value
}
`, reject: []string{"VIBE1101@2:1", "VIBE1506@3:10"}},
		{name: "a trusted getter cannot certify its setter", support: support, source: `import { client } from "./foreign.ts";
function write(): void {
  client.count = 2
}
`, reject: []string{"VIBE1101@2:1", "VIBE1506@3:3"}},
		{name: "grouping cannot borrow getter trust for a write", support: support, source: `import { client } from "./foreign.ts";
function write(): void {
  (client.count) = 2
}
`, reject: []string{"VIBE1101@2:1", "VIBE1506@3:4"}},
		{name: "an asynchronous getter cannot claim synchronous never trust", support: support, source: `import { client } from "./foreign.ts";
async function read(): Promise<string> {
  return await client.pending
}
`, reject: []string{"VIBE1101@2:1", "VIBE1502@3:16", "VIBE1506@3:16"}},
	})
}
