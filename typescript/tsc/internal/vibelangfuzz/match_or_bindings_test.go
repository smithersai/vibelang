package vibelangfuzz

import (
	"fmt"
	"testing"
)

// Chapter 004, Pattern bindings: "An or pattern shares one lexical cell for a name bound
// with the same keyword in its alternatives." Every way of writing alternatives that bind
// one name compiles in each form a pattern takes, with no EK or TS diagnostic.
func TestOrPatternBindingsCompile(t *testing.T) {
	w := NewWorkspace(t)
	patterns := []string{
		"{ a: let v } or { b: let v }",
		"[let v] or [0, let v]",
		"[let v] or { b: let v }",
		"({ a: let v } and if (true)) or { b: let v }",
		"{ a: [let v] } or { b: { c: let v } }",
		"{ a: const v } or { b: const v }",
		"(not(let v)) or { b: let v }",
	}
	forms := []string{
		"export function f(s: unknown) { return match (s) { when %s: v; default: 0; } }",
		"export function f(s: unknown) { const r = match (s) { when %s: v; default: 0; }; return r }",
		"export function f(s: unknown) { if (s is %s) return v; return 0 }",
		"export function f(s: unknown) { if (!(s is %s)) return 0; return v }",
		"export function f(xs: unknown[]) { for (const s of xs) { if (s is %s) return v; } return 0 }",
	}
	for i, form := range forms {
		for _, pattern := range patterns {
			t.Run(fmt.Sprintf("%d/%s", i, pattern), func(t *testing.T) {
				source := fmt.Sprintf(form, pattern)
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
}
