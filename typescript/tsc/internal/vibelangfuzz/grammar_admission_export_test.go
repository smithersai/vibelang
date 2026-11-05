package vibelangfuzz

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

const grammarDeclarationExportQuote = "`export` and `export default` come from ECMAScript's `ExportDeclaration`, so `export error E { }` parses and `export default error E { }` is a syntax error"

func TestGrammarAdmissionDeclarationExportsQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarDeclarationExportQuote) {
		t.Fatal("Appendix A declaration export rule changed; review custom export placement")
	}
}

var grammarDeclarationExportSources = []string{
	"export service S { value: number }",
	"export service type { Value };",
	"type Value = number ; export service type { Value } ;",
	"export\nservice S { value: number }",
	"export service S: { value: number } {}",
	"export error E;",
	"export error E { value: number }",
	"export schema error E {}",
	"export schema S { value: number }",
	"export schema S = number;",
	"export data D { A }",
}

func TestGrammarAdmissionDeclarationExports(t *testing.T) {
	TestGrammarAdmissionDeclarationExportsQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	mode := grammarParseMode{prose: true, names: true}
	for _, source := range grammarDeclarationExportSources {
		if lab.read(lab.g, grammarLexSource(source), mode).count == 0 {
			t.Errorf("admitted custom export has no derivation: %s", source)
		}
		if lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}).count != 0 {
			t.Errorf("custom export leaked into native TypeScript: %s", source)
		}
	}
	for _, source := range []string{
		"export default service S { value: number }",
		"export default error E {}",
		"export default schema S { value: number }",
		"export default schema error E {}",
		"export default data D { A }",
	} {
		if lab.read(lab.g, grammarLexSource(source), mode).count != 0 {
			t.Errorf("default custom declaration gained a derivation: %s", source)
		}
	}
	for _, source := range []string{
		"export const n = 1;", "const service = 1; export default service;",
		"export interface type { Value }", "export class type { value: number }",
		"type Value = number; export type { Value };",
	} {
		for _, g := range []*grammarCfg{lab.g, lab.ts} {
			if lab.read(g, grammarLexSource(source), mode).count == 0 {
				t.Errorf("native export lost derivation: %s", source)
			}
		}
	}
	d := ast.NewExternalDiagnostic(nil, core.TextRange{}, "EK", diagnostics.CategoryError, 903, "no derived service key")
	if grammarAdmissionSyntaxDiagnostic(d) {
		t.Fatal("semantic EK0903 became syntax rejection")
	}
}
func TestGrammarAdmissionDeclarationExportRegression(t *testing.T) {
	TestGrammarAdmissionDeclarationExportsQuoted(t)
	w := NewWorkspace(t)
	const source = "type Value = number ; export service type { Value } ;"
	result, err := w.Compile(context.Background(), Single(source))
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range result.Diagnostics {
		if grammarAdmissionSyntaxDiagnostic(d) {
			t.Fatalf("admitted export unexpectedly has syntax rejection: %v", d)
		}
	}
	if grammarAdmissionVerdict(t, w, source) {
		t.Fatal("authorized custom export still reported as compiler acceptance gap")
	}
	checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
	t.Run("raw-witness", func(t *testing.T) {
		key, got := grammarAdmissionInput([]byte{5, 255, 50, 65})
		if got != source {
			t.Fatalf("raw custom export witness drifted: %q: %s", key, got)
		}
		checkGrammarAdmission(t, w, key, got)
	})
}
