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
