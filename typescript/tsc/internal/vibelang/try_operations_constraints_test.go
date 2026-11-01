package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

func TestTryOperationArrayConstraints(t *testing.T) {
	for _, test := range []struct {
		name, source string
		reject       bool
	}{
		{"generic array", "effect function f<T extends ReadonlyArray<Effect.Effect<number>>>(xs: T) { return try.all xs }", false},
		{"generic element", "effect function f<T extends Effect.Effect<number>>(xs: ReadonlyArray<T>) { return try.all xs }", false},
		{"never array", "effect function f(xs: never[]) { return try.all xs }", false},
		{"empty tuple", "effect function f(xs: readonly []) { return try.all xs }", false},
		{"derived array", "interface Values extends ReadonlyArray<Effect.Effect<number>> {} effect function f(xs: Values) { return try.all xs }", false},
		{"intersection", "effect function f(xs: ReadonlyArray<Effect.Effect<number>> & { readonly name: string }) { return try.all xs }", false},
		{"Exit elements", "effect function f(xs: ReadonlyArray<Exit.Exit<number, string>>) { return try.all xs }", false},
		{"Config elements", "effect function f(xs: ReadonlyArray<Config.Config<number>>) { return try.all xs }", false},
		{"Effect intersection", "effect function f(xs: ReadonlyArray<Effect.Effect<number> & { readonly name: string }>) { return try.all xs }", false},
		{"function literal", "effect function f() { return try.all [() => 1] }", true},
		{"function array", "effect function f(xs: ReadonlyArray<() => number>) { return try.all xs }", true},
		{"Effect function array", "effect function f(xs: ReadonlyArray<() => Effect.Effect<number>>) { return try.all xs }", true},
		{"callable Effect returning Effect", "effect function f(xs: ReadonlyArray<Effect.Effect<number> & (() => Effect.Effect<string>)>) { const values = try.all xs; const n: number = values[0]; return n }", false},
		{"callable Effect literal", "effect function f(value: Effect.Effect<number> & (() => Effect.Effect<string>)) { const values = try.all [value]; const n: number = values[0]; return n }", false},
		{"callable Effect", "effect function f(xs: ReadonlyArray<Effect.Effect<number> & (() => number)>) { return try.all xs }", false},
		{"number elements", "effect function f(xs: ReadonlyArray<number>) { return try.all xs }", true},
		{"unconstrained", "effect function f<T>(xs: T) { return try.all xs }", true},
		{"record", "effect function f(xs: {a: Effect.Effect<number>}) { return try.all xs }", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, test.source)
			found := false
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Code() == EK1801.Code {
					found = true
				}
				if d.Category() == diagnostics.CategoryError && !test.reject {
					t.Errorf("unexpected diagnostic %d", d.Code())
				}
			}
			if found != test.reject {
				t.Fatalf("EK1801=%v, want %v", found, test.reject)
			}
		})
	}
}
