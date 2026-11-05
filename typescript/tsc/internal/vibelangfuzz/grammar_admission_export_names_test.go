package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionExportNamesQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A inherited TypeScript export authority changed")
	}
}

// TypeScript's ExportSpecifier uses ModuleExportName on both sides of as;
// an import's local BindingIdentifier is a different position.
func TestGrammarAdmissionExportNames(t *testing.T) {
	TestGrammarAdmissionExportNamesQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"type Value = number; export { try };",
		"export { class };",
		"export { function };",
		"export { default };",
		"export { static };",
		"export { try as renamed };",
		"export { value as try };",
		"export { value as default };",
		"export { value as class, };",
		"export { value as \"wire-name\" };",
		"export type { try };",
		"export type { try as class };",
		"export { type Value as Renamed };",
		"export { type Value as default };",
		"export { try, class, function };",
		"export { try } from \"pkg\";",
		"export { try as default } from \"pkg\";",
		"export { \"wire-name\" as value } from \"pkg\";",
		"export { \"wire-name\" } from \"pkg\";",
		"export { \"wire-name\" as \"other-name\" } from \"pkg\";",
		"export type { type Value as Renamed } from \"pkg\";",
		"import { value as renamed } from \"pkg\";",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseAs(parseKind{"exports.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native parser rejected export-name syntax: %v", ds)
			}
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
					t.Errorf("native export name has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("native export name mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"import { try } from \"pkg\";",
		"import { class } from \"pkg\";",
		"import { value as try } from \"pkg\";",
		"export { value as };",
		"export {,};",
		"export { value,, };",
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("malformed export or reserved import binding has a derivation: %s", source)
			}
		}
	}
}
