package parser_test

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"testing"
)

func TestEffectObjectTypeSlots(t *testing.T) {
	for _, source := range []string{
		"type T = number!{ x: 1 }",
		"type T = number!{}",
		"type T = number!{ x: 1 }!never",
		"type T = number!string!{ service: number }",
		"type T = number!never!{ service: number }",
		"type T = number!{ x: 1 }!{ service: number }",
		"type T = () => number!{ x: 1 }!{ service: number }",
		"type T = { value: number!{ x: 1 }; method(): number!never!{ service: number } }",
		"interface T { value: number!{ x: 1 }; method(): number!never!{ service: number } }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			if len(file.Statements.Nodes) != 1 {
				t.Fatalf("lost type: %d statements", len(file.Statements.Nodes))
			}
		})
	}
}

func TestEffectObjectSlotsPreserveCallableBodies(t *testing.T) {
	for _, source := range []string{
		"function f(): number!! { return 1 }",
		"function f(): number!{} { return 1 }",
		"function f(): number!string! { return 1 }",
		"function f(): number!string! {}",
		"function f(): number!({ x: 1 }) { return 1 }",
		"function f(): number!string!({ service: number }) { return 1 }",
		"function f(): number!({ x: 1 })!({ service: number }) { return 1 }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			if len(file.Statements.Nodes) != 1 || file.Statements.Nodes[0].Body() == nil {
				t.Fatal("lost callable body")
			}
		})
	}
	for _, source := range []string{
		"class T { method(): number!string! { return 1 } }",
		"const value = { method(): number!string! { return 1 } }",
		"const value = function(): number!string! { return 1 }",
		"const value = (): number!string! => 1",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			found := false
			var visit func(*ast.Node) bool
			visit = func(node *ast.Node) bool {
				if ast.IsFunctionLike(node) {
					found = true
					if node.Body() == nil {
						t.Fatal("lost method/arrow/function-expression body")
					}
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("missing callable")
			}
		})
	}
}

// A brace on the next line remains a separate statement. Appendix A's
// no-slot rule reports TS17019 for lone A!; an actual Effect's empty R is never.
func TestEffectObjectSlotsPreserveFollowingBlocks(t *testing.T) {
	for _, test := range []struct {
		source    string
		errorKind ast.Kind
		dangling  bool
	}{
		{"type T = number!\n{}", ast.KindNeverKeyword, true},
		{"type T = number!string!\n{}", ast.KindStringKeyword, false},
		{"type T = number!/*\n*/{}", ast.KindNeverKeyword, true},
	} {
		t.Run(test.source, func(t *testing.T) {
			file := parseVibe(t, test.source)
			ds := file.Diagnostics()
			if test.dangling {
				if len(ds) != 1 || ds[0].Code() != 17019 {
					t.Fatalf("lone postfix ! must report exactly TS17019: %v", ds)
				}
			} else if len(ds) != 0 {
				t.Fatalf("unexpected diagnostic: %v", ds[0].String())
			}
			if len(file.Statements.Nodes) != 2 || !ast.IsBlock(file.Statements.Nodes[1]) {
				t.Fatal("consumed following block")
			}
			if test.dangling {
				if file.Statements.Nodes[0].Type().Kind != ast.KindNumberKeyword {
					t.Fatal("lone postfix ! became an Effect")
				}
				return
			}
			args := file.Statements.Nodes[0].Type().TypeArguments()
			if len(args) != 3 || args[1].Kind != test.errorKind || args[2].Kind != ast.KindNeverKeyword {
				t.Fatal("changed empty type channel")
			}
		})
	}
}

// The A!!R production excludes a leading brace even in a type-only position.
// The following block must remain outside the Effect's never requirement.
func TestEffectOptionalObjectSlotBoundary(t *testing.T) {
	for _, source := range []string{
		"type T = number!! {}",
		"type T = number!! { service: number }",
		"type T = number!!\n{}",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if len(file.Statements.Nodes) != 2 || !ast.IsBlock(file.Statements.Nodes[1]) {
				t.Fatal("consumed excluded optional-R brace")
			}
			args := file.Statements.Nodes[0].Type().TypeArguments()
			if len(args) != 3 || args[1].Kind != ast.KindNeverKeyword || args[2].Kind != ast.KindNeverKeyword {
				t.Fatal("changed empty channels")
			}
		})
	}
}
