package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// An effect function returns an Effect, as an async function returns a
// Promise (VIP-1), so a return type written on one is an Effect type:
// effect function load(id): User!NotFound. A return type that is not an
// Effect, effect function load(id): User, is EK0106. Its quick fix writes
// the Effect of that type, User!!; vibelang --fix leaves it alone, because
// the function's errors and requirements may need writing too.

// EK0106: an effect function's return type that is not an Effect. {0} is
// the written type, {1} the Effect type to write instead.
var EK0106 = message(106, errorCategory, "An effect function returns an Effect, so its return type can't be {0}: write {1}, or leave the return type out.")

func init() {
	registry[EK0106.Code] = EK0106
	fileChecks = append(fileChecks, checkEffectReturnTypes)
	tsFormRules[EK0106.Code] = &tsFormRule{
		message:   EK0106,
		find:      func(*checker.Checker, *ast.SourceFile, func(*ast.Node, *formRewrite, ...any)) {},
		plan:      effectReturnTypeRewrite,
		diagnosed: isWrittenReturnTypeOfEffectFunction,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK0106.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// isWrittenReturnTypeOfEffectFunction reports whether node is the return
// type written on an effect function. An effect function* returns a Stream
// (VIP-21), so its return type is not one.
func isWrittenReturnTypeOfEffectFunction(node *ast.Node) bool {
	fn := node.Parent
	return fn != nil && ast.IsFunctionLike(fn) && fn.Type() == node && isMarkedEffect(fn) && !isEffectBlock(fn) && ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator == 0
}

// checkEffectReturnTypes reports EK0106 at each effect function of file
// whose written return type is not an Effect.
func checkEffectReturnTypes(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) {
		return
	}
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if t := node.Type(); t != nil && ast.IsFunctionLike(node) && isWrittenReturnTypeOfEffectFunction(t) {
			if written := c.GetTypeFromTypeNode(t); !isEffectType(c, written) && written.Flags()&checker.TypeFlagsAnyOrUnknown == 0 {
				text := nodeText(file, t)
				rewrite := effectReturnTypeRewrite(c, file, t)
				d := reportAt(c, file, tsFormSpan(file, t), EK0106, text, rewrite.description)
				note(d, "Its quick fix writes {0}.", rewrite.description)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// effectReturnTypeRewrite plans the EK0106 fix at t, an effect function's
// return type: the Effect that succeeds with t, written T!! (VIP-3).
func effectReturnTypeRewrite(_ *checker.Checker, file *ast.SourceFile, t *ast.Node) *formRewrite {
	text := nodeText(file, t)
	if ast.IsUnionTypeNode(t) || ast.IsIntersectionTypeNode(t) || ast.IsFunctionTypeNode(t) || ast.IsConditionalTypeNode(t) {
		text = "(" + text + ")"
	}
	start := nodeStart(file, t)
	return &formRewrite{edits: []sourceEdit{{start, t.End(), text + "!!"}}, description: text + "!!"}
}
