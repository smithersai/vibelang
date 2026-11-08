package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// An explicit Effect activation keeps its kind even when created by a native
// wrapper thunk. The inferred wrapper success must retain the nested Effect.
func TestWrapperEffectActivation(t *testing.T) {
	for _, wrapper := range []string{
		"Effect.try(() => { %s })",
		"Effect.try({ try: () => { %s }, catch: (e) => e })",
		"Effect.tryPromise(async () => { %s })",
		"tryPromise(async () => { %s })",
		"sync(() => { %s })",
	} {
		for _, form := range []string{
			"effect function nested() { return 7 }; return nested",
			"return effect function nested() { return 7 }",
			"return effect () => 7",
			"return { effect nested() { return 7 } }.nested",
			"class C { effect nested() { return 7 } }; return new C().nested",
			"return () => effect { return 7 }",
		} {
			t.Run(wrapper+"/"+form, func(t *testing.T) {
				source := "export const wrapped = " + strings.Replace(wrapper, "%s", form, 1) + "\nconst checked: Effect.Effect<() => Effect.Effect<number>, unknown> = wrapped"
				program, file, _, _ := editorProgram(t, source)
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Category() == diagnostics.CategoryError {
						t.Fatalf("explicit Effect source: %s", d.String())
					}
				}

			})
		}
	}
}

// Failure and requirement channels belong to the explicit inner activation,
// while a new wrapper in its body keeps ordinary native-thunk semantics.
func TestWrapperEffectChannels(t *testing.T) {
	for _, source := range []string{
		"export const wrapped = Effect.try(() => effect () => { throw 'bad' }); const checked: Effect.Effect<() => Effect.Effect<never, string>, unknown> = wrapped",
		"export const wrapped = Effect.try(() => effect () => { return try Effect.succeed(7) }); const checked: Effect.Effect<() => Effect.Effect<number>, unknown> = wrapped",
		"service Value { readonly value: number }; export const wrapped = Effect.try(() => effect () => { const value = try Value; return value.value }); const checked: Effect.Effect<() => Effect.Effect<number, never, Value>, unknown> = wrapped",
		"export const wrapped = Effect.try(() => effect function*() { yield 7 }); const checked: Effect.Effect<() => Stream.Stream<number>, unknown> = wrapped",
		"export const wrapped = Effect.try(() => effect () => { return try Effect.try(() => JSON.parse('7') as number) }); const checked: Effect.Effect<() => Effect.Effect<number, unknown>, unknown> = wrapped",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("inner Effect contract: %s", d.String())
				}
			}
		})
	}
}

func TestWrapperEffectReturnedObject(t *testing.T) {
	for _, wrapper := range []string{
		"Effect.try(() => ({ effect nested() { runs++; return runs } }))",
		"Effect.try({ try: () => ({ effect nested() { runs++; return runs } }), catch: (e) => e })",
		"sync(() => ({ effect nested() { runs++; return runs } }))",
	} {
		t.Run(wrapper, func(t *testing.T) {
			source := "export effect function inspect() { let runs = 0; const factory = try " + wrapper + "; const program = factory.nested(); return try program }"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("returned object method: %s", d.String())
				}
			}
		})
	}
}

func TestWrapperEffectDirectThunk(t *testing.T) {
	for _, wrapper := range []string{
		"Effect.try(effect () => 7)",
		"Effect.try({ try: effect () => 7, catch: (e) => e })",
		"sync(effect () => 7)",
	} {
		t.Run(wrapper, func(t *testing.T) {
			source := "export const wrapped = " + wrapper + "; const checked: Effect.Effect<Effect.Effect<number>, unknown> = wrapped"
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("explicit thunk result: %s", d.String())
				}
			}
		})
	}
}

// A computed member name is evaluated by the wrapper before the marked
// callable exists; only the callable body starts an Effect activation.
func TestWrapperEffectDefinitionContext(t *testing.T) {
	for _, definition := range []string{
		"return { effect [key()]() { return body() } }",
		"class C { effect [key()]() { return body() } }; return C",
	} {
		t.Run(definition, func(t *testing.T) {
			source := "function key() { return 'value' }; function body() { return 7 }; export const wrapped = Effect.try(() => { " + definition + " })"
			_, file, _, _ := editorProgram(t, source)
			seen := map[string]bool{}
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsCallExpression(node) && ast.IsIdentifier(node.Expression()) {
					name := node.Expression().Text()
					if name == "key" || name == "body" {
						seen[name] = true
						if got, want := inHatch(node), name == "key"; got != want {
							t.Errorf("%s: native wrapper context = %v, want %v", name, got, want)
						}
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !seen["key"] || !seen["body"] {
				t.Fatalf("missing source invocations: %v", seen)
			}
		})
	}
}
