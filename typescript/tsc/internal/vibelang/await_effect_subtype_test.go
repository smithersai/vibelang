package vibelang

import "testing"

// `await` asks the Result test (chapter 2): "at least one union member is an
// Effect", a subtype too (EK0103). A statement that names a subtype is data
// (D24; cases/floating-program-reference.fail), and a call statement is
// EK4301's, so EK4801 stays out of both.
func TestAwaitedEffectSubtypeReported(t *testing.T) {
	const prelude = "interface Statement extends Effect.Effect<number> { readonly sql: string }\n" +
		"declare const held: Statement\n" +
		"declare const make: () => Statement\n"
	for _, c := range []struct {
		name, source string
		want         int32
	}{
		{"reference", "export const f = effect () => { held; return 1 }\n", 0},
		{"parenthesized", "export const f = effect () => { (held); return 1 }\n", 0},
		{"conditional", "export const f = effect (c: boolean) => { c ? held : held; return 1 }\n", 0},
		{"plain function", "export const f = () => { held; return 1 }\n", 0},
		{"call", "export const f = effect () => { make(); return 1 }\n", EK4301.Code},
		{"tried exit", "export const f = effect () => { try Effect.exit(Effect.void); return 1 }\n", 0},
		{"tried", "export const f = effect () => { try held; return 1 }\n", 0},
		{"plain value", "export const f = effect (n: number) => { n; return 1 }\n", 0},
		{"await subtype", "export async function f() { await held }\n", EK0103.Code},
		{"await union", "export async function f(x: number!! | undefined) { await x }\n", EK0103.Code},
		{"await subtype union", "export async function f(x: Statement | Promise<number>) { await x }\n", EK0103.Code},
		{"await any", "export async function f(x: any) { await x }\n", 0},
		{"await unknown", "export async function f(x: unknown) { await x }\n", 0},
		{"await promise", "export async function f(x: Promise<number>) { await x }\n", 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prelude+c.source)
			var got []int32
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && (d.Code() == EK4801.Code || d.Code() == EK4301.Code || d.Code() == EK0103.Code) {
					got = append(got, d.Code())
				}
			}
			if c.want == 0 && len(got) != 0 || c.want != 0 && (len(got) != 1 || got[0] != c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}
