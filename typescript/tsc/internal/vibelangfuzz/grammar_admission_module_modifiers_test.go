package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

func TestGrammarAdmissionModuleModifiersQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A native module grammar authority changed")
	}
}

func TestGrammarAdmissionModuleModifiers(t *testing.T) {
	TestGrammarAdmissionModuleModifiersQuoted(t)
	w := NewWorkspace(t)
	for _, tc := range []struct {
		source string
		code   int32
	}{
		{"export export default { value: 1 };", 1120},
		{"export export default 1;", 1120},
		{"export\nexport default 1;", 1120},
		{"export import value from \"missing\";", 1191},
		{"export import { value } from \"missing\";", 1191},
		{"export import * as ns from \"missing\";", 1191},
		{"export import type { Value } from \"missing\";", 1191},
	} {
		t.Run(tc.source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(tc.source))
			if err != nil {
				t.Fatal(err)
			}
			seen := false
			for _, d := range result.Diagnostics {
				if d.Source() == "" && d.Code() == tc.code && d.Category() == diagnostics.CategoryError {
					seen = true
					if !grammarAdmissionSyntaxDiagnostic(d) {
						t.Errorf("native TS%d modifier error must count as syntax rejection", tc.code)
					}
				}
			}
			if !seen {
				t.Fatalf("module modifier witness lost TS%d: %v", tc.code, result.Diagnostics)
			}
			if grammarAdmissionVerdict(t, w, tc.source) {
				t.Fatal("native modifier rejection became an admission mismatch")
			}
		})
	}
	for _, source := range []string{
		"export default 1;",
		"export default { value: 1 };",
		"const value = 1; export { value };",
		"import { value } from \"missing\";",
	} {
		result, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		for _, d := range result.Diagnostics {
			if grammarAdmissionSyntaxDiagnostic(d) {
				t.Errorf("ordinary module syntax or module-resolution error rejected: %v", d)
			}
		}
		if grammarAdmissionVerdict(t, w, source) {
			t.Errorf("ordinary module control became a mismatch: %s", source)
		}
	}
}
