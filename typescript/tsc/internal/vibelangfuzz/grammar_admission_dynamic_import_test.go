package vibelangfuzz

import (
	"strings"
	"testing"
)

func TestGrammarAdmissionDynamicImportQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A's inherited TypeScript grammar changed; review native ImportCall coverage")
	}
}

// ECMAScript ImportCall takes one specifier expression and an optional
// options expression. It is a CallExpression, so property and call chains
// follow it; unlike ordinary Arguments it permits neither spread nor zero
// arguments. Appendix A inherits this native syntax.
func TestGrammarAdmissionDynamicImport(t *testing.T) {
	lab, err := admissionLab()
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{
		"import ( join ) ; ;",
		"import(name);",
		"import(1);",
		"import((name));",
		"import(name,);",
		`import(name, { with: { type: "json" } });`,
		"import(name, options,);",
		"import(name).then(f);",
		"import(name)[key]();",
		"async function f() { return await import(name); }",
		"import\n(name);",
		"const x = import(a ? b : c);",
	} {
		t.Run(source, func(t *testing.T) {
			toks := grammarLexSource(source)
			for _, g := range []*grammarCfg{lab.ts, lab.g} {
				if r := lab.read(g, toks, grammarParseMode{}); r.count == 0 {
					t.Fatalf("native dynamic import has no derivation: %s", source)
				}
			}
			if mismatch, detail := grammarAdmissionMismatch(source); mismatch {
				t.Fatalf("native import mistaken for an undefined form: %s", detail)
			}
		})
	}
	for _, source := range []string{
		"import();",
		"import(,);",
		"import(...name);",
		"import(name, ...options);",
		"import(name, options, extra);",
		"new import(name);",
		"const f = import;",
		"import name;",
	} {
		// The last form is a VIP-40 static import in VibeLang, but native TS
		// derives none of these. Keep the native and extension grammars apart.
		if r := lab.read(lab.ts, grammarLexSource(source), grammarParseMode{}); r.count != 0 {
			t.Errorf("invalid native ImportCall has a derivation: %s", source)
		}
	}
}
