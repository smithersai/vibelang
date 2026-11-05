package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Appendix A inherits TypeScript module syntax. Local type-only exports use
// named clauses, whose trailing comma belongs to the clause after a specifier.
func TestGrammarAdmissionTypeExports(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A native syntax authority changed")
	}
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"type Value = number; export type { Value };",
		"type Value = number; export type { Value as Renamed };",
		"type Value = number; export type { Value, };",
		"type Value = number; export type { Value as Renamed, };",
		"type A = number; type B = string; export type { A, B };",
		"type A = number; type B = string; export type { A, B, };",
		"export type {};",
		"export type { Missing };",
		"export type\n{ Missing };",
		"type Value = number; export { type Value };",
		"type Value = number; export { Value, };",
		"const value = 1; export { value as renamed, };",
		"const value = 1; type T = number; export { value, type T, };",
		"export {};",
		"export { Missing };",
		"export type { T, } from \"pkg\";",
		"export { x as y, } from \"pkg\";",
		"export type * from \"pkg\";",
		"export type * as ns from \"pkg\";",
		"module M { type T = number; export type { T }; }",
	} {
		t.Run(source, func(t *testing.T) {
			if !strings.HasPrefix(source, "module ") {
				if ds := parseAs(parseKind{"exports.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
					t.Fatalf("native parser rejected an export control: %v", ds)
				}
			}
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if strings.HasPrefix(source, "module ") && g == lab.ts {
					continue
				}
				if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
					t.Errorf("inherited named export has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("valid export mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"export {,};",
		"export type {,};",
		"export type { A,, };",
		"export type { A",
		"export type *;",
		"export type * as ns;",
		"export type { A } from ;",
		"export type { A } from ,;",
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("malformed export has a derivation: %s", source)
			}
		}
	}
	for _, source := range []string{
		"export type { T } from Missing;",
		"export { value, } from Missing;",
	} {
		tokens := grammarLexSource(source)
		if r := lab.read(lab.g, tokens, grammarParseMode{}); r.count == 0 {
			t.Errorf("identifier module re-export lost its VibeLang derivation: %s", source)
		}
		if r := lab.read(lab.ts, tokens, grammarParseMode{}); r.count != 0 {
			t.Errorf("identifier module re-export leaked into native grammar: %s", source)
		}
	}
}
