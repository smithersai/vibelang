package vibelangfuzz

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// A fuzz helper must lead back to an executable test, not just another dead
// helper. Name-based edges deliberately overapproximate references: selectors
// and local names can keep a helper alive, but cannot report a live one dead.
func TestFuzzHelperReachability(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	type declaration struct {
		node ast.Node
		file string
		root bool
	}
	decls := map[string]declaration{}
	for _, file := range files {
		tree, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		add := func(name string, node ast.Node, root bool) {
			if name != "_" {
				decls[name] = declaration{node, file, root || !strings.HasSuffix(file, "_test.go")}
			}
		}
		for _, node := range tree.Decls {
			switch node := node.(type) {
			case *ast.FuncDecl:
				if node.Recv == nil {
					name := node.Name.Name
					if name == "init" {
						add(file+":init", node, true)
						continue
					}
					add(name, node, strings.HasPrefix(name, "Test") || strings.HasPrefix(name, "Fuzz") || strings.HasPrefix(name, "Benchmark") || strings.HasPrefix(name, "Example"))
				} else {
					// Receiver methods participate through interfaces too.
					add(file+":"+node.Name.Name, node, true)
				}
			case *ast.GenDecl:
				for _, spec := range node.Specs {
					switch spec := spec.(type) {
					case *ast.ValueSpec:
						for _, name := range spec.Names {
							add(name.Name, spec, false)
						}
					case *ast.TypeSpec:
						add(spec.Name.Name, spec, false)
					}
				}
			}
		}
	}
	live := map[string]bool{}
	var visit func(string)
	visit = func(name string) {
		if live[name] {
			return
		}
		d, ok := decls[name]
		if !ok {
			return
		}
		live[name] = true
		ast.Inspect(d.node, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok && id.Name != name {
				visit(id.Name)
			}
			return true
		})
	}
	for name, d := range decls {
		if d.root {
			visit(name)
		}
	}
	var dead []string
	for name, d := range decls {
		if strings.HasSuffix(d.file, "_fuzz_test.go") && !live[name] {
			dead = append(dead, d.file+":"+name)
		}
	}
	slices.Sort(dead)
	for _, name := range dead {
		t.Errorf("fuzz helper has no executable consumer: %s", name)
	}
	// Keep this guard independent of compiler dependencies.
	if len(files) == 0 {
		t.Fatal("no package sources found")
	}
}
