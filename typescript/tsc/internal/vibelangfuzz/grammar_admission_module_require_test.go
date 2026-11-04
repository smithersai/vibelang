package vibelangfuzz

import (
	"context"
	"strings"
	"testing"
)

const grammarModuleRequireQuote = "ModuleSpecifier = StringLiteral | IdentifierReference"
const grammarModuleImportOnlyQuote = "imported only with `import … from name`"

func TestGrammarAdmissionModuleRequireQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarModuleRequireQuote) ||
		!strings.Contains(SpecText("../vips/0040-module-declarations.md"), grammarModuleImportOnlyQuote) {
		t.Fatal("VIP-40's identifier import boundary changed; review the require-reference pending family")
	}
}

// VIP-40's identifier specifier path also runs while TypeScript parses an
// ExternalModuleReference. That native production requires a StringLiteral,
// so require(M) has no authority even when M is a declared inline module.
// Keep ordinary require calls, string references and parenthesized native
// recovery separate from this exact import-alias family.
func grammarModuleRequireIdentifier(ts []grammarToken) bool {
	for i, tok := range ts {
		if tok.kind != 'w' || tok.text != "import" {
			continue
		}
		at := i + 1
		if at+1 < len(ts) && ts[at].text == "type" && ts[at+1].kind == 'w' {
			at++
		}
		if at+5 >= len(ts) {
			continue
		}
		if ts[at].kind == 'w' && !grammarReservedWords[ts[at].text] &&
			ts[at+1].text == "=" && ts[at+2].text == "require" && ts[at+3].text == "(" &&
			ts[at+4].kind == 'w' && !grammarReservedWords[ts[at+4].text] && ts[at+5].text == ")" {
			return true
		}
	}
	return false
}

func TestGrammarAdmissionModuleRequireKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import x = require(join);":   true,
		"import x = require(M);":      true,
		"import type x = require(M);": true,
		"import type = require(M);":   true,
		`import
x = require
(M);`: true,
		"module M {} import x = require(M);": true,
		`import x = require("m");`:           false,
		"import x = require((M));":           false,
		"import x = require(M.x);":           false,
		"import x = require(true);":          false,
		"import x = require(1);":             false,
		"const x = require(M);":              false,
		"import { x } from M;":               false,
		"import M;":                          false,
	} {
		if got := grammarModuleRequireIdentifier(grammarLexSource(source)); got != want {
			t.Errorf("identifier require family=%v, want %v: %s", got, want, source)
		}
		if key := grammarAdmissionForm(source); (key == "admission:module-require-identifier") != want {
			t.Errorf("pending key=%q, want family=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionModuleRequireRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"import x = require(join);",
		"import x = require(M);",
		"import type x = require(M);",
		"module M {} import x = require(M);",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			for _, d := range result.Diagnostics {
				if IsEK(d) && d.Code() == 4006 && grammarAdmissionSyntaxDiagnostic(d) {
					t.Error("EK4006 is a name error, not syntax rejection")
				}
			}
			if !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("undefined identifier require must remain an admission gap: %s", source)
			}
		})
	}
}
