package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Appendix A inherits TypeScript syntax (grammarAdmissionQuote). The native
// checker parses modifiers before an export declaration for recovery, then
// reports TS1193 through grammarErrorOnFirstToken in checkExportDeclaration.
// VIP-34 preserves those native syntax diagnostics; they do not admit a form.
func TestGrammarAdmissionExportModifiers(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A native syntax authority changed")
	}
	w := NewWorkspace(t)
	for _, source := range []string{
		"export export { } ;",
		"export\nexport {};",
		"export export { Missing };",
		"export export * from \"missing\";",
		"export export type { Missing };",
		"module M { export export {}; }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == 1193 && d.Category() == diagnostics.CategoryError {
					seen = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Error("TS1193 export-declaration modifier error must count as syntax rejection")
					}
				}
			}
			if !seen {
				t.Fatalf("native export modifier witness lost TS1193: %v", result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("compiler-rejected export declaration became an admission mismatch")
			}
		})
	}
	for _, source := range []string{
		"export {};",
		"export const value = 1;",
		"const value = 1; export { value };",
		"export type Value = number;",
		"export { Missing };",
		"export * from \"missing\";",
		"export { value } from \"missing\";",
		"module M { export const value = 1; }",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if grammarAdmissionSyntaxDiagnostic(d) {
					t.Errorf("valid export or name/module error classified as syntax rejection: %v", d)
				}
			}
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("ordinary export became an admission mismatch")
			}
		})
	}
}
