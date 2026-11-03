package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestPromiseResultCallGate(t *testing.T) {
	for _, tt := range []struct {
		name, decl, expression string
		want                   int
	}{
		{"new", "", "new Promise<number>((resolve) => resolve(1))", 1},
		{"import", "", `import("effect")`, 1},
		{"builtin", "", "Promise.resolve(1)", 1},
		{"union", "function read(): Promise<number> | undefined { return undefined }", "read()", 1},
		{"tag", "async function tag(_s: TemplateStringsArray) { return 7 }", "tag`x`", 1},
		{"optional", "const read: (() => Promise<number>) | undefined = undefined as (() => Promise<number>) | undefined", "read?.()", 1},
		{"generic", "function read<T extends PromiseLike<number>>(p:T):T{return p}; declare const p:Promise<number>", "read(p)", 1},
		{"intersection", "declare function read(): Promise<number> & {readonly extra:number}", "read()", 1},
		{"structural", "declare function read(): { then(onfulfilled: (n: number) => unknown): unknown }", "read()", 1},
		{"do", "", "do { Promise.resolve(1) }", 1},
		{"match", "", "match (true) { default: Promise.resolve(1); }", 1},
		{"any", "function read():any{return 1}", "read()", 0},
		{"unknown", "function read():unknown{return 1}", "read()", 0},
		{"never", "declare function read():never", "read()", 0},
		{"noncallable-then", "function read(){return {then:1}}", "read()", 0},
		{"bridge", "", "try Effect.tryPromise(() => Promise.resolve(1))", 0},
		{"success-data", "declare const p:Promise<number>", "try Effect.succeed(p)", 0},
		{"sync-boundary", "", "try Effect.orDie(Effect.try({try:()=>Promise.resolve(1),catch:error=>error}))", 0},
	} {
		t.Run(tt.name, func(t *testing.T) {
			source := tt.decl + "\nexport effect function probe(){const held=" + tt.expression + ";return 0}"
			promiseResultGateCheck(t, source, tt.want)
		})
	}
}

func TestPromiseResultCallGateContexts(t *testing.T) {
	for _, tt := range []struct {
		name, source string
		want         int
	}{
		{"top-level", "export const p=Promise.resolve(1)", 0},
		{"plain", "export function probe(){return Promise.resolve(1)}", 0},
		{"async", "export async function probe(){return Promise.resolve(1)}", 0},
		{"nested-plain", "export effect function probe(){const f=()=>Promise.resolve(1);return 0}", 0},
		{"nested-async", "export effect function probe(){const f=async()=>Promise.resolve(1);return 0}", 0},
		{"method", "export const object={effect probe(){const p=Promise.resolve(1);return 0}}", 1},
		{"class", "export class Box{effect probe(){const p=Promise.resolve(1);return 0}}", 1},
		{"arrow", "export const probe=effect()=>{const p=Promise.resolve(1);return 0}", 1},
		{"block", "export const probe=effect{const p=Promise.resolve(1);return 0}", 1},
		{"producer", "export effect function* probe(){const p=Promise.resolve(1);yield 0}", 1},
	} {
		t.Run(tt.name, func(t *testing.T) { promiseResultGateCheck(t, tt.source, tt.want) })
	}
}

func promiseResultGateCheck(t *testing.T, source string, want int) {
	t.Helper()
	program, file, _, _ := editorProgram(t, source)
	got := 0
	for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		if d.Code() == 404 {
			got++
		} else {
			t.Errorf("unexpected diagnostic %d at %d: %s", d.Code(), d.Pos(), source)
		}
	}
	if got != want {
		t.Errorf("got %d EK0404, want %d: %s", got, want, source)
	}
}
