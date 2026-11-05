package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

const grammarModuleReExportQuote = "export * from text"

const grammarModuleSpecifierQuote = "ModuleSpecifier = StringLiteral | IdentifierReference"

func TestGrammarAdmissionModuleSpecifierKeywordQuoted(t *testing.T) {
	if !strings.Contains(SpecText("../vips/0040-module-declarations.md"), grammarModuleReExportQuote) {
		t.Fatal("VIP-40 identifier re-export authority changed")
	}
	if !strings.Contains(SpecText(grammarAppendix), grammarModuleSpecifierQuote) || !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A identifier module specifier authority changed")
	}
}

func TestGrammarAdmissionModuleSpecifierKeywordKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import static;":                           true,
		"import static\nx;":                        true,
		"import private;":                          true,
		"import protected;":                        true,
		"import x from static;":                    true,
		"import * as X from static;":               true,
		"import { x } from static;":                true,
		"export { x } from static;":                true,
		"export * from static;":                    true,
		"export * from Missing;":                   false,
		"export { x } from Missing;":               false,
		"import Missing;":                          false,
		"import async;":                            false,
		"import x from Missing;":                   false,
		"import \"static\";":                       false,
		"import { static as value } from \"pkg\";": false,
		"import static from \"pkg\";":              false,
		"import x = require(static);":              false,
		"const o = { static: 1 }; o.static;":       false,
		"module M { import static; }":              false,
	} {
		if key := grammarAdmissionForm(source); (key == "admission:module-specifier-keyword") != want {
			t.Errorf("key=%q,want reserved specifier=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionModuleSpecifierKeywordRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"import static\nx;",
		"import static;",
		"import private;",
		"import protected;",
		"import x from static;",
		"import * as X from static;",
		"import { x } from static;",
		"export { x } from static;",
		"export * from static;",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			missing := false
			for _, d := range result.Diagnostics {
				missing = missing || IsEK(d) && d.Code() == 4006
			}
			if !missing || !grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("reserved module specifier must retain the observed gap; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"export * from Missing;",
		"export { x } from Missing;",
		"import Missing;",
		"import async;",
		"import x from Missing;",
		"import \"static\";",
		"import { static as value } from \"pkg\";",
		"import static from \"pkg\";",
		"const o = { static: 1 }; o.static;",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("native or valid identifier control became an admission mismatch")
			}
		})
	}
}

// The shared decoder also records require arguments. They retain the native
// ExternalModuleReference StringLiteral rule under their own pending key.
func grammarModuleReferenceInRequire(file *ast.SourceFile, at int) bool {
	found := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil || at < n.Pos() || at >= n.End() {
			return false
		}
		if n.Kind == ast.KindExternalModuleReference {
			found = true
			return false
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

func TestGrammarAdmissionModuleReExports(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		`export * from "pkg";`,
		`export * as ns from "pkg";`,
		`export { x as y } from "pkg";`,
		`export type { T } from "pkg";`,
	} {
		for _, g := range []*grammarCfg{lab.ts, lab.g} {
			if r := lab.read(g, grammarLexSource(source), grammarParseMode{}); r.count == 0 {
				t.Errorf("native re-export has no derivation: %s", source)
			}
		}
	}
	for _, source := range []string{"export * from Missing;", "export { x } from Missing;", "export * as ns from Missing;", "export type { T } from Missing;"} {
		tokens := grammarLexSource(source)
		if r := lab.read(lab.g, tokens, grammarParseMode{prose: true, names: true}); r.count == 0 {
			t.Errorf("VIP-40 identifier re-export has no derivation: %s", source)
		}
		if r := lab.read(lab.ts, tokens, grammarParseMode{}); r.count != 0 {
			t.Errorf("identifier re-export leaked into native TypeScript: %s", source)
		}
	}
	if key := grammarAdmissionForm("import x = require(static);"); key != "admission:module-require-identifier" {
		t.Errorf("reserved require argument lost its separate family: %q", key)
	}
}

func TestGrammarAdmissionModuleRequireReservedKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import x = require(static);":         true,
		"import x = require(private);":        true,
		"import type x = require(protected);": true,
		"import x = require(static\n);":       true,
		"import x = require(M.x);":            false,
		"import x = require(static.x);":       false,
		"import x = require(static());":       false,
		"import x = require(static, other);":  false,
		"import x = require((static));":       false,
		"const x = require(static);":          false,
	} {
		if key := grammarAdmissionForm(source); (key == "admission:module-require-identifier") != want {
			t.Errorf("key=%q, want reserved require=%v: %s", key, want, source)
		}
	}
}
