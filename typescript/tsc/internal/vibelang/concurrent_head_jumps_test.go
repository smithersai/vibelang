package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// VIP-19 keeps a nested item's labeled continue from leaving its fiber,
// including when explicit limits introduce a lexical head environment.
func TestConcurrentHeadEnvironmentContinues(t *testing.T) {
	for _, source := range []string{
		"export effect function f() { outer: for concurrent(1) (const n of [1]) { for concurrent(1) (const x of [1]) { continue outer } } }",
		"export effect function f() { outer: for concurrent (const n of [1]) { for concurrent(1) (const x of [1]) { continue outer } } }",
		"export effect function f() { outer: for concurrent(1) (const n of [1]) { for concurrent (const x of [1]) { continue outer } } }",
		"export effect function f() { outer: for (const n of [1]) { for concurrent(1) (const x of [1]) { for (const y of [1]) { continue outer } } } }",
	} {
		errors := errorsOf(t, source)
		if len(errors) != 1 || errors[0].Code() != 1905 {
			t.Fatalf("want exactly EK1905, got %v\n%s", errors, source)
		}
	}
	for _, source := range []string{
		"export effect function f() { outer: for concurrent(1) (const n of [1]) { continue outer } }",
		"export effect function f() { for concurrent(1) (const n of [1]) { const value = do { 1 }; void value } }",
		"export effect function f() { return do { for concurrent(1) (const n of [1]) { void n }; [1] } }",
		"export effect function f() { for concurrent(1) (const n of [1]) { inner: for (const x of [1]) { continue inner } } }",
	} {
		if errors := errorsOf(t, source); len(errors) != 0 {
			t.Fatalf("valid local continue: %v\n%s", errors, source)
		}
	}
}

// A generated RHS scope must keep the do proposal's source-head early errors.
func TestConcurrentHeadDoJumpErrors(t *testing.T) {
	for _, source := range []string{
		"effect function f() { for (const k of [1]) { for concurrent(do { if (k === 1) { continue }; 1 }) (const x of [k]) {} }; return 0 }",
		"effect function f() { own: for concurrent (const x of do { if (Math.random() > 2) { continue own }; [1] }) {}; return 0 }",
		"effect function f() { own: for concurrent(1) (const x of do { if (Math.random() > 2) { continue own }; [1] }) {}; return 0 }",
		"effect function f() { own: for concurrent(do { if (Math.random() > 2) { break own }; 1 }) (const x of [1]) {}; return 0 }",
	} {
		program, file, _, _ := editorProgram(t, source)
		all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
		errors := 0
		for _, d := range all {
			if d.Category() == diagnostics.CategoryError {
				errors++
			}
		}
		if errors != 1 || len(all) != 1 || all[0].Code() != 205 {
			t.Fatalf("want exactly EK0205, got %v\n%s", all, source)
		}
	}
}

func TestConcurrentSourceBlockLabels(t *testing.T) {
	for _, c := range []struct {
		name, source string
		code         int32
	}{
		{"const-prefix", "source: { const value = 1; for concurrent (const n of [1]) { continue source } }", 1107},
		{"let-prefix", "source: { let value = 1; for concurrent (const n of [1]) { continue source } }", 1107},
		{"pattern-prefix", "source: { const { value } = { value: 1 }; for concurrent (const n of [1]) { continue source } }", 1107},
		{"generated-spelling", "source: { const $concurrentLimit1 = 1; for concurrent (const n of [1]) { continue source } }", 1107},
		{"without-prefix", "source: { for concurrent (const n of [1]) { continue source } }", 1107},
		{"bounded-prefix", "source: { const value = 1; for concurrent(1) (const n of [1]) { continue source } }", 1107},
		{"head-break", "source: { const value = 1; for concurrent (const n of do { if (value === 1) break source; [1] }) { void n } }", 0},
		{"bounded-head-break", "source: { const value = 1; for concurrent(1) (const n of do { if (value === 1) break source; [1] }) { void n } }", 0},
		{"self-label", "source: { const limit = 1; items: for concurrent(limit) (const n of [1]) { continue items } }", 0},
	} {
		t.Run(c.name, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, "export effect function f() { "+c.source+" }")
			all := append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...)
			errors := 0
			var code int32
			for _, d := range all {
				if d.Category() == diagnostics.CategoryError {
					errors++
					code = d.Code()
				}
			}
			if c.code == 0 && errors != 0 || c.code != 0 && (errors != 1 || code != c.code) {
				t.Fatalf("want diagnostic %d, got %v", c.code, all)
			}
		})
	}
}
