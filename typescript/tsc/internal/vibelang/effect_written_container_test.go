package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// VIP-1 requires a written Effect container, even when the written type
// would accept any value in ordinary TypeScript.
func TestEffectWrittenContainer(t *testing.T) {
	for _, annotation := range []string{"any", "unknown", "AnyAlias", "UnknownAlias", "(unknown)", "number | unknown", "number | any", "unknown & any", "never", "number"} {
		for _, form := range []string{
			"export effect function f(): %s { return 1 }",
			"export const f = effect function(): %s { return 1 }",
			"export const f = effect (): %s => 1",
			"export const o = { effect f(): %s { return 1 } }",
			"export class C { effect f(): %s { return 1 } }",
		} {
			t.Run(annotation+"/"+form, func(t *testing.T) {
				source := "type AnyAlias = any; type UnknownAlias = unknown;\n" + strings.Replace(form, "%s", annotation, 1)
				program, file, _, _ := editorProgram(t, source)
				count := 0
				for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
					if d.Source() == diagnosticSource && d.Code() == EK0106.Code {
						count++
						if d.Category() != diagnostics.CategoryError {
							t.Errorf("EK0106 must be an error: %v", d)
						}
					}
				}
				if count != 1 {
					t.Fatalf("got %d EK0106, want 1 in %s", count, source)
				}
			})
		}
	}
	for _, source := range []string{
		"export effect function f(): number!! { return 1 }",
		"type E = number!!; export effect function f(): E { return 1 }",
		"export effect function f(): unknown!! { return 1 }",
		"export effect function f(): any!! { return 1 }",
		"export effect function f() { return 1 }",
		"export function f(): unknown { return 1 }",
		"export effect function* f(): Stream.Stream<number> { yield 1 }",
	} {
		t.Run("control/"+source, func(t *testing.T) {
			program, file, _, _ := editorProgram(t, source)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("valid control reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestEffectWrittenContainerFix(t *testing.T) {
	for _, annotation := range []string{"any", "unknown", "AnyAlias", "UnknownAlias", "(unknown)", "number | unknown", "number | any"} {
		t.Run(annotation, func(t *testing.T) {
			source := "type AnyAlias = any; type UnknownAlias = unknown;\nexport effect function f(): " + annotation + " { return try Effect.fail('bad') }"
			original, file, _, _ := editorProgram(t, source)
			result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), original.CommandLine())
			fixed := result.Files[file.FileName()]
			if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
				t.Fatalf("--fix did not repair the annotation: %+v", result)
			}
			if !strings.Contains(fixed.Text, "effect function f()") || strings.Contains(fixed.Text, "f():") {
				t.Fatalf("want inferred Effect return, got %s", fixed.Text)
			}
			program, next, _, _ := editorProgram(t, fixed.Text+"\nconst checked: Effect.Effect<never, string> = f()")
			for _, d := range program.GetSemanticDiagnostics(t.Context(), next) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
			clean, _, _, _ := editorProgram(t, fixed.Text)
			again := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), clean.CommandLine())
			if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
				t.Fatalf("--fix is not idempotent: %+v", again)
			}
		})
	}
}

func TestEffectWrittenContainerQuickFix(t *testing.T) {
	for _, test := range []struct{ source, want string }{
		{"export const f = effect (): any => 1", "export const f = effect () => 1"},
		{"export const f = effect (): /*contract*/ unknown => 1", "export const f = effect () /*contract*/ => 1"},
		{"export const f = effect (): /* \"contract\" */ unknown => 1", "export const f = effect () /* \"contract\" */ => 1"},
		{"export const f = effect function(): unknown { return 1 }", "export const f = effect function() { return 1 }"},
		{"export const o = { effect f(): unknown { return 1 } }", "export const o = { effect f() { return 1 } }"},
		{"export class C { effect f(): any { return 1 } }", "export class C { effect f() { return 1 } }"},
		{"export effect function f() /*head*/: /*contract*/ unknown { return 1 }", "export effect function f() /*head*/ /*contract*/ { return 1 }"},
		{"export effect function f(): //contract\n unknown { return 1 }", "export effect function f() //contract\n { return 1 }"},
	} {
		t.Run(test.source, func(t *testing.T) {
			got := applyQuickFixOf(t, test.source, EK0106.Code, diagnostics.CategoryError)
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
			program, file, _, _ := editorProgram(t, got)
			for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("fixed source reports %s %d: %s", d.Source(), d.Code(), d.String())
				}
			}
		})
	}
}

func TestEffectWrittenContainerFixRequirements(t *testing.T) {
	source := "interface R { readonly brand: unique symbol }\ndeclare const input: number!string!R\nexport effect function f(): unknown { return try input }\n"
	original, file, _, _ := editorProgram(t, source)
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), original.CommandLine())
	fixed := result.Files[file.FileName()]
	if result.Err != nil || len(result.Refused) != 0 || fixed == nil {
		t.Fatalf("missing preserving repair: %+v", result)
	}
	checked, next, _, _ := editorProgram(t, fixed.Text+"\nconst checked: number!string!R = f()")
	for _, d := range checked.GetSemanticDiagnostics(t.Context(), next) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("inferred channels changed: %s %d: %s", d.Source(), d.Code(), d.String())
		}
	}
}

func TestEffectWrittenContainerRecursiveFixRefused(t *testing.T) {
	source := "export effect function f(n: number): any { return n ? try f(n - 1) : 0 }"
	original, file, _, _ := editorProgram(t, source)
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), original.CommandLine())
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	for _, refusal := range result.Refused {
		if refusal.Code == EK0106.Code {
			if fixed := result.Files[file.FileName()]; fixed != nil && !strings.Contains(fixed.Text, "): any") {
				t.Fatalf("refused edit was applied: %s", fixed.Text)
			}
			return
		}
	}
	t.Fatalf("recursive inference repair should be refused: %+v", result)
}

func TestEffectWrittenContainerBodylessFix(t *testing.T) {
	source := "export effect function f(n: number): unknown;\nexport effect function f(n: number) { return n }"
	want := strings.Replace(source, "): unknown;", "): unknown!!;", 1)
	got := applyQuickFixOf(t, source, EK0106.Code, diagnostics.CategoryError)
	if got != want {
		t.Fatalf("bodyless signature must keep its contract: %q", got)
	}
	program, file, _, _ := editorProgram(t, got)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("fixed overload reports %s %d: %s", d.Source(), d.Code(), d.String())
		}
	}
}

func TestEffectWrittenContainerLiteralCommentsDeclined(t *testing.T) {
	source := "export const f = effect (): unknown | \"https://example.test\" => 1"
	original, _, _, _ := editorProgram(t, source)
	result := FixProject(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), original.CommandLine())
	if result.Err != nil || len(result.Files) != 0 || len(result.Refused) != 0 {
		t.Fatalf("ambiguous literal text should offer no destructive edit: %+v", result)
	}
}
