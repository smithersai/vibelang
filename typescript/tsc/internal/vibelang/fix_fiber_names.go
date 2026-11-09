package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// fork and join are reserved in effect code (VIP-17). Checked binding
// ownership analysis preserves ordinary diagnostics and explicit refactors.

// reservedFiberName is EK1702 as the parser reports it for a binding in effect
// code, including an Effect expression's own name (VIP-17; Appendix A).
var reservedFiberName = message(parser.ReservedFiberNameDiagnosticCode, errorCategory, parser.ReservedFiberNameDiagnosticText)

func init() {
	registry[reservedFiberName.Code] = reservedFiberName
}

func isFiberWord(text string) bool { return text == "fork" || text == "join" }

// isFiberMemberName reports whether id names a member or a key, which no
// reservation reaches and no rename touches.
func isFiberMemberName(id *ast.Node) bool {
	parent := id.Parent
	if parent == nil {
		return true
	}
	switch parent.Kind {
	case ast.KindPropertyAccessExpression, ast.KindQualifiedName, ast.KindPropertyAssignment, ast.KindMethodDeclaration, ast.KindPropertyDeclaration,
		ast.KindPropertySignature, ast.KindMethodSignature, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindEnumMember, ast.KindNamedTupleMember,
		ast.KindJsxAttribute:
		return parent.Name() == id
	case ast.KindBindingElement:
		return parent.AsBindingElement().PropertyName == id
	case ast.KindImportSpecifier:
		return parent.AsImportSpecifier().PropertyName == id
	}
	return false
}

// fiberNameSymbol returns the binding id refers to or declares, or nil. A
// callee the parser read as the operation has no symbol of its own, so it asks
// what the name means in lexical scope: the binding the writer called.
func fiberNameSymbol(c *checker.Checker, id *ast.Node) *ast.Symbol {
	parent := id.Parent
	switch {
	case id.Flags&ast.NodeFlagsVibeLangIntrinsic != 0:
		return c.ResolveName(id.Text(), parent, ast.SymbolFlagsValue|ast.SymbolFlagsAlias, true /*excludeGlobals*/)
	case ast.IsShorthandPropertyAssignment(parent):
		return c.GetShorthandAssignmentValueSymbol(parent)
	case ast.IsExportSpecifier(parent):
		return c.GetExportSpecifierLocalTargetSymbol(parent)
	}
	return c.GetSymbolAtLocation(id)
}

// isPreludeFiberName reports whether symbol is the runtime's fork or join: the
// operation's own name, which a rewrite to effect code keeps meaning.
func isPreludeFiberName(c *checker.Checker, symbol *ast.Symbol, name string) bool {
	return isRuntimeSymbol(c, symbol, name)
}
