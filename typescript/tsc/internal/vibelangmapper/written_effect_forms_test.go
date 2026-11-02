package vibelangmapper

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

// VIP-1: the written effect keyword decides the callable's kind, including
// when an ordinary TypeScript callback destination ignores its result.
func TestResolverWrittenEffectLambda(t *testing.T) {
	cases := map[string]string{
		"void arrow":          "const f: () => void = effect () => 7",
		"unknown arrow":       "const f: () => unknown = effect () => 7",
		"Function arrow":      "const f: Function = effect () => 7",
		"commented bare":      "const f: (n: number) => void = effect /*keep*/ n => n",
		"bare arrow":          "const f: (n: number) => void = effect n => n",
		"function expression": "const f: () => void = effect function () { return 7 }",
		"named function":      "const f: Function = effect function build() { return 7 }",
		"object method":       "const box: { run(): void } = { effect run() { return 7 } }",
		"alias":               "type Callback = () => void; const f: Callback = effect () => 7",
		"array":               "const fs: ReadonlyArray<() => void> = [effect () => 7]",
		"argument":            "declare function take(f: () => void): void; take(effect () => 7)",
		"return annotation":   "const f = effect (): Effect.Effect<Effect.Effect<number>> => Effect.succeed(7)",
	}
	for name, source := range cases {
		t.Run(name, func(t *testing.T) {
			raw := resolve(t, source)
			if d := raw.lambda(t, "effect"); d.Form != FormEffectFn {
				t.Fatalf("written effect lambda got %s (%s): %s", d.Form, d.Provenance, d.Note)
			}
			// The projection normalizes keywords before resolving forms; that
			// pass must preserve the same decision as the original source.
			projected := lower(source, FileContext{})
			count := 0
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if isLambda(n) {
					count++
					if d := projected.forms.Lambda(n); d.Form != FormEffectFn {
						t.Errorf("projection changed written kind to %s (%s): %s", d.Form, d.Provenance, d.Note)
					}
				}
				n.ForEachChild(visit)
				return false
			}
			projected.file.AsNode().ForEachChild(visit)
			if count != 1 {
				t.Fatalf("projected source has %d lambdas; want 1", count)
			}
		})
	}
}

func TestResolverUnmarkedVoidLambdasStayPlain(t *testing.T) {
	for _, source := range []string{
		"const f: () => void = () => 7",
		"const f: () => void = function () { return 7 }",
		"const box: { run(): void } = { run() { return 7 } }",
	} {
		r := resolve(t, source)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if isLambda(n) {
				if d := r.Lambda(n); d.Form != FormPlain {
					t.Errorf("unmarked void callback got %s: %s", d.Form, source)
				}
			}
			n.ForEachChild(visit)
			return false
		}
		r.file.AsNode().ForEachChild(visit)
	}
}

func TestProjectedNestedWrittenEffectLambdas(t *testing.T) {
	source := "const f: () => unknown = effect () => effect () => 7"
	p := lower(source, FileContext{})
	count := 0
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isLambda(n) {
			count++
			if d := p.forms.Lambda(n); d.Form != FormEffectFn {
				t.Errorf("nested written effect changed to %s (%s)", d.Form, d.Provenance)
			}
		}
		n.ForEachChild(visit)
		return false
	}
	p.file.AsNode().ForEachChild(visit)
	if count != 2 {
		t.Fatalf("found %d nested lambdas; want 2", count)
	}
}
