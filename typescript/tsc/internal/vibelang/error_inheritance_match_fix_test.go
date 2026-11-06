package vibelang

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestErrorInheritanceQuickFixPreservesOwnTagMatch(t *testing.T) {
	for _, form := range []string{"error", "schema error"} {
		source := errorInheritanceSource(form, `"Base" as string`, "{}") + `
function label(value: Child | { readonly _tag: "Child"; readonly id: string }) {
 return match(value) { when Child: value.id; }
}
`
		t.Run(form, func(t *testing.T) {
			fixed := applyQuickFixOf(t, source, 2117, diagnostics.CategoryError)
			if !strings.Contains(fixed, "$schemaErrorMatcher") {
				t.Fatalf("the expansion lost its own generated matcher:\n%s", fixed)
			}
			p, file, _, _ := editorProgram(t, fixed)
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() == diagnostics.CategoryError {
					t.Errorf("%s\n%s", d.String(), fixed)
				}
			}
		})
	}
}

func TestWrittenGeneratedErrorMatcherCoverageControls(t *testing.T) {
	for _, test := range []struct {
		name, registration, member string
		missing                    bool
	}{
		{"runtime-alias", `install(this, "Child")`, "", false},
		{"different-tag", `install(this, "Other")`, "", true},
		{"shadowed-helper", `fake(this, "Child")`, "", true},
		{"unregistered", "", "", true},
		{"later-static-effect", `install(this, "Child")`, "static { void 0 }", true},
	} {
		t.Run(test.name, func(t *testing.T) {
			block := ""
			if test.registration != "" {
				block = "static { " + test.registration + " }"
			}
			source := `import { TaggedError, $schemaErrorMatcher as install } from "vibelang-runtime"
function fake(_type: unknown, _tag: string): void {}
class Child extends TaggedError("Child")<{ readonly id: string }> { ` + block + test.member + ` }
function label(value: Child | { readonly _tag: "Child"; readonly id: string }) {
 return match(value) { when Child: value.id; }
}
`
			p, file, _, _ := editorProgram(t, source)
			missing := 0
			for _, d := range append(p.GetSyntacticDiagnostics(t.Context(), file), p.GetSemanticDiagnostics(t.Context(), file)...) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				if d.Code() == 4701 {
					missing++
				} else {
					t.Errorf("%s\n%s", d.String(), source)
				}
			}
			want := 0
			if test.missing {
				want = 1
			}
			if missing != want {
				t.Fatalf("got %d EK4701; want %d\n%s", missing, want, source)
			}
		})
	}
}
