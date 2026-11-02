package vibelang

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A service key called with arguments is EK3007 (Chapter 4, D415): S() takes
// none and returns the implementation, so Fn(3) for
// service Fn: (n: number) => number means Fn()(3). It replaces TypeScript's
// TS2348, whose suggestion of new would be EK3003, and its quick fix writes
// Fn()(3).

// EK3007: a service key called with arguments. {0} is the service.
var EK3007 = message(3007, errorCategory, "{0} is a service key, which takes no arguments: {0}() returns its implementation.")

func init() {
	registry[EK3007.Code] = EK3007
	fileChecks = append(fileChecks, checkServiceKeyCalls)
	ls.RegisterCodeFixProvider(serviceKeyCallFix)
}

func checkServiceKeyCalls(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isTypeScriptModule(node) || isHatchArgument(node) {
			return false
		}
		if ast.IsCallExpression(node) && len(node.Arguments()) > 0 {
			if service := serviceNamedBy(c, node.Expression()); service != nil && classKindOf(service) == serviceClass {
				name := scanner.GetTextOfNode(node.Expression())
				d := report(c, node, EK3007, name)
				if serviceCallable(c, service) {
					note(d, "Call its implementation: {0}()(…).", name)
				} else {
					note(d, "Use a member of its implementation, {0}().member(…), or {0}.member(…).", name)
				}
				// TS2348: the key is not callable (did you mean new); TS2349 and
				// TS2554 for the same call through VibeLang's call hook.
				coverCodes(c, node, 2348, 2349, 2554)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// serviceKeyCallFix is EK3007's quick fix for a service whose implementation
// is a function: Fn(3) becomes Fn()(3).
var serviceKeyCallFix = &ls.CodeFixProvider{
	Source:     diagnosticSource,
	ErrorCodes: []int32{EK3007.Code},
	GetCodeActions: func(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
		if fix.Diagnostic == nil || fix.LS == nil || fix.Program == nil {
			return nil, nil
		}
		call := callStartingAt(fix.SourceFile, fix.Span.Pos())
		if call == nil {
			return nil, nil
		}
		c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
		service := serviceNamedBy(c, call.Expression())
		callable := service != nil && serviceCallable(c, service)
		done()
		if !callable {
			return nil, nil // Users("ada") has no one rewrite: which member?
		}
		end := call.Expression().End()
		return []*ls.CodeAction{{
			Description: "Call the service's implementation",
			Changes:     replaceRange(fix, end, end, "()"),
		}}, nil
	},
}

// callStartingAt returns the innermost call expression in file whose callee
// starts at pos, or nil.
func callStartingAt(file *ast.SourceFile, pos int) *ast.Node {
	var found *ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nodeStart(file, n) > pos || n.End() <= pos {
			return false
		}
		if ast.IsCallExpression(n) && nodeStart(file, n.Expression()) == pos {
			found = n
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return found
}

// serviceCallable reports whether service's implementation, what service()
// returns, is a function: its shape, service Fn: Shape, has call signatures.
func serviceCallable(c *checker.Checker, service *ast.Node) bool {
	shape := serviceShape(service)
	return shape != nil && len(c.GetSignaturesOfType(c.GetTypeFromTypeNode(shape), checker.SignatureKindCall)) > 0
}
