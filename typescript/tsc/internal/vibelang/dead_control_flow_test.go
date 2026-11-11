package vibelang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

// A disabled traversal branch documents behavior that cannot run. Retired
// checks and registrations should be removed instead of leaving placeholders.
func TestCompilerHasNoDisabledBranchesOrEmptyInitializers(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	for _, name := range files {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(file, func(node ast.Node) bool {
			switch n := node.(type) {
			case *ast.BinaryExpr:
				if n.Op == token.LAND {
					if rhs, ok := n.Y.(*ast.Ident); ok && rhs.Name == "false" {
						t.Errorf("%s: conjunction with false disables this branch", fset.Position(n.Pos()))
					}
				}
			case *ast.FuncDecl:
				if n.Recv != nil || n.Name.Name != "init" || n.Body == nil {
					break
				}
				for _, statement := range n.Body.List {
					decl, ok := statement.(*ast.DeclStmt)
					if !ok {
						return true
					}
					if gen, ok := decl.Decl.(*ast.GenDecl); !ok || gen.Tok != token.CONST {
						return true // variable initializers can run code
					}
				}
				t.Errorf("%s: initializer has no executable statements", fset.Position(n.Pos()))
			}
			return true
		})
	}
}
