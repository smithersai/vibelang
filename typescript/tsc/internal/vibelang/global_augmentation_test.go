package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"slices"
	"testing"
)

func TestGlobalKeyGlobalAugmentation(t *testing.T) {
	tests := []struct {
		name, source string
		want         []string
	}{
		{"augment", "export {}; declare global { interface JSON { parse(text: string): unknown } }", []string{"JSON.parse"}},
		{"ordinary namespace", "declare namespace global { interface JSON { parse(text: string): unknown } }", []string{"global.JSON.parse"}},
		{"nested namespace", "export {}; declare global { namespace Intl { function getCanonicalLocales(locales:string):string[] } }", []string{"Intl.getCanonicalLocales"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			file := parseDeclarations("/lib/test.d.ts", tt.source)
			var got []string
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindMethodSignature || n.Kind == ast.KindFunctionDeclaration {
					got = append(got, globalKey(n))
				}
				return n.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !slices.Equal(got, tt.want) {
				t.Fatalf("keys=%v, want %v", got, tt.want)
			}
		})
	}
}
