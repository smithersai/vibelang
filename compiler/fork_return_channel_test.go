package compiler

import "testing"

// failures.mdx's lifting and propagation rules apply to the value after
// lowering, not the upstream checker's non-null-assertion interpretation of !.
// Every accepted case executes both channels through the emitted native code.
func TestPinnedForkReturnChannelProvenance(t *testing.T) {
	const head = `class Failure extends Error {}
function next(fail: boolean): Result<string, Failure> { if (fail) throw new Failure("failed"); return "value" }
`
	for _, tc := range []struct{ name, body string }{
		{"nullish left", `return next(fail)! ?? "fallback"`},
		{"logical or", `return next(fail)! || "fallback"`},
		{"logical and", `return next(fail)! && "value"`},
		{"conditional", `return fail ? next(true)! : next(false)!`},
		{"comma", `function noop() {} return (noop(), next(fail)!)`},
		{"const alias", `const first = next(fail)!; const second = first; return second`},
		{"satisfies wrapper", `const first = (next(fail)! satisfies unknown); return first`},
		{"unwritten let", `let value = next(fail)!; return value`},
		{"for initializer", `for (let value = next(fail)!; value.length > 0;) return value; return ""`},
		{"shadow write", `let value = next(fail)!; function other() { let value = "a"; value = "b"; return value }; other(); return value`},
	} {
		runFailClosedCases(t, []failClosedCase{{name: tc.name, source: head + `
function work(fail: boolean): Result<string, Failure> { ` + tc.body + ` }
export function main(): string[] { return [work(false).match({ok: v => v, error: e => e.message}), work(true).match({ok: v => v, error: e => e.message})] }
`, stdout: "value\nfailed"}})
	}
	runFailClosedCases(t, []failClosedCase{
		{name: "inferred member failure forwarded through binding", source: head + `
function work(): Result<number, Failure> { const handlers = {ok: (n: number) => {throw new Failure("failed")}}; const value = handlers.ok(1); return value }
export function main(): string[] { return [work().match({ok: v => String(v), error: e => e.message})] }
`, stdout: "failed"},
		{name: "inferred direct failure", source: head + `
function fail() { throw new Failure("failed") }
function work(): Result<number, Failure> { return fail() }
export function main(): string[] { return [work().match({ok: v => String(v), error: e => e.message})] }
`, stdout: "failed"},
		{name: "inferred async failure", source: head + `
async function fail() { throw new Failure("failed") }
async function work(): Promise<Result<number, Failure>> { const value = await fail(); return value }
export async function main(): Promise<string[]> { return [(await work()).match({ok: v => String(v), error: e => e.message})] }
`, stdout: "failed"},
		{name: "globally available Panic type is nominal", source: `
import {Panic as PanicValue} from "vibelang:exceptions";
function work(): Result<number, Panic> { return Result.try(() => {throw new Error("failed")}) }
export function main(): string[] {return [work().match({ok: v => String(v), error: e => e instanceof PanicValue ? "panic" : "wrong"})]}
`, stdout: "panic"},
	})
}

func TestPinnedForkReturnChannelDoesNotTrustChangedBindings(t *testing.T) {
	for _, write := range []string{
		`if (flag) value = next()`,
		`function change() {value = next()}; if (flag) change()`,
		`if (flag) [value] = [next()]`,
	} {
		source := `class Failure extends Error {}
function next(): Result<string, Failure> { return "value" }
export function work(flag: boolean): Result<string, Failure> {let value = next()!; ` + write + `; return value}`
		got := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}})
		if !got.EmitSkipped || len(got.Diagnostics) == 0 || len(got.Artifacts) != 0 {
			t.Fatalf("a mixed Result/success binding was accepted or emitted: %+v", got)
		}
	}
}

func TestPinnedForkAmbientPanicTypeDoesNotInstallAValue(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, source := range []string{
		`export function make() { return new Panic("not a global constructor") }`,
		`export const constructor = Panic`,
	} {
		result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}})
		if err != nil {
			t.Fatal(err)
		}
		requireCode(t, result, "TS2693", "Panic")
		if !result.EmitSkipped || len(result.Artifacts) != 0 {
			t.Fatal("the ambient type installed a constructor value")
		}
	}
}
