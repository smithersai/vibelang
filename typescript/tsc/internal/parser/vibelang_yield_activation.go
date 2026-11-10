package parser

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// VibeLangYieldOutsideProducer classifies source yield independently of
// compiler-generated callable bodies. The checker reports EK2104; parser
// implementation-boundary diagnostics must not hide that source error.
func VibeLangYieldOutsideProducer(node *ast.Node) bool {
	for n, child := node.Parent, node; n != nil; child, n = n, n.Parent {
		switch n.Kind {
		case ast.KindParameter:
			if n.Parent != nil && ast.IsFunctionLike(n.Parent) {
				return n.Parent.Flags&ast.NodeFlagsVibeLangEffect != 0
			}
		case ast.KindPropertyDeclaration:
			if child == n.Initializer() {
				return false
			}
		case ast.KindClassStaticBlockDeclaration, ast.KindEnumDeclaration:
			return false
		}
		// A computed name is evaluated around its callable, not in its body.
		if !ast.IsFunctionLike(n) || child != n.Body() {
			continue
		}
		if n.Kind == ast.KindArrowFunction && n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 && n.Flags&ast.NodeFlagsVibeLangEffect == 0 {
			continue // do, catch head and item wrappers keep the source activation.
		}
		// Moved defaults keep their source positions before the body.
		return n.Flags&ast.NodeFlagsVibeLangEffect != 0 && (ast.GetFunctionFlags(n)&ast.FunctionFlagsGenerator == 0 || node.Pos() < n.Body().Pos())
	}
	return false
}

// vibeLangYieldInsideProducer recognizes the source producer body through
// transparent generated callbacks. Written activations and formal
// initialization keep their own yield permissions.
func vibeLangYieldInsideProducer(node *ast.Node) bool {
	for n, child := node.Parent, node; n != nil; child, n = n, n.Parent {
		switch n.Kind {
		case ast.KindParameter:
			if n.Parent != nil && ast.IsFunctionLike(n.Parent) {
				return false
			}
		case ast.KindPropertyDeclaration:
			if child == n.Initializer() {
				return false
			}
		case ast.KindClassStaticBlockDeclaration, ast.KindEnumDeclaration:
			return false
		}
		if !ast.IsFunctionLike(n) || child != n.Body() {
			continue
		}
		flags := ast.GetFunctionFlags(n)
		if n.Kind == ast.KindArrowFunction && n.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 &&
			n.Flags&ast.NodeFlagsVibeLangEffect == 0 && flags&ast.FunctionFlagsAsync == 0 {
			continue
		}
		return n.Flags&ast.NodeFlagsVibeLangEffect != 0 && flags&ast.FunctionFlagsGenerator != 0 && flags&ast.FunctionFlagsAsync == 0 && node.Pos() >= n.Body().Pos()
	}
	return false
}
