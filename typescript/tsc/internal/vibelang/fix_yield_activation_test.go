package vibelang

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// rule-evidence: docs/design/src/002-running.md#4e7c582145499764 | `EK2104` offers a quick fix for `yield* e` in a nonproducer Effect body when `e` is an Effect: write `try e`.
// rule-evidence: docs/design/src/002-running.md#1c914b7d52e1944b | If the operand already runs with `try` and gives a non-Effect value, remove the redundant `yield*`, so `yield* try load()` becomes `try load()`.
// rule-evidence: docs/design/src/002-running.md#776b34d942c2543e | If that `try` gives another Effect, keep both runs as `try (try e)`.
// The "effect operand", "arrow" and "nested block" rows prove the first rule,
// "already run" the second, and "returned Effect" the third; every fixed
// source must compile.
func TestYieldActivationQuickFix(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"effect operand", "export effect function f() { return yield* Effect.succeed(1) }", "export effect function f() { return try Effect.succeed(1) }"},
		{"already run", "export effect function f() { return yield* try Effect.succeed(1) }", "export effect function f() { return try Effect.succeed(1) }"},
		{"returned Effect", "export effect function f() { return yield* try Effect.succeed(Effect.succeed(1)) }", "export effect function f() { return try (try Effect.succeed(Effect.succeed(1))) }"},
		{"comments", "export effect function f() { return yield /* before */ * /* after */ try Effect.succeed(1) }", "export effect function f() { return /* before */  /* after */ try Effect.succeed(1) }"},
		{"line comment", "export effect function f() { return yield* // keep\n try Effect.succeed(1) }", "export effect function f() { return (// keep\n try Effect.succeed(1)) }"},
		{"arrow", "export const f = effect () => yield* Effect.succeed(1)", "export const f = effect () => try Effect.succeed(1)"},
		{"nested block", "export effect function* f() { const p = effect { return yield* Effect.succeed(1) }; yield try p }", "export effect function* f() { const p = effect { return try Effect.succeed(1) }; yield try p }"},
		{"conditional", "export effect function f(b: boolean) { return yield* b ? Effect.succeed(1) : Effect.succeed(2) }", "export effect function f(b: boolean) { return try (b ? Effect.succeed(1) : Effect.succeed(2)) }"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := applyQuickFixOf(t, tc.source, EK2104.Code, diagnostics.CategoryError)
			if got != tc.want {
				t.Fatalf("got %s\nwant %s", got, tc.want)
			}
			clean, file, _, _ := editorProgram(t, got)
			for _, d := range clean.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Fatalf("fixed source does not compile: %s", d.String())
				}
			}
		})
	}
}

func TestYieldActivationFixBoundaries(t *testing.T) {
	for _, source := range []string{
		"export effect function f() { yield 1 }",
		"export effect function f(x = yield* Effect.succeed(1)) { return x }",
		"export effect function* f() { yield* Effect.succeed(1) }",
		"export function* f() { yield* [1, 2] }",
	} {
		_, file, _, _ := editorProgram(t, source)
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsYieldExpression(n) && yieldActivationFixable(n) {
				t.Fatalf("unsafe fix: %s", source)
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
}

func TestYieldActivationFixWitness(t *testing.T) {
	root := filepath.Join("..", "..", "..", "vibelang", "cases")
	source, err := os.ReadFile(filepath.Join(root, "diag-yield-star.fail", "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile(filepath.Join(root, "diag-yield-star-fixed-output", "main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	// Prove the error before exercising the real project --fix pipeline.
	program, file, _, _ := editorProgram(t, string(source))
	found := false
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		found = found || d.Code() == EK2104.Code && d.Category() == diagnostics.CategoryError
	}
	if !found {
		t.Fatal("witness does not reproduce EK2104")
	}
	result, name, fs := fixOnce(t, string(source))
	fixed := result.Files[name]
	if result.Err != nil || fixed == nil || fixed.Text != string(want) || len(result.Refused) != 0 || len(result.Remaining) != 0 {
		t.Fatalf("--fix failed: %+v; file %+v; want %s", result, fixed, want)
	}
	if err := os.WriteFile(name.AsString(), []byte(fixed.Text), 0600); err != nil {
		t.Fatal(err)
	}
	second := FixProject(t.Context(), fs, bundled.LibPath(), fixConfigOf(t, fs, name))
	if second.Err != nil || len(second.Files) != 0 || len(second.Refused) != 0 || len(second.Remaining) != 0 {
		t.Fatalf("second --fix failed: %+v", second)
	}
	clean, cleanFile, _, _ := editorProgram(t, string(want))
	for _, d := range clean.GetSemanticDiagnostics(t.Context(), cleanFile) {
		if d.Category() == diagnostics.CategoryError {
			t.Fatalf("fixed witness: %s", d.String())
		}
	}
}

// rule-evidence: docs/design/src/002-running.md#24b514e5cdf40a89 | A bare `yield`, a producer delegation and a parameter initializer have no such rewrite.
// Each source reports EK2104, and the editor offers no quick fix for it. The
// last row is the control: the same nonproducer body with an Effect operand
// gets the fix, so an empty answer is not a silent editor.
func TestYieldActivationFixBoundariesInEditor(t *testing.T) {
	for _, tc := range []struct {
		name, source string
		fix          bool
	}{
		{"bare yield", "export effect function f() { yield 1 }", false},
		{"bare yield of an Effect", "export effect function f() { yield Effect.succeed(1) }", false},
		{"parameter initializer", "export effect function f(x = yield* Effect.succeed(1)) { return x }", false},
		{"producer parameter initializer", "export effect function* f(x = yield* Effect.succeed(1)) { yield x }", false},
		{"delegation to a producer", "effect function* inner() { yield 1 }\nexport effect function f() { yield* inner() }", false},
		{"control: Effect operand", "export effect function f() { return yield* Effect.succeed(1) }", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, file, service, converters := editorProgram(t, tc.source)
			var found []*ast.Diagnostic
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Source() == diagnosticSource && d.Code() == EK2104.Code {
					found = append(found, d)
				}
			}
			if len(found) == 0 {
				t.Fatalf("no EK2104 in:\n%s", tc.source)
			}
			only := []lsproto.CodeActionKind{lsproto.CodeActionKindQuickFix}
			offered := 0
			for _, diagnostic := range found {
				d := lsconv.DiagnosticToLSPPush(t.Context(), converters, diagnostic)
				response, err := service.ProvideCodeActions(t.Context(), &lsproto.CodeActionParams{
					TextDocument: lsproto.TextDocumentIdentifier{Uri: lsconv.FileNameToDocumentURI(file.FileName())},
					Range:        d.Range, Context: &lsproto.CodeActionContext{Diagnostics: []*lsproto.Diagnostic{d}, Only: &only},
				})
				if err != nil {
					t.Fatal(err)
				}
				if response.CommandOrCodeActionArray != nil {
					for _, action := range *response.CommandOrCodeActionArray {
						if action.CodeAction != nil && action.CodeAction.Edit != nil {
							offered++
						}
					}
				}
			}
			if (offered > 0) != tc.fix {
				t.Fatalf("EK2104 quick fixes offered: %d, want fix %v, in:\n%s", offered, tc.fix, tc.source)
			}
		})
	}
}
