package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Legacy D110 analysis only. D383 makes pipe an ordinary value call.
// Through 0.0.10, the built-in pipe took the program first (design D8):
//
//	const user = pipe(
//	  () => fetchUser(id),
//	  Effect.retry({ times: 3 }),
//	  Effect.timeout("2 seconds")
//	)
//
// pipe's first parameter is a bare type parameter, which says nothing about
// form. So pipe looks ahead: when its first argument is a function with no
// parameters and its first stage takes an Effect, the first argument is a
// program. Applied to plain data, pipe is effect's ordinary pipe.

// legacyPipeProgram reports whether the argument at path is pipe's first
// argument, and pipe's first stage takes an Effect. Callers ask only about an
// argument that can be a program, a function with no required parameters.
//
// The stage itself is not checked here: pipe has not inferred the type the
// stage receives yet, and a generic stage such as Match.when(…) or
// Effect.catchTag(…) checked without it would keep a resolution that lost
// its inferences. The look-ahead reads the stage's callee instead.
func (a *analyzer) legacyPipeProgram(call *ast.Node, path []pathStep) bool {
	if len(path) != 1 || path[0].argument != 0 || len(call.Arguments()) < 2 || !a.isEffectPipe(call) {
		return false
	}
	for _, stage := range a.legacyStageSignatures(call.Arguments()[1]) {
		if parameters := stage.Parameters(); len(parameters) > 0 && a.isExpectedEffect(a.checker.GetTypeOfSymbol(parameters[0])) {
			return true
		}
	}
	return false
}

// legacyStageSignatures returns the signatures of the function that stage, a pipe
// argument, evaluates to: for a call such as Effect.retry(policy), the
// functions its callee's signatures of that arity return; for a function
// value such as Effect.orDie, its own signatures.
func (a *analyzer) legacyStageSignatures(stage *ast.Node) []*checker.Signature {
	c := a.checker
	stage = ast.SkipParentheses(stage)
	switch {
	case ast.IsCallExpression(stage):
		count := len(stage.Arguments())
		var out []*checker.Signature
		for _, s := range c.GetSignaturesOfType(c.GetTypeAtLocation(stage.Expression()), checker.SignatureKindCall) {
			if count < s.MinArgumentCount() || count > len(s.Parameters()) && !s.HasRestParameter() {
				continue
			}
			out = append(out, c.GetSignaturesOfType(c.GetReturnTypeOfSignature(s), checker.SignatureKindCall)...)
		}
		return out
	case ast.IsIdentifier(stage) || ast.IsPropertyAccessExpression(stage):
		return c.GetSignaturesOfType(c.GetTypeAtLocation(stage), checker.SignatureKindCall)
	}
	return nil
}

// isEffectPipe reports whether call calls effect's pipe function, which the
// prelude also exports, by the symbol its callee resolves to, whatever it
// is spelled: `import { pipe as flow } from "effect"` is pipe too.
func (a *analyzer) isEffectPipe(call *ast.Node) bool {
	symbol := calleeSymbol(a.checker, call)
	if symbol == nil || symbol.Name() != "pipe" {
		return false
	}
	for _, declaration := range symbol.Declarations() {
		if isEffectModuleFile(ast.GetSourceFileOfNode(declaration), "Function") {
			return true
		}
	}
	return false
}

// legacyPipeFirst keeps D110's detector independent of the new final form.
// A literal used to take the program form; a stored Effect function used to
// convert to its program. Neither decision now affects checking or lowering.
func (a *analyzer) legacyPipeFirst(call *ast.Node) *ast.Node {
	if !a.legacyPipeProgram(call, []pathStep{{argument: 0}}) {
		return nil
	}
	first := ast.SkipParentheses(call.Arguments()[0])
	if isLambda(first) && requiredParameterCount(first) == 0 && !a.hasPlainContract(first) && !a.isFactory(first) || a.programOf(a.checker.GetTypeAtLocation(first)) != nil {
		return first
	}
	return nil
}
