package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestGrammarAdmissionImportMetaSpecifierQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarModuleSpecifierQuote) ||
		!strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A module specifier authority changed; review import.meta specifier coverage")
	}
}

// Static module specifiers are strings or identifier references. This key
// follows the historical import.meta specifier family for keyed corpus.
// Native TS1141 now rejects these values and their recovered wrappers.
func grammarImportMetaSpecifier(file *ast.SourceFile) bool {
	unwrap := func(n *ast.Node) *ast.Node {
		for n != nil {
			switch n.Kind {
			case ast.KindParenthesizedExpression, ast.KindNonNullExpression, ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindExpressionWithTypeArguments:
				n = n.Expression()
				continue
			}
			break
		}
		return n
	}
	isMeta := func(n *ast.Node) bool {
		return n != nil && ast.IsMetaProperty(n) &&
			n.AsMetaProperty().KeywordToken == ast.KindImportKeyword && n.Name().Text() == "meta"
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n == nil {
			return false
		}
		if ast.IsImportDeclaration(n) || ast.IsExportDeclaration(n) {
			spec := ast.GetExternalModuleName(n)
			if spec != nil {
				if isMeta(unwrap(spec)) {
					return true
				}
				if ast.IsPropertyAccessExpression(spec) && spec.Name().Text() != "url" && isMeta(unwrap(spec.Expression())) {
					return true
				}
				if ast.IsElementAccessExpression(spec) && isMeta(unwrap(spec.Expression())) {
					return true
				}
			}
		}
		return n.ForEachChild(visit)
	}
	return visit(file.AsNode())
}

func TestGrammarAdmissionImportMetaSpecifierKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import import . meta\nmeta . url ; ;": true,
		"import import.meta;":                  true,
		"import x from import.meta;":           true,
		"export * from import.meta;":           true,
		"import import.meta.main;":             true,
		"import import.meta[\"url\"];":         true,
		"import x from (import.meta);":         true,
		"import x from (import.meta).main;":    true,
		"const u = import.meta;":               false,
		"import.meta.url;":                     false,
		"import(import.meta.url);":             false,
		"import(import.meta);":                 false,
		"import import.meta.url;":              false,
		"import import.meta.main.value;":       false,
		"import import.meta();":                false,
		"import import.x;":                     false,
		"import new.target;":                   false,
		"import Missing;":                      false,
		"import x from Missing;":               false,
		"import \"pkg\";":                      false,
	} {
		if key := grammarAdmissionForm(source); (key == "admission:import-meta-specifier") != want {
			t.Errorf("key=%q,want import.meta specifier=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionImportMetaSpecifierRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range []string{
		"import import . meta\nmeta . url ; ;",
		"import import.meta;",
		"import x from import.meta;",
		"export * from import.meta;",
		"import import.meta.main;",
		"import import.meta[\"url\"];",
		"import x from (import.meta);",
		"import x from (import.meta).main;",
	} {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			platform, syntax := false, false
			for _, d := range result.Diagnostics {
				platform = platform || IsEK(d) && d.Code() == 4402
				syntax = syntax || !IsEK(d) && d.Code() == 1141
			}
			if platform || !syntax || grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("static specifier must retain TypeScript TS1141 without a platform diagnostic; diagnostics=%v", result.Diagnostics)
			}
		})
	}
	for _, source := range []string{
		"const u = import.meta;",
		"import.meta.url;",
		"import(import.meta.url);",
		"import(import.meta);",
		"import import.meta.url;",
		"import new.target;",
		"import Missing;",
		"import x from Missing;",
		"import \"pkg\";",
	} {
		t.Run(source, func(t *testing.T) {
			if grammarAdmissionVerdict(t, w, source) {
				t.Fatal("native expression or rejected static specifier became an admission mismatch")
			}
		})
	}
}

// Recovered wrappers still occupy a static ModuleSpecifier, whose syntax is
// a StringLiteral or IdentifierReference. They must retain native TS1141.
var grammarImportMetaSpecifierWrappers = []string{
	"import import . meta !",
	"import import . meta as meta",
	"import import . meta <\nmeta\n. url > ;",
}

func TestGrammarAdmissionImportMetaSpecifierWrappers(t *testing.T) {
	w := NewWorkspace(t)
	for _, source := range grammarImportMetaSpecifierWrappers {
		t.Run(source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			native, platform := false, false
			for _, d := range result.Diagnostics {
				native = native || !IsEK(d) && d.Code() == 1141
				platform = platform || IsEK(d) && d.Code() == 4402
			}
			if !native || platform || grammarAdmissionVerdict(t, w, source) {
				t.Fatalf("static specifier wrapper must retain native TS1141: %v", result.Diagnostics)
			}
			checkGrammarAdmission(t, w, grammarAdmissionMutationKey(source), source)
		})
	}
}
