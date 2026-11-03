package vibelangfuzz

import (
	"testing"
)

// Chapter 004, Class patterns: "A class arm whose class has its own `Symbol.customMatcher` ...
// reads and calls that matcher". Each place the key can stand types and compiles in a .vibe
// file without an import, and the declaration output still names it.
func TestSymbolCustomMatcherSpelling(t *testing.T) {
	w := NewWorkspace(t)
	for name, source := range map[string]string{
		"static":   "export class C { static [Symbol.customMatcher](s: unknown) { return s === 1 } }",
		"instance": "export class C { [Symbol.customMatcher](s: unknown) { return s === 1 } }",
		"object":   "export const O = { [Symbol.customMatcher](s: unknown) { return s === 1 } }",
		"arrow":    "export const O = { [Symbol.customMatcher]: (s: unknown) => s === 1 }",
		"read":     "export const key: symbol = Symbol.customMatcher",
		"typeof":   "class C { static [Symbol.customMatcher](s: unknown) { return true } }\nexport const f = C[Symbol.customMatcher]",
		"pattern":  "class C { static [Symbol.customMatcher](s: unknown) { return true } }\nexport function f(s: unknown) { return match (s) { when C: 1; default: 0; } }",
		"extract":  "class C { static [Symbol.customMatcher](s: unknown): [unknown] { return [s] } }\nexport function f(s: unknown) { return match (s) { when C(let v): v; default: 0; } }",
	} {
		t.Run(name, func(t *testing.T) {
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source + "\n"}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			for _, d := range r.Diagnostics {
				t.Errorf("%s: %d %s", source, d.Code(), d.String())
			}
		})
	}
}
