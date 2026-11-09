package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
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

func TestErrorInheritanceNativeClassesUnaffected(t *testing.T) {
	source := "import { Data } from \"effect\"; class Base extends Data.TaggedError(\"Base\" as string)<{readonly id:string}> {}; export class Child extends Base {}"
	program, file, _, _ := editorProgram(t, source)
	for _, d := range program.GetSemanticDiagnostics(t.Context(), file) {
		if d.Code() == 2117 {
			t.Errorf("native class rejected: %s", d.String())
		}
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
