package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// D266 supersedes D242: "This removes EK4801, EK4819, and EK4820 from
// ordinary TypeScript." No check looks for them in a .ts file: the shared
// diagnostic constructor would drop what it found, and the types it asked
// the checker for made the checker report TypeScript diagnostics in code
// that TypeScript never checks. The codes and editor fixes are retained.

var (
	// EK4819 (missingStarInYieldEffectGen): yield of an Effect in an Effect generator.
	EK4819 = message(4819, errorCategory, "yield hands this Effect to the generator's caller without running it; yield* runs it.")
	// EK4820 (missingReturnYieldStar): yield* of an Effect that never succeeds, without return.
	EK4820 = message(4820, errorCategory, "This Effect never succeeds, but TypeScript does not know the generator stops here.")
)

func init() {
	registry[EK4819.Code] = EK4819
	registry[EK4820.Code] = EK4820
	ls.RegisterCodeFixProvider(yieldStarFix)
}

// typeScriptFileChecks run once for each .ts or .tsx file outside
// node_modules that a checker checks, after TypeScript's own checks of that
// file.
var typeScriptFileChecks []func(c *checker.Checker, file *ast.SourceFile)

// isCheckedTypeScriptFile reports whether file is a .ts, .tsx, .mts, or .cts
// source file outside node_modules.
func isCheckedTypeScriptFile(file *ast.SourceFile) bool {
	if file == nil || file.IsDeclarationFile || strings.Contains(string(file.FileName()), "/node_modules/") {
		return false
	}
	return tspath.FileExtensionIsOneOf(string(file.FileName()), []string{tspath.ExtensionTs, tspath.ExtensionTsx, tspath.ExtensionMts, tspath.ExtensionCts})
}

// effectGeneratorOf returns the generator function whose body evaluates
// node, when that generator is the body of an Effect: an argument of an
// effect function such as Effect.gen, Effect.fn("name"), or Layer.effect's
// Effect.gen. It returns nil otherwise.
func effectGeneratorOf(c *checker.Checker, node *ast.Node) *ast.Node {
	fn := ast.GetContainingFunction(node)
	if fn == nil || !ast.IsFunctionExpression(fn) || fn.AsFunctionExpression().AsteriskToken == nil || ast.GetFunctionFlags(fn)&ast.FunctionFlagsAsync != 0 {
		return nil
	}
	call := fn.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return nil
	}
	callee := call.Expression()
	if ast.IsCallExpression(callee) {
		callee = callee.Expression() // Effect.fn("name")(function* () { … })
	}
	if module, _ := effectFunctionOf(c, callee); module != "Effect" {
		return nil
	}
	return fn
}

// yieldStarFix writes the * that EK4819 reports missing, the return that
// EK4820 does, and yield* before an Effect that EK4801 reports inside an
// Effect generator in a .ts file.
var yieldStarFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK4801.Code, EK4819.Code, EK4820.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if !isCheckedTypeScriptFile(fix.SourceFile) {
			return nil, nil
		}
		node := reportedNode(fix.SourceFile, fix.Span, func(node *ast.Node) bool {
			if fix.ErrorCode == EK4819.Code {
				return ast.IsYieldExpression(node)
			}
			return node.Parent != nil && ast.IsExpressionStatement(node.Parent) && node.Parent.Expression() == node
		})
		if node == nil {
			return nil, nil
		}
		start := nodeStart(fix.SourceFile, node)
		switch fix.ErrorCode {
		case EK4819.Code:
			return []*ls.CodeAction{{Description: "Write yield*", Changes: replaceRange(fix, start+len("yield"), start+len("yield"), "*")}}, nil
		case EK4820.Code:
			return []*ls.CodeAction{{Description: "Write return yield*", Changes: replaceRange(fix, start, start, "return ")}}, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		defer done()
		if effectGeneratorOf(c, node) == nil {
			return nil, nil
		}
		changes := replaceRange(fix, start, start, "yield* ")
		if needsParentheses(node) {
			changes = append(replaceRange(fix, start, start, "yield* ("), replaceRange(fix, node.End(), node.End(), ")")...)
		}
		return []*ls.CodeAction{{Description: "Run it with yield*", Changes: changes}}, nil
	},
}
