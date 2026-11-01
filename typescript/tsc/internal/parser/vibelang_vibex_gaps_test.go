package parser_test

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
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

// VIP-17's amended ForkOperand is every UnaryExpression, as for await.
// The .vibe path with TSX mode tests the inherited JSX parser without
// introducing the .vibex extension (a later VIP-39 slice).
func TestVibeLangFiberUnaryOperands(t *testing.T) {
	for _, operator := range []string{"fork", "join"} {
		for _, operand := range []string{"<number>value", "+value", "-value", "!value", "~value", "typeof value", "void value", "delete obj.value", "++value", "--value", "value++", "(value)", "[value][0]", "{value: value}", "1", "1n", "true", "false", "null", "\"text\"", "`text`", "/value/", "this.value", "new Work()", "function () {}", "class {}", "fork value", "join value", "effect { return value }", "do { value }"} {
			t.Run("fork-join-operand-unary/"+operator+"/"+operand, func(t *testing.T) {
				file := parseVibe(t, "effect function f() { const result = "+operator+" "+operand+" }")
				if ds := file.Diagnostics(); len(ds) != 0 {
					t.Fatalf("valid unary operand rejected: %v", ds)
				}
				ss := file.Statements.Nodes
				if len(ss) != 1 || ss[0].Kind != ast.KindFunctionDeclaration {
					t.Fatalf("want one function declaration: %v", ss)
				}
				body := ss[0].Body().AsBlock().Statements.Nodes
				// A do operand is lowered to statements before the declaration
				// (VIP-2, vibelang_do.go), so the declaration is the last statement.
				if len(body) == 0 || body[len(body)-1].Kind != ast.KindVariableStatement {
					t.Fatalf("want a variable statement last: %v", body)
				}
				call := body[len(body)-1].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
				if call.Kind != ast.KindCallExpression || call.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
					t.Fatalf("operand parsed as %v, want intrinsic fiber call", call.Kind)
				}
			})
		}
		for _, operand := range []string{"<b/>", "<><b/></>", "<b>{value}</b>"} {
			t.Run("fork-join-operand-unary/jsx/"+operator+"/"+operand, func(t *testing.T) {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, "effect function f() { const result = "+operator+" "+operand+" }", core.ScriptKindTSX)
				if ds := file.Diagnostics(); len(ds) != 0 {
					t.Fatalf("JSX unary operand rejected: %v", ds)
				}
			})
		}
	}
}

func TestVibeLangFiberReservationBoundaries(t *testing.T) {
	for _, source := range []string{
		"effect function f() { const result = fork +value }",
		"effect function f(result = fork +value) { return result }",
		"const f = effect (result = fork +value) => result",
		"const f = effect result => fork +result",
		"const f = effect function(result = fork +value) { return result }",
		"const f = effect { return fork +value }",
		"class C { effect f(result = fork +value) { return result } }",
		"const c = { effect f(result = fork +value) { return result } }",
		"effect function f() { class C { [fork +value]() {} } }",
		"effect function f() { const c = { [fork +value]() {} } }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostics: %v", ds)
			}
			found := false
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindCallExpression && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && n.Expression().Text() == "fork" {
					found = true
				}
				n.ForEachChild(visit)
				return false
			}
			file.AsNode().ForEachChild(visit)
			if !found {
				t.Fatal("source Effect context did not reserve fork")
			}
		})
	}
	for _, source := range []string{
		"const result = fork +value",
		"function f() { return fork +value }",
		"effect function f() { function g() { return fork +value } }",
		"effect function f() { const g = function() { return fork +value } }",
		"effect function f() { const g = () => fork +value }",
		"effect function f() { const g = async () => fork +value }",
		"effect function f() { const c = { g() { return fork +value }, get value() { return fork +value } } }",
		"effect function f() { class C { value = fork +value; constructor() { fork +value }; g() { return fork +value } } }",
		"effect function f() { enum E { Value = fork +value } }",
	} {
		t.Run(source, func(t *testing.T) {
			file := parseVibe(t, source)
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("unexpected diagnostics: %v", ds)
			}
			var visit func(*ast.Node) bool
			visit = func(n *ast.Node) bool {
				if n.Kind == ast.KindCallExpression && n.Expression().Flags&ast.NodeFlagsVibeLangIntrinsic != 0 && n.Expression().Text() == "fork" {
					t.Error("ordinary source context reserved fork")
				}
				n.ForEachChild(visit)
				return false
			}
			file.AsNode().ForEachChild(visit)
		})
	}
}

// Appendix A's ArrowHandler includes every ordinary generic arrow head.
func TestVibeLangCatchGenericArrowHandler(t *testing.T) {
	for _, head := range []string{"<E,>(e: E)", "<E>(e: E)", "<E extends string>(e: E)", "<E = string>(e: E)", "<const E,>(e: E)", "<E, R = number>(e: E): R"} {
		t.Run(head, func(t *testing.T) {
			file := parseVibe(t, "const result = x catch "+head+" => 1")
			if ds := file.Diagnostics(); len(ds) != 0 {
				t.Fatalf("generic catch handler rejected: %v", ds)
			}
			ss := file.Statements.Nodes
			if len(ss) != 1 || ss[0].Kind != ast.KindVariableStatement {
				t.Fatalf("want a variable statement, got %v", ss)
			}
			call := ss[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
			if call.Kind != ast.KindCallExpression {
				t.Fatalf("want catch call, got %v", call.Kind)
			}
			args := call.AsCallExpression().Arguments.Nodes
			handler := args[1]
			if handler.Kind != ast.KindArrowFunction || handler.TypeParameters() == nil {
				t.Fatalf("want generic arrow handler, got %v", handler.Kind)
			}
		})
	}
}
