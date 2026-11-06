package vibelangfuzz

import (
	"context"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
)

func TestGrammarAdmissionImportRelationalQuoted(t *testing.T) {
	if !strings.Contains(SpecText(grammarAppendix), grammarAdmissionQuote) {
		t.Fatal("Appendix A native grammar inheritance changed; review import expression recovery")
	}
}

// The native parser starts a possible generic import call on '<'. When that
// call head fails, it can leave the import keyword as a binary operand.
// ImportCall and MetaProperty do not admit that bare keyword expression.
func grammarImportRelationalRecovery(file *ast.SourceFile) bool {
	var visit func(*ast.Node, *ast.Node) bool
	visit = func(n, parent *ast.Node) bool {
		if n == nil {
			return false
		}
		if n.Kind == ast.KindImportKeyword && parent != nil && (parent.Kind == ast.KindBinaryExpression || parent.Kind == ast.KindPrefixUnaryExpression) {
			return true
		}
		return n.ForEachChild(func(child *ast.Node) bool { return visit(child, n) })
	}
	return visit(file.AsNode(), nil)
}

func TestGrammarAdmissionImportRelationalKeys(t *testing.T) {
	for source, want := range map[string]bool{
		"import < value;":                                true,
		"1\nimport < require(join)":                      true,
		"const n = import < value;":                      true,
		"const n = (import /* comment */ < value);":      true,
		"function f() { return import < value; }":        true,
		"effect function f() { return import < value; }": true,
		"import < value > other;":                        true,
		"obj.import < value;":                            false,
		"obj?.import < value;":                           false,
		"import(\"pkg\") < value;":                       false,
		"import<T>(\"pkg\");":                            false,
		"import.source(\"pkg\");":                        false,
		"import.meta < value;":                           false,
		"import { value } from \"pkg\";":                 false,
		"type T = import(\"pkg\");":                      false,
		"const s = \"import < value\";":                  false,
	} {
		if key := grammarAdmissionForm(source); (key == "admission:import-relational-recovery") != want {
			t.Errorf("key=%q,want import comparison=%v: %s", key, want, source)
		}
	}
}

func TestGrammarAdmissionImportRelationalRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, c := range []struct {
		source   string
		mismatch bool
	}{
		{"import < value;", true},
		{"1\nimport < require(join)", true},
		{"const n = import < value;", true},
		{"const n = (import < value);", true},
		{"effect function f() { return import < value; }", true},
		{"obj.import < value;", false},
		{"import(\"pkg\") < value;", false},
		{"import.meta < value;", false},
		{"const n = import;", false},
	} {
		t.Run(c.source, func(t *testing.T) {
			result, err := w.Compile(context.Background(), Single(c.source))
			if err != nil {
				t.Fatal(err)
			}
			if got := grammarAdmissionVerdict(t, w, c.source); got != c.mismatch {
				t.Fatalf("mismatch=%v,want %v; diagnostics=%v", got, c.mismatch, result.Diagnostics)
			}
		})
	}
}
