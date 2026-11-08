package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"strings"
	"testing"
)

func TestErrorInheritanceAdmission(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, tag := range []string{`"Base" as string`, `"Base" as "Base" | "Child"`} {
			for _, body := range []string{"{}", "{ value: number }", "{ value?: number }", "{ get label(): string { return this.id } }"} {
				source := errorInheritanceSource(form, tag, body)
				t.Run(form+tag+body, func(t *testing.T) {
					program, file, _, _ := editorProgram(t, source)
					count := 0
					for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
						if d.Code() == 2117 {
							count++
						} else if d.Category() == diagnostics.CategoryError {
							t.Errorf("unexpected independent error: %s", d.String())
						}
					}
					if count != 1 {
						t.Fatalf("got %d EK2117, want one for extends clause", count)
					}
				})
			}
		}
	}
}

func errorInheritanceSource(form, tag, body string) string {
	base := "class Base extends Data.TaggedError(" + tag + ")<{ readonly id: string }> {}"
	if form == "schema error" {
		base = "class Base extends Schema.TaggedError<Base>()(" + tag + ", { id: Schema.String }) {}"
	}
	return "import { Data, Schema } from \"effect\"\n" + base + "\nexport " + form + " Child extends Base " + body + "\n"
}

func TestErrorInheritanceQuickFix(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, body := range []string{"{}", "{ value: number }", "{ value?: number }", "{ get label(): string { return this.id } }"} {
			source := errorInheritanceSource(form, `"Base" as string`, body)
			t.Run(form+body, func(t *testing.T) {
				fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
				if !strings.Contains(fixed, "class Child extends") {
					t.Fatalf("not a class: %s", fixed)
				}
				program, file, _, _ := editorProgram(t, fixed)
				for _, d := range append(program.GetSyntacticDiagnostics(t.Context(), file), program.GetSemanticDiagnostics(t.Context(), file)...) {
					if d.Category() == diagnostics.CategoryError {
						t.Errorf("%s\n%s", d.String(), fixed)
					}
				}
			})
		}
	}
}

func TestErrorInheritanceNativeClassesUnaffected(t *testing.T) {
	source := "import { Data } from \"effect\"; class Base extends Data.TaggedError(\"Base\" as string)<{readonly id:string}> {}; export class Child extends Base {}"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 2117 {
			t.Errorf("native class rejected: %s", d.String())
		}
	}
}

func TestErrorInheritanceNamespaceNamedSchema(t *testing.T) {
	source := "import { Data } from \"effect\"; namespace Schema { export class Base extends Data.TaggedError(\"Base\" as string)<{readonly id:string}> {} }; export error Child extends Schema.Base { value:number }"
	fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
	program, file, _, _ := editorProgram(t, fixed)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Category() == diagnostics.CategoryError {
			t.Errorf("%s\n%s", d.String(), fixed)
		}
	}
}

func TestErrorInheritanceQuickFixRefusesNarrowParent(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		for _, tag := range []string{`"Base"`, `"Base" as "Base" | "Other"`} {
			t.Run(form+tag, func(t *testing.T) {
				source := errorInheritanceSource(form, tag, "{}")
				program, file, service, _ := editorProgram(t, source)
				program.GetSemanticDiagnostics(t.Context(), file)
				var class *ast.Node
				var visit func(*ast.Node) bool
				visit = func(n *ast.Node) bool {
					if f, _ := errorFormOf(n); f == errorFormSubclass || f == errorFormSchemaSubclass {
						class = n
					}
					return n.ForEachChild(visit)
				}
				file.AsNode().ForEachChild(visit)
				if class == nil {
					t.Fatal("missing inherited class")
				}
				actions, err := errorInheritanceClassActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}, class)
				if err != nil {
					t.Fatal(err)
				}
				if len(actions) != 0 {
					t.Fatal("offered a class with an incompatible inherited tag")
				}
			})
		}
	}
}

func TestErrorInheritanceQuickFixRefusesWrongBaseFlavor(t *testing.T) {
	for _, source := range []string{
		"import { Data } from \"effect\"; class Base extends Data.TaggedError(\"Base\" as string)<{}> {}; schema error Child extends Base {}",
		"import { Schema } from \"effect\"; class Base extends Schema.TaggedError<Base>()(\"Base\" as string, {}) {}; error Child extends Base {}",
	} {
		t.Run(source, func(t *testing.T) {
			program, file, service, _ := editorProgram(t, source)
			program.GetSemanticDiagnostics(t.Context(), file)
			var class *ast.Node
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if f, _ := errorFormOf(n); f == errorFormSubclass || f == errorFormSchemaSubclass {
					class = n
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if class == nil {
				t.Fatal("missing inherited class")
			}
			actions, err := errorInheritanceClassActions(t.Context(), &ls.CodeFixContext{SourceFile: file, Program: program, LS: service}, class)
			if err != nil {
				t.Fatal(err)
			}
			if len(actions) != 0 {
				t.Fatal("offered a class using the wrong base flavor")
			}
		})
	}
}

// An expanded native class keeps native source narrowing, but VIP-7's
// conservative coverage rule requires an explicit fallback for constructors.
func TestErrorInheritancePrintedFamilyCoverage(t *testing.T) {
	for _, fallback := range []bool{false, true} {
		tail := ""
		if fallback {
			tail = `default: "outside";`
		}
		source := `import { TaggedError, $errorSubclass } from "vibelang-runtime"
   class Base extends TaggedError("Base" as string)<{ readonly _tag: string; readonly code: string }> {}
   class Child extends $errorSubclass(Base, "Child") { declare readonly _tag: "Child" }
   function family(e: Child) { return match(e) { when Base: e.code; ` + tail + ` } }
  `
		p, file, _, _ := editorProgram(t, source)
		errors := 0
		for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			errors++
			if fallback || d.Code() != 4701 {
				t.Errorf("printed family: %s", d.String())
			}
		}
		if !fallback && errors != 1 || fallback && errors != 0 {
			t.Errorf("fallback=%t: got %d errors", fallback, errors)
		}
	}
}
