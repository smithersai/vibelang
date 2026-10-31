package parser_test

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestVibeLangVibexGaps(t *testing.T) {
	for _, keyword := range []string{"error", "schema error"} {
		for _, gap := range []string{"\n", "\r\n", " /* break\n */ ", " // break\n", "\u2028", "\u2029"} {
			t.Run(fmt.Sprintf("error-decl-type-params-line-break/%s/%q", keyword, gap), func(t *testing.T) {
				file := parseVibe(t, keyword+" Timeout"+gap+"<T,>(x: T) => x")
				if ds := file.Diagnostics(); len(ds) != 0 {
					t.Fatalf("unexpected diagnostics: %v", ds)
				}
				ss := file.Statements.Nodes
				if len(ss) != 2 || ss[0].Kind != ast.KindClassDeclaration || ss[1].Kind != ast.KindExpressionStatement {
					var kinds []ast.Kind
					for _, s := range ss {
						kinds = append(kinds, s.Kind)
					}
					t.Fatalf("want declaration then arrow statement; got %v", kinds)
				}
				if ss[0].TypeParameters() != nil {
					t.Fatal("declaration consumed next-line arrow's type parameters")
				}
				if e := ss[1].Expression(); e.Kind != ast.KindArrowFunction || len(e.TypeParameters()) != 1 {
					t.Fatalf("want a generic arrow, got %v", e.Kind)
				}
			})
		}
	}
}
