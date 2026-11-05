package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestGrammarAdmissionImportClausesQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A inherited TypeScript import authority changed")
	}
}

func TestGrammarAdmissionImportClauses(t *testing.T) {
	TestGrammarAdmissionImportClausesQuoted(t)
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"import Value from \"pkg\";",
		"import type Value from \"pkg\";",
		"import * as ns from \"pkg\";",
		"import type * as ns from \"pkg\";",
		"import {} from \"pkg\";",
		"import { Value } from \"pkg\";",
		"import { Value, } from \"pkg\";",
		"import type { Value } from \"pkg\";",
		"import type { Value, } from \"pkg\";",
		"import Default, { Named } from \"pkg\";",
		"import Default, * as ns from \"pkg\";",
		"import { type Value } from \"pkg\";",
		"import { type Value as Alias } from \"pkg\";",
		"import { \"wire-name\" as value } from \"pkg\";",
		"import { type \"wire-name\" as Value } from \"pkg\";",
		"import { class as Class } from \"pkg\";",
		"import { type default as Default } from \"pkg\";",
	} {
		t.Run(source, func(t *testing.T) {
			if ds := parseAs(parseKind{"imports.ts", core.ScriptKindTS}, source).Diagnostics(); len(ds) != 0 {
				t.Fatalf("native parser rejected an import clause: %v", ds)
			}
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
					t.Errorf("native import clause has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("native import mistaken for undefined syntax: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"import { try } from \"pkg\";",
		"import { value as try } from \"pkg\";",
		"import { type try } from \"pkg\";",
		"import { \"wire-name\" } from \"pkg\";",
		"import {,} from \"pkg\";",
		"import type Default, { Named } from \"pkg\";",
		"import type Default, * as ns from \"pkg\";",
		"import Default, from \"pkg\";",
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
				t.Errorf("malformed import or reserved binding has a derivation: %s", source)
			}
		}
	}
	for _, source := range []string{"import type Value from Missing;", "import Default, { Named } from Missing;"} {
		tokens := grammarLexSource(source)
		if r := lab.read(lab.g, tokens, grammarParseMode{}); r.count == 0 {
			t.Errorf("VibeLang identifier module import lost its derivation: %s", source)
		}
		if r := lab.read(lab.ts, tokens, grammarParseMode{}); r.count != 0 {
			t.Errorf("identifier module import leaked into native TypeScript: %s", source)
		}
	}
}
