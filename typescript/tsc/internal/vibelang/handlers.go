package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Handlers (design chapter 9, D16-D18, D50).
//
//	handle(() => checkout("c-42"), Approval, {
//	  approve(request, k) {
//	    const decision = Reviewers.decide(request)
//	    return resume(k, decision)
//	  }
//	})
//
// handle, resume, resumeWith, and abandon are vibelang-runtime's
// functions, and their TypeScript signatures type a handler: handle removes
// the control from the program's R, and each clause, an object literal method
// or lambda, compiles to an Effect function because the clauses parameter
// expects functions that return Effects. The compiler adds one rule (D18): a
// clause whose last step is `return resume(k, v)` returns the kernel's
// tail-resume request, runtime.$tailResume(k, v), instead of running resume.
// The clause's generator then finishes before the program continues, so a
// clause that resumes a million times runs in constant stack. Only a return
// in the clause's own frame qualifies: inside a try, catch, finally, or other
// region, the region's cleanup must run after the resumed program, so resume
// runs there as any call does (yield*).

// runtimeExport returns the name of the vibelang-runtime export that
// callee refers to, such as "handle" or "resume", or "" when callee refers to
// anything else. An import, a renamed import, a namespace member such as
// runtime.resume, and the prelude all resolve to the runtime's own
// declaration.
func runtimeExport(c *checker.Checker, callee *ast.Node) string {
	if callee == nil || !(ast.IsIdentifier(callee) || ast.IsPropertyAccessExpression(callee)) {
		return ""
	}
	symbol := c.GetSymbolAtLocation(callee)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || len(symbol.Declarations()) == 0 || packageOf(c, ast.GetSourceFileOfNode(symbol.Declarations()[0])) != runtimeModule {
		return ""
	}
	return symbol.Name()
}

// handleCallOfClause returns the call whose clauses object holds fn, an object
// literal method or a lambda property of that object, when the call is the
// runtime's handle; otherwise nil.
func handleCallOfClause(c *checker.Checker, fn *ast.Node) *ast.Node {
	var object *ast.Node
	switch {
	case fn.Kind == ast.KindMethodDeclaration && fn.Parent != nil && ast.IsObjectLiteralExpression(fn.Parent):
		object = fn.Parent
	case (fn.Kind == ast.KindArrowFunction || fn.Kind == ast.KindFunctionExpression) && fn.Parent != nil &&
		ast.IsPropertyAssignment(fn.Parent) && fn.Parent.Initializer() == fn:
		object = fn.Parent.Parent
	default:
		return nil
	}
	call := object.Parent
	if call == nil || !ast.IsCallExpression(call) || len(call.Arguments()) < 3 || call.Arguments()[2] != object {
		return nil
	}
	if runtimeExport(c, call.Expression()) != "handle" {
		return nil
	}
	return call
}

// resumeKind returns "resume" or "resumeWith" when call calls the runtime's
// function of that name, and "" otherwise.
func resumeKind(c *checker.Checker, call *ast.Node) string {
	if call == nil || !ast.IsCallExpression(call) {
		return ""
	}
	switch name := runtimeExport(c, call.Expression()); name {
	case "resume", "resumeWith":
		return name
	}
	return ""
}

// handlerPlan records what the lowering does with handlers in one file.
type handlerPlan struct {
	clauses map[*ast.Node]bool   // clause functions of handle calls that the lowering turns into Effects
	resumes map[*ast.Node]string // calls to resume and resumeWith in those functions' bodies, by kind
}

func newHandlerPlan() handlerPlan {
	return handlerPlan{clauses: map[*ast.Node]bool{}, resumes: map[*ast.Node]string{}}
}

// planClause records fn, a function the lowering turns into an Effect, when
// it is a clause of a handle call.
func (p *handlerPlan) planClause(c *checker.Checker, fn *ast.Node) {
	if handleCallOfClause(c, fn) != nil {
		p.clauses[fn] = true
	}
}

// planResume records call, in the body of a function the lowering turns into
// an Effect, when it calls resume or resumeWith.
func (p *handlerPlan) planResume(c *checker.Checker, call *ast.Node) {
	if kind := resumeKind(c, call); kind != "" {
		p.resumes[call] = kind
	}
}

// resumesInTail reports whether a return of resume or resumeWith in fn's own
// frame is a tail resume: fn is a clause, and its body is not a Scope region,
// whose closure keeps fn's frame but must release what it holds after the
// resumed program, as any region's cleanup must.
func (p *plan) resumesInTail(fn *ast.Node) bool {
	return p.clauses[fn] && !p.scopeBlocks[fn.Body()]
}

// tailResumeOf returns the call to resume or resumeWith that expression is,
// looking through parentheses, or nil.
func (p *handlerPlan) tailResumeOf(expression *ast.Node) *ast.Node {
	if expression == nil {
		return nil
	}
	if call := ast.SkipParentheses(expression); p.resumes[call] != "" {
		return call
	}
	return nil
}

// isTailResumeBody reports whether call, a call to resume or resumeWith, is
// the expression body of a clause lambda, which returns it.
func (p *handlerPlan) isTailResumeBody(call *ast.Node) bool {
	n := call
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	fn := n.Parent
	return fn != nil && fn.Kind == ast.KindArrowFunction && fn.Body() == n && p.clauses[fn]
}

// visitTailResumeReturn turns `return resume(k, v)` in a clause's own frame
// into `return runtime.$tailResume(k, v)`.
func (tx *lowering) visitTailResumeReturn(node *ast.Node) *ast.Node {
	statement := tx.Factory().NewReturnStatement(tx.tailResumeCall(tx.plan.tailResumeOf(node.Expression())))
	tx.EmitContext().SetOriginal(statement, node)
	statement.Loc = node.Loc
	return statement
}

// tailResumeCall turns `resume(k, v)` into `runtime.$tailResume(k, v)`, and
// `resumeWith(k, p)` into `runtime.$tailResumeWith(k, p)`: the kernel's
// request, which the clause returns and its Clause frame performs.
func (tx *lowering) tailResumeCall(call *ast.Node) *ast.Node {
	helper := "$tailResume"
	if tx.plan.resumes[call] == "resumeWith" {
		helper = "$tailResumeWith"
	}
	arguments := tx.Visitor().VisitNodes(call.ArgumentList())
	request := tx.runtimeCall(helper, arguments.Nodes...)
	tx.EmitContext().SetOriginal(request, call)
	request.Loc = call.Loc
	return request
}
