package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// fork and join are reserved words under [+Effect] (VIP-17, amended; Appendix
// A), so effect code never calls a binding of those names: fork(x) there is a
// fiber operation. The parser reports a binding of either name in effect code
// as EK1702. vibelang --fix renames, before it rewrites anything else:
//
//   - a binding EK1702 reports, with the uses in its scope, which the parser
//     read as operations. They meant the binding, as the .ts twin reads them.
//   - a binding an Effect.gen or Effect.fn program reads or declares. Its
//     rewrite to effect code would otherwise turn fork(x) into the operation
//     with no error to show for it, so planEffectGen refuses until the rename
//     has landed.
//
// A rename keeps every name a reader outside the binding sees: an object key
// stays ({ fork: fork2 }), an import keeps its source name, and an exported
// binding keeps its exported name through export { fork2 as fork }.

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

// generatorRegionFiberNames returns the identifiers spelled fork or join that
// would stand in effect code once call, an Effect.gen or Effect.fn, is rewritten
// and that name a program's own binding: the generator's parameters and body,
// and the parameters of a function whose body is only that call.
func generatorRegionFiberNames(c *checker.Checker, call *ast.Node) []*ast.Node {
	var found []*ast.Node
	g, why := readGeneratorCall(c, ast.GetSourceFileOfNode(call), call)
	if g == nil || why != "" {
		return nil
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsIdentifier(node):
			if isFiberWord(node.Text()) && node.Flags&ast.NodeFlagsReparsed == 0 && !isFiberMemberName(node) {
				if symbol := fiberNameSymbol(c, node); symbol != nil && !isPreludeFiberName(c, symbol, node.Text()) {
					found = append(found, node)
				}
			}
			return false
		case ast.IsFunctionLike(node) && !isMarkedEffect(node):
			// A plain arrow's head inherits the reservation; its body and any
			// other plain callable do not (Appendix A).
			if ast.IsArrowFunction(node) {
				for _, parameter := range node.Parameters() {
					visit(parameter)
				}
			}
			return false
		case node.Kind == ast.KindPropertyDeclaration || node.Kind == ast.KindEnumMember:
			if name := node.Name(); name != nil && name.Kind == ast.KindComputedPropertyName {
				visit(name)
			}
			return false // a field or enum initializer resets to [~Effect]
		}
		return node.ForEachChild(visit)
	}
	for _, parameter := range g.generator.Parameters() {
		visit(parameter)
	}
	visit(g.generator.Body())
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	parent := outer.Parent
	if ast.IsReturnStatement(parent) && ast.IsBlock(parent.Parent) && len(parent.Parent.Statements()) == 1 {
		parent = parent.Parent.Parent
	}
	if ast.IsFunctionLike(parent) && !g.isFn {
		for _, parameter := range parent.Parameters() {
			visit(parameter)
		}
	}
	return found
}

// generatorFiberNameRefusal says why call's rewrite must wait for a rename, or
// returns "".
func generatorFiberNameRefusal(c *checker.Checker, call *ast.Node) string {
	names := generatorRegionFiberNames(c, call)
	if len(names) == 0 {
		return ""
	}
	return names[0].Text() + " is reserved in effect code, and this generator reaches a binding of that name; rename that binding first"
}
