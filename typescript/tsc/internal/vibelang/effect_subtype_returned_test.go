package vibelang

import (
	"strings"
	"testing"
)

// VIP-5 keeps returned Effect subtypes as success data. Own EK4802
// belongs to inferred arguments, including in broad success contexts.
func TestReturnedEffectSubtypeIsData(t *testing.T) {
	const prelude = "interface Statement extends Effect.Effect<number> { readonly sql: string }\n" +
		"declare const stmt: (parts: TemplateStringsArray) => Statement\n" +
		"declare const held: Statement\n" +
		"declare const make: () => Statement\n"
	for _, c := range []struct {
		name, source string
		reported     bool
	}{
		{"tag", "export const f = effect { return try Effect.suspend(effect () => stmt`a`) }\n", false},
		{"value", "export const f = effect { return try Effect.suspend(effect () => held) }\n", false},
		{"call", "export const f = effect { return try Effect.suspend(effect () => make()) }\n", false},
		{"returned", "export const f = effect { return try Effect.suspend(effect () => { return make() }) }\n", false},
		{"arms", "export const f = effect (c: boolean) => try Effect.suspend(effect () => c ? held : make())\n", false},
		{"exit", "export const f = effect { return try Effect.suspend(effect () => Exit.succeed(1)) }\n", false},
		{"unknown context", "export const f: () => unknown!! = effect () => held\n", false},
		{"written unknown", "export const f = effect (): unknown!! => make()\n", false},
		{"tried", "export const f = effect { return try Effect.suspend(effect () => try make()) }\n", false},
		{"success names it", "export const f = effect { return try Effect.suspend(effect (): Statement!! => held) }\n", false},
		{"plain thunk", "export const f = Effect.suspend(() => make())\n", false},
		{"no context", "export const f = effect () => make()\n", false},
		{"written number", "export const f = effect (): number!! => try make()\n", false},
	} {
		t.Run(c.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, prelude+c.source)
			var reported []string
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK4802.Code {
					reported = append(reported, d.String())
				}
			}
			if c.reported != (len(reported) == 1) || len(reported) > 1 {
				t.Fatalf("EK4802 reports: %s; want reported = %v", strings.Join(reported, "; "), c.reported)
			}
		})
	}
}
