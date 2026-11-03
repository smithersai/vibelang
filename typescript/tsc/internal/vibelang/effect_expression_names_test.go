package vibelang

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Include parser diagnostics: EK1702 is a syntax error, not a checker error.
func expressionNameErrors(t *testing.T, source string) []*ast.Diagnostic {
	p, file, _, _ := editorProgram(t, source)
	var errors []*ast.Diagnostic
	all := append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...)
	for _, d := range all {
		if d.Category() == diagnostics.CategoryError {
			errors = append(errors, d)
		}
	}
	return errors
}

func TestEffectExpressionNames(t *testing.T) {
	for _, name := range []string{"fork", "join", "f\\u006frk", "j\\u006fin"} {
		for _, star := range []string{"", "*"} {
			body := "return 1"
			if star != "" {
				body = "yield 1"
			}
			source := "export const item = effect function" + star + " " + name + "() { " + body + " }"
			errors := expressionNameErrors(t, source)
			if len(errors) != 1 || errors[0].Code() != 1702 || errors[0].Source() != diagnosticSource {
				t.Errorf("%s: got %v, want EK1702", source, errors)
			}
		}
	}
}

func TestEffectExpressionNameRecursiveFix(t *testing.T) {
	for _, source := range []string{
		"export const item = effect function fork() { return () => fork }",
		"export const item = effect function fork(value = () => fork) { return value }",
		"export const item = effect function fork(value = () => fork.name): string!! { try yieldNow(); return value() }",
	} {
		program, file, _, _ := editorProgram(t, source)
		result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
		if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
			t.Fatalf("recursive fix: %+v", result)
		}
		fixed := result.Files[file.FileName()]
		if !strings.Contains(fixed.Text, `Object.defineProperty(fork, "name", { value: "fork" })`) {
			t.Fatalf("lost callable name: %s", fixed.Text)
		}
		if errors := expressionNameErrors(t, fixed.Text); len(errors) != 0 {
			t.Fatalf("fixed recursive diagnostics: %v\n%s", errors, fixed.Text)
		}
	}
}

func TestEffectExpressionNameControls(t *testing.T) {
	for _, source := range []string{
		"export effect function fork() { return 1 }",
		"export effect function* join() { yield 1 }",
		"export const item = effect function forkOne() { return 1 }",
		"export const item = { effect join() { return 1 } }",
		"export class Item { effect *fork() { yield 1 } }",
		"effect function outer() { const item = function fork() { return 1 }; return 1 }",
		"effect function outer() { const item = function* join() { yield 1 }; return 1 }",
	} {
		if errors := expressionNameErrors(t, source); len(errors) != 0 {
			t.Errorf("%s: %v", source, errors)
		}
	}
}

// The project fixer is the path used by --fix; check both the proposed text
// and its next diagnostic pass, including comments and escaped source names.
func TestEffectExpressionNameFix(t *testing.T) {
	for _, spelling := range []string{"fork", "join", "f\\u006frk", "j\\u006fin"} {
		for _, star := range []string{"", "*"} {
			body := "return 1"
			if star != "" {
				body = "yield 1"
			}
			source := "export const item = effect function" + star + " /*keep*/ " + spelling + "() { " + body + " }\n"
			want := "export const item = (() => { const " + spelling + " = effect function" + star + " /*keep*/ () { " + body + " }; return " + spelling + " })()\n"
			t.Run(spelling+star, func(t *testing.T) {
				program, file, service, converters := editorProgram(t, source)
				pos := strings.Index(source, spelling)
				actions, err := fiberNameActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: core.NewTextRange(pos, pos+len(spelling)), Program: program, LS: service})
				if err != nil || len(actions) != 1 {
					t.Fatalf("quick fix: %v %v", actions, err)
				}
				if got := applyEditorEdits(t, file, converters, actions[0].Changes); got != want {
					t.Fatalf("quick fix writes %s, want %s", got, want)
				}
				result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
				if result.Err != nil || len(result.Files) != 1 || len(result.Refused) != 0 {
					t.Fatalf("fix: %+v", result)
				}
				fixed := result.Files[file.FileName()]
				if fixed.Text != want {
					t.Fatalf("got:\n%s\nwant:\n%s", fixed.Text, want)
				}
				if errors := expressionNameErrors(t, fixed.Text); len(errors) != 0 {
					t.Fatalf("fixed diagnostics: %v", errors)
				}
				if !strings.Contains(fixed.Text, "/*keep*/") {
					t.Fatal("lost comment")
				}
				if err := os.WriteFile(file.FileName().AsString(), []byte(fixed.Text), 0600); err != nil {
					t.Fatal(err)
				}
				again := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
				if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
					t.Fatalf("second fix: %+v", again)
				}
			})
		}
	}
}

// Moving a contextual expression into a local constant can lose parameter
// inference. The editor must not offer that unchecked edit; the CLI gate
// must keep the original rather than introduce an implicit-any error.
func TestEffectExpressionNameContextualFix(t *testing.T) {
	const source = "export const item: (value: number) => number!! = effect function fork(value) { return value }"
	if errors := expressionNameErrors(t, source); len(errors) != 1 || errors[0].Code() != 1702 {
		t.Fatalf("contextual witness: %v", errors)
	}
	program, file, service, _ := editorProgram(t, source)
	pos := strings.Index(source, "fork")
	actions, err := fiberNameActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: core.NewTextRange(pos, pos+4), Program: program, LS: service})
	if err != nil || len(actions) != 0 {
		t.Fatalf("unchecked contextual quick fix: %v %v", actions, err)
	}
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
	if result.Err != nil || len(result.Files) != 0 || len(result.Refused) == 0 {
		t.Fatalf("contextual fix gate: %+v", result)
	}
}

func TestEffectExpressionNameShadowedObject(t *testing.T) {
	const source = "const Object = 0; export const item = effect function fork() { return () => fork }"
	program, file, service, _ := editorProgram(t, source)
	pos := strings.Index(source, "fork")
	actions, err := fiberNameActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Span: core.NewTextRange(pos, pos+4), Program: program, LS: service})
	if err != nil || len(actions) != 0 {
		t.Fatalf("shadowed Object repair: %v %v", actions, err)
	}
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), program.CommandLine(), FixOptions{})
	if result.Err != nil || len(result.Files) != 0 {
		t.Fatalf("shadowed Object fix: %+v", result)
	}
}
