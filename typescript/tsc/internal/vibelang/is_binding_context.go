package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-7, details214/240/249 leave these initialization environments unsettled.
// They do not authorize moving an initializer into a function body.
var EK0705 = message(705, errorCategory, "This `is` binding has no lexical home in a parameter or enum initializer.")

func init() { registry[EK0705.Code] = EK0705 }

// A source block, a match arm, a callable body, or a field initializer has
// its own home. Compiler-written pattern functions do not create a source home.
func unsettledIsBindingHome(file *ast.SourceFile, call *ast.Node) bool {
	text := file.Text()
	sourceWord := func(node *ast.Node) string {
		if node.Pos() < 0 || node.Pos() >= len(text) {
			return ""
		}
		start := scanner.SkipTrivia(text, node.Pos())
		if start < 0 || start >= len(text) {
			return ""
		}
		end := start
		for end < len(text) && (text[end] >= 'a' && text[end] <= 'z' || text[end] >= 'A' && text[end] <= 'Z') {
			end++
		}
		return text[start:end]
	}
	for child, parent := call, call.Parent; parent != nil; child, parent = parent, parent.Parent {
		if parent.Kind == ast.KindParameter && (child == parent.Initializer() || child == parent.Name()) {
			return true
		}
		// A native catch binding has a parameter environment distinct from
		// its Block. Defaults and computed keys stay in that environment.
		if ast.IsVariableDeclaration(parent) && parent.Parent != nil &&
			parent.Parent.Kind == ast.KindCatchClause && child == parent.Name() {
			return true
		}
		if ast.IsEnumMember(parent) && child == parent.Initializer() {
			return true
		}
		if ast.IsPropertyDeclaration(parent) && child == parent.Initializer() {
			return false
		}
		if ast.IsArrowFunction(parent) && child == parent.Body() {
			arrow := parent.AsArrowFunction().EqualsGreaterThanToken
			if arrow != nil && arrow.Flags&ast.NodeFlagsReparsed == 0 {
				return false
			}
		}
		if ast.IsBlock(parent) && parent.Pos() >= 0 && parent.Pos() < len(text) {
			start := scanner.SkipTrivia(text, parent.Pos())
			if start >= 0 && start < len(text) && text[start] == '{' {
				return false
			}
		}
		// The final/default arm is emitted directly as a return or expression;
		// unlike other arms it need not have a separate generated block.
		if ast.IsBlock(parent) || ast.IsReturnStatement(parent) || ast.IsExpressionStatement(parent) || ast.IsIfStatement(parent) {
			if word := sourceWord(parent); word == "when" || word == "default" {
				return false
			}
		}
	}
	return false
}
