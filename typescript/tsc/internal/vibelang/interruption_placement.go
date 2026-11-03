package vibelang

import "github.com/microsoft/TypeScript/tsc/internal/ast"

// Interruption follows source execution ownership (VIP-22). Computed names
// and heritage expressions run in the surrounding code; field/enum initializers
// and callable parameter defaults do not. The generated concurrent parameter
// list is source item initialization, rather than a callable's default.
func inInterruptionEffectCode(node *ast.Node) bool {
	// Native async activations remain Promise code even for generated arrows.
	if asyncMaskBody(ast.GetSourceFileOfNode(node), node) {
		return false
	}
	child := node
	for n := node.Parent; n != nil; child, n = n, n.Parent {
		switch n.Kind {
		case ast.KindPropertyDeclaration:
			if n.AsPropertyDeclaration().Initializer == child {
				return false
			}
		case ast.KindEnumMember:
			if n.AsEnumMember().Initializer == child {
				return false
			}
		case ast.KindClassStaticBlockDeclaration:
			return false
		}
		if !ast.IsFunctionLike(n) || isCalledInPlace(n) || isCatchLeftFunction(n) {
			continue
		}
		if n.Name() == child && child.Kind == ast.KindComputedPropertyName {
			continue
		}
		if n.Body() != child {
			return fiberHelper(n.Parent) == "$forConcurrent" && inInterruptionEffectCode(n.Parent)
		}
		return isMarkedEffect(n) || isProducer(n) || isProgramArrow(n) && markedForm(n) != formNone
	}
	return false
}
