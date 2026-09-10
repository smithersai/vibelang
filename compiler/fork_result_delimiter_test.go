package compiler

import "testing"

func TestPinnedForkResultObserversPreserveTypedCallbackObligations(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "a typed Result callback cannot cross an observer boundary",
			source: `class Missing extends Error {}
function read(): Result<number, Missing> { throw new Missing() }
async function work(observe: () => Result<number, Missing>): Promise<number> {
return (await read().tapAsync(observe)).unwrapOr(0)
}`,
			reject: []string{"VIBE1303@4:31"},
		},
		{
			name: "a Promise-returning callback needs ownership without async syntax",
			source: `class Missing extends Error {}
function read(): Result<number, Missing> { throw new Missing() }
function work(observe: () => Promise<void>): number {
return read().tap(observe).unwrapOr(0)
}`,
			reject: []string{"VIBE1404@4:19"},
		},
	})
}

func TestPinnedForkResultDelimitersPreserveEvaluationAndReceivers(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "propagation during cleanup cannot swallow a panic",
			source: `import { panic } from "vibelang:exceptions"
class Missing extends Error {}
function fail(): Result<number, Missing> { throw new Missing("cleanup failed") }
function work(): Result<number, Missing> {
  try { panic("original panic") }
  finally { const ignored = fail()!; void ignored }
}
export function main(): string[] {
  const result = Result.try(() => work().unwrapOr(-1))
  return [result.match({ ok: n => String(n), error: e => String(e.message.includes("original panic")) })]
}`,
			stdout: "true",
		},
		{
			name: "async propagation during cleanup cannot swallow a panic",
			source: `import { panic } from "vibelang:exceptions"
class Missing extends Error {}
async function fail(): Promise<Result<number, Missing>> { throw new Missing("cleanup failed") }
async function work(): Promise<Result<number, Missing>> {
  try { panic("original async panic") }
  finally { const ignored = (await fail())!; void ignored }
}
export async function main(): Promise<string[]> {
  const result = await Result.tryPromise(async () => (await work()).unwrapOr(-1))
  return [result.match({ ok: n => String(n), error: e => String(e.message.includes("original async panic")) })]
}`,
			stdout: "true",
		},
		{
			name: "super reads calls updates and computed keys keep their home object",
			source: `class Missing extends Error {}
function read(n: number): Result<number, Missing> { return n }
class Base {
  value = 3
  get count(): number { return this.value }
  set count(value: number) { this.value = value }
  add(n: number): number { return this.value + n }
}
class Derived extends Base {
  run(key: "count"): Result<number, Missing> {
    super.count += read(2)!
    const selected = true ? super.add(read(1)!) : 0
    super[key] += read(1)!
    return selected + super[key]
  }
}
export function main(): string[] { return [String(new Derived().run("count").unwrapOr(-1))] }`,
			stdout: "12",
		},
		{
			name: "arguments shorthand and nested class receivers keep their scopes",
			source: `class Missing extends Error {}
function read(): Result<number, Missing> { return 1 }
class Outer {
  value = 3
  run(n: number): Result<number, Missing> {
    const passed = { arguments }
    class Inner { value = 20; read(): number { return this.value } }
    return this.value + new Inner().read() + passed.arguments.length + read()! + n
  }
}
export function main(): string[] { return [String(new Outer().run(2).unwrapOr(-1))] }`,
			stdout: "27",
		},
		{
			name: "empty failure rows preserve expression evaluation",
			source: `const seen: number[] = []
function read(n: number): Result<number, never> { seen.push(n); return n }
function work(): Result<number, never> {
  let n = 0
  while (read(n)! < 3) n++
  return true ? seen.push(9) + read(n)! : read(99)!
}
export function main(): string[] { return [String(work().unwrapOr(-1)), seen.join(",")] }`,
			stdout: "8\n0,1,2,3,9,3",
		},
		{
			name: "conditional propagation and repeated loop headers stay at their expression site",
			source: `class Missing extends Error {}
const seen: number[] = []
function read(n: number): Result<number, Missing> { seen.push(n); if (n < 0) throw new Missing(); return n }
function work(): Result<number, Missing> {
  let n = 0
  const skip = true || read(-1)! > 0
  const maybe: number | undefined = 8
  const skip2 = maybe ?? read(-2)!
  while (read(n)! < 3) n++
  const total = seen.push(100) + read(4)!
  return skip ? total + skip2 : 0
}
export function main(): string[] { return [String(work().unwrapOr(0)), seen.join(",")] }`,
			stdout: "17\n0,1,2,3,100,4",
		},
		{
			name: "async failure exits after awaited finally",
			source: `class Missing extends Error {}
const seen: string[] = []
async function read(): Promise<Result<number, Missing>> { throw new Missing("missing") }
async function work(): Promise<Result<number, Missing>> {
  try { const value = false ? 0 : (await read())!; seen.push("wrong"); return value }
  finally { await Promise.resolve(); seen.push("finally") }
}
export async function main(): Promise<string[]> {
  const result = await work()
  return [result.match({ ok: () => "wrong", error: e => e.message }), ...seen]
}`,
			stdout: "missing\nfinally",
		},
		{
			name: "fallible methods preserve their receiver",
			source: `class Missing extends Error {}
function read(): Result<number, Missing> { return 1 }
class Counter { value = 7; read(): Result<number, Missing> { return this.value + read()! } }
export function main(): string[] { return [String(new Counter().read().unwrapOr(0))] }`,
			stdout: "8",
		},
	})
}
