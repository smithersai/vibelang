package vibelang

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"strings"
	"testing"
)

// TestTestHelpersHaveCallers fails when a package-level helper, table,
// constant or type in this package's test files has no reader. When a test
// goes, its scaffolding goes with it, so no file reads as coverage it does
// not give. A reference inside the declaration itself, inside a method of a
// type, or inside an init function does not count: an init hook that feeds a
// map nothing reads is dead weight on every test of the package.
func TestTestHelpersHaveCallers(t *testing.T) {
	t.Parallel()
	names, err := filepath.Glob("*_test.go")
	if err != nil {
		t.Fatal(err)
	}
	fset := token.NewFileSet()
	type decl struct {
		file string
		obj  *ast.Object
		span ast.Node
	}
	var decls []decl
	files := map[string]*ast.File{}
	external := map[string]int{} // name -> references from files that do not declare it
	for _, name := range names {
		file, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		if file.Name.Name != "vibelang" {
			continue
		}
		files[name] = file
		for _, id := range file.Unresolved {
			external[id.Name]++
		}
		for _, d := range file.Decls {
			switch d := d.(type) {
			case *ast.FuncDecl:
				n := d.Name.Name
				if d.Recv != nil || n == "init" || n == "TestMain" || strings.HasPrefix(n, "Test") || strings.HasPrefix(n, "Fuzz") || strings.HasPrefix(n, "Benchmark") || strings.HasPrefix(n, "Example") {
					continue
				}
				decls = append(decls, decl{name, d.Name.Obj, d})
			case *ast.GenDecl:
				for _, spec := range d.Specs {
					switch s := spec.(type) {
					case *ast.TypeSpec:
						decls = append(decls, decl{name, s.Name.Obj, s})
					case *ast.ValueSpec:
						for _, id := range s.Names {
							if id.Name != "_" {
								decls = append(decls, decl{name, id.Obj, s})
							}
						}
					}
				}
			}
		}
	}
	for _, d := range decls {
		if d.obj == nil || ast.IsExported(d.obj.Name) || external[d.obj.Name] > 0 {
			continue
		}
		used := false
		file := files[d.file]
		for _, top := range file.Decls {
			if fn, ok := top.(*ast.FuncDecl); ok && (fn.Name.Name == "init" && fn.Recv == nil || fn.Recv != nil && receiverIs(fn, d.obj.Name)) {
				continue
			}
			ast.Inspect(top, func(n ast.Node) bool {
				id, ok := n.(*ast.Ident)
				if used || !ok || id.Obj != d.obj {
					return !used
				}
				used = id.Pos() < d.span.Pos() || id.Pos() >= d.span.End()
				return !used
			})
			if used {
				break
			}
		}
		if !used {
			t.Errorf("%s: %s has no reader; delete it or move it next to its caller", fset.Position(d.span.Pos()), d.obj.Name)
		}
	}
}

func receiverIs(fn *ast.FuncDecl, name string) bool {
	typ := fn.Recv.List[0].Type
	if star, ok := typ.(*ast.StarExpr); ok {
		typ = star.X
	}
	if index, ok := typ.(*ast.IndexExpr); ok {
		typ = index.X
	}
	id, ok := typ.(*ast.Ident)
	return ok && id.Name == name
}
