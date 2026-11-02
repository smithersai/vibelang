package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// A signature probe must not cache a factory's returned literal as a plain
// callback, nor turn a function already assignable to A into a factory.
func TestFactoryDeclaredReturnBoundary(t *testing.T) {
	for _, test := range []struct {
		source  string
		factory bool
	}{
		{`export function target(): Effect.Effect<number, never, never> { const n=1; return () => n }`, true},
		{`export function target(tag: "a" | "b"): Effect.Effect<number, never, never> { switch(tag) { case "a": return () => 1; case "b": return () => 2 } }`, true},
		{`export const target = <A>(n:A): Effect.Effect<A, never, never> => () => n`, true},
		{`export const target: () => Effect.Effect<number> = () => () => 1`, true},
		{`export function target(): Effect.Effect<Effect.Effect<number>, never, never> { return () => 1 }`, false},
		{`export function target(): Effect.Effect<() => Effect.Effect<number>, never, never> { return () => 1 }`, false},
		{`export function target(): Effect.Effect<() => number, never, never> { return () => 1 }`, false},
		{`export function target(): Effect.Effect<object, never, never> { return () => 1 }`, false},
		{`export function target(): Effect.Effect<unknown, never, never> { return () => 1 }`, false},
		{`export function target(): Effect.Effect<number | (() => number), never, never> { return () => 1 }`, false},
	} {
		t.Run(test.source, func(t *testing.T) {
			source := "import { Effect } from \"effect\"; " + test.source
			p, file, _, _ := editorProgram(t, source)
			for _, d := range p.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s", d.String())
				}
			}
			c, done := p.GetTypeCheckerForFile(t.Context(), file)
			defer done()
			node := astnav.GetTouchingPropertyName(file, strings.Index(source, "target"))
			fn := esFunctionOf(c, node)
			if fn == nil || IsFactoryFunction(c, fn) != test.factory {
				t.Fatalf("factory=%v, want %v", fn != nil && IsFactoryFunction(c, fn), test.factory)
			}
		})
	}
}

func TestFactoryHover(t *testing.T) {
	for _, test := range []struct{ source, note string }{
		{`export function /*cursor*/make(): Effect.Effect<number, never, never> { return () => 1 }`, "Returns a program: its body runs when called; the program runs each time its caller runs it."},
		{`function make(): Effect.Effect<number, never, never> { return () => 1 }; function use(){ const p: Effect.Effect<number> = /*cursor*/make(); return p() }`, "Holds `make`'s program: called here, not run."},
		{`function make(): Effect.Effect<number, never, never> { return () => 1 }; function use(){ const /*cursor*/p: Effect.Effect<number> = make(); return p() }`, "Holds `make`'s program: called here, not run."},
	} {
		marked := "import { Effect } from \"effect\"; " + test.source
		pos := strings.Index(marked, "/*cursor*/")
		source := strings.ReplaceAll(marked, "/*cursor*/", "")
		p, file, _, _ := editorProgram(t, source)
		p.GetSemanticDiagnostics(t.Context(), file)
		c, done := p.GetTypeCheckerForFile(t.Context(), file)
		_, note := factoryQuickInfo(c, astnav.GetTouchingPropertyName(file, pos))
		done()
		if note != test.note {
			t.Fatalf("hover %q, want %q", note, test.note)
		}
	}
}
