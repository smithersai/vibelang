package compiler

import "testing"

// The authored checker sees postfix ! before lowering has turned it into a
// Result-success projection. Its provisional error/any return type must not
// cause a synthetic, unreachable undefined success to widen the final function.
func TestPinnedForkResultCompletionUsesReachableControlFlow(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "fully returning inferred projection does not gain undefined",
			source: `class Missing extends Error {}
function payload(): Result<{ value: string }, Missing> { return { value: "native" } }
function projected() { return payload()!.value }
export function main(): string[] { const value: string = projected().unwrapOr("missing"); return [value] }`,
			stdout: "native",
		},
		{
			name: "returning branch pair does not gain undefined",
			source: `class Missing extends Error {}
function payload(): Result<{ value: string }, Missing> { return { value: "native" } }
function projected(flag: boolean) { if (flag) return payload()!.value; else return "other" }
export function main(): string[] { const a: string = projected(true).unwrapOr("missing"); const b: string = projected(false).unwrapOr("missing"); return [a, b] }`,
			stdout: "native\nother",
		},
		{
			name: "reachable implicit success still completes as undefined",
			source: `class Missing extends Error {}
function payload(): Result<number, Missing> { return 1 }
function work(flag: boolean) { const n = payload()!; if (flag) return n }
export function main(): string[] { return [String(work(false).unwrapOr(-1)), String(work(true).unwrapOr(-1))] }`,
			stdout: "undefined\n1",
		},
		{
			name: "explicit bare return remains an undefined success",
			source: `class Missing extends Error {}
function payload(): Result<number, Missing> { return 1 }
function work() { const n = payload()!; void n; return }
export function main(): string[] { return [String(work().isOk())] }`,
			stdout: "true",
		},
	})
}

func TestPinnedForkResultContractsUseCheckedTypeIdentity(t *testing.T) {
	runFailClosedCases(t, []failClosedCase{
		{
			name: "ReturnType contract lifts success and propagation",
			source: `class Missing extends Error {}
function payload(flag: boolean): Result<number, Missing> { if (flag) throw new Missing(); return 42 }
export function work(flag: boolean): ReturnType<typeof payload> { return payload(flag)! }
export function main(): string[] { return [String(work(false).unwrapOr(-1)), String(work(true).isError())] }`,
			stdout: "42\ntrue",
		},
		{
			name: "indexed access contract lifts success and throw",
			source: `class Missing extends Error {}
type Outputs = { value: Result<number, Missing> }
export function work(flag: boolean): Outputs["value"] { if (flag) throw new Missing(); return 42 }
export function main(): string[] { return [String(work(false).unwrapOr(-1)), String(work(true).isError())] }`,
			stdout: "42\ntrue",
		},
		{
			name: "conditional alias retains implicit undefined success",
			source: `class Missing extends Error {}
function payload(): Result<number | undefined, Missing> { return 42 }
type Returns<T> = T extends (...args: any[]) => infer R ? R : never
export function work(flag: boolean): Returns<typeof payload> { const n = payload()!; if (flag) return n }
export function main(): string[] { return [String(work(false).unwrapOr(-1)), String(work(true).unwrapOr(-1))] }`,
			stdout: "undefined\n42",
		},
		{
			name: "aliased promise contract retains async propagation",
			source: `class Missing extends Error {}
async function payload(flag: boolean): Promise<Result<number, Missing>> { if (flag) throw new Missing(); return 42 }
type Output = ReturnType<typeof payload>
export async function work(flag: boolean): Output { return (await payload(flag))! }
export async function main(): Promise<string[]> { return [String((await work(false)).unwrapOr(-1)), String((await work(true)).isError())] }`,
			stdout: "42\ntrue",
		},
		{
			name: "union of Result instantiations retains every failure variant",
			source: `class Missing extends Error {}
class Rejected extends Error {}
type Output = Result<number, Missing> | Result<number, Rejected>
export function work(flag: boolean): Output { if (flag) throw new Missing(); throw new Rejected() }
export function main(): string[] { return [work(true).match({ ok: n => String(n), error: e => e instanceof Missing ? "missing" : "rejected" }), work(false).match({ ok: n => String(n), error: e => e instanceof Missing ? "missing" : "rejected" })] }`,
			stdout: "missing\nrejected",
		},
		{
			name: "forwarded promise remains a promise without an outer Result",
			source: `class Missing extends Error {}
async function payload(): Promise<Result<number, Missing>> { return 42 }
function forward(): ReturnType<typeof payload> { return payload() }
export async function main(): Promise<string[]> { return [String((await forward()).unwrapOr(-1))] }`,
			stdout: "42",
		},
	})
}
