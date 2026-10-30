package vibelangfuzz

import (
	"go/ast"
	"go/parser"
	gotoken "go/token"
	"os"
	"strings"
	"testing"
)

// A new target must join the budget gate instead of silently bypassing it.
func TestShortTargetsBudgeted(t *testing.T) {
	entries, err := os.ReadDir(".")
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		file, err := parser.ParseFile(gotoken.NewFileSet(), entry.Name(), nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || !strings.HasPrefix(fn.Name.Name, "Fuzz") || fn.Body == nil {
				continue
			}
			count++
			guarded := false
			if len(fn.Body.List) > 0 {
				if expr, ok := fn.Body.List[0].(*ast.ExprStmt); ok {
					if call, ok := expr.X.(*ast.CallExpr); ok {
						if name, ok := call.Fun.(*ast.Ident); ok {
							guarded = name.Name == "startShortBudget"
						}
					}
				}
			}
			if !guarded {
				t.Errorf("%s has no short seed CPU budget", fn.Name.Name)
			}
		}
	}
	if count == 0 {
		t.Fatal("no fuzz targets found")
	}
}
