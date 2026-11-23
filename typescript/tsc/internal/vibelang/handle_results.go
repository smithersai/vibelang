package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// What a resume returns (D351).
//
// A resume in tail position ends its clause: the clause returns whatever the
// resumed program ends with and adds nothing of its own. Any other resume
// returns a value, what the handle produces when the resumed program next
// reaches it. That is the program's result, or, when the program performs an
// operation again before it ends, the result of a clause that returns:
//
//	try { return work() }                  // number
//	handle Steps.first() {
//	  const n: number = resume()           // TS2322: resume returns number | string
//	  return n.toFixed(1)
//	}
//	handle Steps.second() { return "early" }
//
// In a handle statement, every resume has one answer type H, covering what the
// statement can end with: each value its try block or its clauses return, and
// undefined when the block, or a clause that has not resumed, ends another way
// (normally, or with a break or continue that leaves the statement). A return
// computed from a non-tail resume's result stays out of H: compute H once,
// then check the omitted returns against it. A return outside H is EK2119,
// an error. A written success type instead determines H, with undefined under
// the same completion rule, and the checker checks every return against it.
//
// The handle function keeps D97's types: resume returns the program's result
// type, or never with onReturn. A clause that reads that result, where the
// handle can produce a result outside its type, is EK2110.

var (
	// EK2110: a clause of a handle call reads what a non-tail resume returns, and the handle can produce a result outside that type (D97). {0} is what the handle can produce, {1} the type of resume's result.
	EK2110 = message(2110, errorCategory, "This resume returns what the handle produces next, which can be {0}, but its result is typed {1}.")
	// EK2119: a handle statement's clause returns a value, computed from what resume returned, outside the handler's answer type (D351). {0} is the value's type, {1} the handler's answer type.
	EK2119 = message(2119, errorCategory, "This clause returns {0}, which a resume still waiting in this handle statement then returns, but resume's result is typed {1}.")
)

func init() {
	registerDiagnostic(EK2110)
	registerDiagnostic(EK2119)
	fileChecks = append(fileChecks, checkHandleResults)
}

// handleResults is what one checker knows about what its handle statements
// end with.
type handleResults struct {
	types map[*ast.Node]*checker.Type // by handle statement; nil while it is being computed
	plans map[*ast.Node]*resultPlan
}

type handleResultsKey struct{}

func handleResultsOf(c *checker.Checker) *handleResults {
	return c.ExtensionState(handleResultsKey{}, func() any {
		return &handleResults{types: map[*ast.Node]*checker.Type{}, plans: map[*ast.Node]*resultPlan{}}
	}).(*handleResults)
}

// resumeResultType returns the handler's answer type when call is a resume
// or resumeWith in a handle statement's clause, and nil otherwise. A tail
// resume has the same H, although it adds no value to the result plan.
func resumeResultType(c *checker.Checker, call *ast.Node) *checker.Type {
	clause := clauseOfResume(call)
	if clause == nil {
		return nil
	}
	statement := handleStatementOfClause(clause)
	if statement == nil {
		return nil
	}
	return handleResultsOf(c).resultType(c, statement)
}

// clauseOfResume returns the block of the handle clause whose continuation
// call passes, when call is a resume or resumeWith to which the parser passed
// a clause's $k, and nil otherwise. The parser passes each clause's $k to the
// calls in its own code, outside nested functions, so the nearest clause
// block is the clause.
func clauseOfResume(call *ast.Node) *ast.Node {
	if !ast.IsCallExpression(call) || !ast.IsIdentifier(call.Expression()) || len(call.Arguments()) == 0 || !isClauseContinuation(call.Arguments()[0]) {
		return nil
	}
	if name := call.Expression().Text(); name != "resume" && name != "resumeWith" {
		return nil
	}
	for n := call.Parent; n != nil && !isFunctionBoundary(n); n = n.Parent {
		if handleClauseOfBlock(n) != nil {
			return n
		}
	}
	return nil
}

// handleStatementOfClause returns the handle statement whose clause block is
// block: the try statement whose catch block holds the if chain of clauses.
func handleStatementOfClause(block *ast.Node) *ast.Node {
	n := block.Parent
	for n != nil && n.Kind == ast.KindIfStatement {
		n = n.Parent
	}
	if n == nil || n.Kind != ast.KindBlock || n.Parent == nil || n.Parent.Kind != ast.KindCatchClause || n.Parent.Parent == nil || !isHandleStatement(n.Parent.Parent) {
		return nil
	}
	return n.Parent.Parent
}

// isResumeOf reports whether node is a resume or resumeWith of a clause of
// statement, a handle statement.
func isResumeOf(node *ast.Node, statement *ast.Node) bool {
	clause := clauseOfResume(node)
	return clause != nil && handleStatementOfClause(clause) == statement
}

// isReturnedValue reports whether node, looking through parentheses, is what
// a return statement returns.
func isReturnedValue(node *ast.Node) bool {
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	return node.Parent != nil && node.Parent.Kind == ast.KindReturnStatement
}

// resultType returns the type of every value that statement, a handle
// statement, can end with, which is what every resume in its clauses
// returns. A resume reached again while the type is computed, as through a
// recursive call of the enclosing function, gets nil and keeps never.
func (h *handleResults) resultType(c *checker.Checker, statement *ast.Node) *checker.Type {
	if t, ok := h.types[statement]; ok {
		return t
	}
	h.types[statement] = nil
	plan := h.plan(c, statement)
	declared := declaredSuccess(analyzerFor(c), plan.fn)
	var types []*checker.Type
	if declared != nil {
		types = append(types, declared) // every return is checked against the written success type
	} else {
		for _, e := range plan.independent {
			types = append(types, returnedType(c, e, true))
		}
	}
	if plan.otherwise {
		types = append(types, c.GetUndefinedType())
	}
	t := c.GetUnionType(types)
	h.types[statement] = t
	return t
}

// returnedType returns the type of e, a returned expression, widened as the
// checker widens an inferred return type when widen is set.
func returnedType(c *checker.Checker, e *ast.Node, widen bool) *checker.Type {
	t := c.GetTypeOfExpressionBeforeWidening(e)
	if widen {
		t = c.GetWidenedType(c.GetWidenedLiteralType(t))
	}
	return t
}

// declaredSuccess returns the success type that fn's written contract names,
// or nil when fn has no contract or infers its success type.
func declaredSuccess(a *analyzer, fn *ast.Node) *checker.Type {
	if fn == nil {
		return nil
	}
	k := a.contractOf(fn)
	switch {
	case k == nil:
		return nil
	case k.reference == nil:
		return successType(a.checker, a.checker.GetTypeFromTypeNode(k.annotation))
	case len(k.channels) == 0 || k.inferred(channelA):
		return nil
	}
	return a.checker.GetTypeFromTypeNode(k.channels[channelA])
}

// A resultPlan sorts the values that a handle statement can end with.
type resultPlan struct {
	fn          *ast.Node   // the function the statement's returns return from
	independent []*ast.Node // returned expressions that do not depend on what a resume returned
	dependent   []*ast.Node // returned expressions, in clauses, computed from what a resume returned
	otherwise   bool        // the statement can end without returning a value
}

// plan sorts what statement, a handle statement, can end with. A return of a
// tail resume, or of a const that holds a resume's result as it is, adds no
// value: the statement already ends with that value some other way.
func (h *handleResults) plan(c *checker.Checker, statement *ast.Node) *resultPlan {
	if plan := h.plans[statement]; plan != nil {
		return plan
	}
	plan := &resultPlan{fn: enclosingFunction(statement)}
	h.plans[statement] = plan
	try := statement.AsTryStatement().TryBlock
	forEachReturn(try, func(e *ast.Node) {
		switch {
		case e == nil:
			plan.otherwise = true
		case clauseOfResume(ast.SkipParentheses(e)) == nil:
			plan.independent = append(plan.independent, e)
		}
	})
	plan.otherwise = plan.otherwise || canCompleteNormally(try) || jumpsOut(try, statement)
	for _, clause := range handleClauses(statement) {
		values := resumedValuesOf(c, clause.block, statement)
		forEachReturn(clause.block, func(e *ast.Node) {
			switch {
			case e == nil:
				plan.otherwise = true
			case clauseOfResume(ast.SkipParentheses(e)) != nil || values.holds(e):
			case values.reaches(e):
				plan.dependent = append(plan.dependent, e)
			default:
				plan.independent = append(plan.independent, e)
			}
		})
		plan.otherwise = plan.otherwise || jumpsOut(clause.block, statement) ||
			canCompleteNormally(clause.block) && !resumesFirst(clause.block, statement)
	}
	return plan
}

// forEachReturn calls f with what each return statement in block returns, nil
// for a bare return, outside nested functions and classes.
func forEachReturn(block *ast.Node, f func(e *ast.Node)) {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if n.Kind == ast.KindReturnStatement {
			f(n.Expression())
		}
		return n.ForEachChild(visit)
	}
	visit(block)
}

// resumedValues holds the names whose values, in one clause of a handle
// statement, may come from what a resume of the statement returned.
type resumedValues struct {
	statement *ast.Node
	tainted   map[string]bool // names declared or assigned in the clause from a resume's result
	held      map[string]bool // consts that hold a resume's result as it is
}

// resumedValuesOf finds the names that block, a clause of statement, declares
// or assigns from what a resume of statement returns, until no more are
// found. A variable whose written type is not a union is left out: the
// checker types it from its annotation, never from its initializer. Each
// function or class the clause declares counts, as it may read such a name.
// The names are the clause's own: returns in the try block cannot see them,
// and no path leads from one clause to another.
func resumedValuesOf(c *checker.Checker, block *ast.Node, statement *ast.Node) *resumedValues {
	v := &resumedValues{statement: statement, tainted: map[string]bool{}, held: map[string]bool{}}
	for changed := true; changed; {
		changed = false
		mark := func(name *ast.Node) {
			forEachBoundName(name, func(id *ast.Node) {
				if !v.tainted[id.Text()] {
					v.tainted[id.Text()] = true
					changed = true
				}
			})
		}
		for _, s := range block.AsBlock().Statements.Nodes[1:] { // after the clause's binding
			visitAll(s, func(n *ast.Node) {
				switch {
				case n.Kind == ast.KindVariableDeclaration:
					initializer := n.Initializer()
					if initializer == nil {
						return
					}
					if ast.IsIdentifier(n.Name()) && n.Type() == nil && ast.IsVarConst(n) && !v.held[n.Name().Text()] {
						if held := ast.SkipParentheses(initializer); isResumeOf(held, statement) || ast.IsIdentifier(held) && v.held[held.Text()] {
							v.held[n.Name().Text()] = true
							changed = true
						}
					}
					if v.reaches(initializer) && !hasPlainAnnotation(c, n) {
						mark(n.Name())
					}
				case n.Kind == ast.KindFunctionDeclaration || n.Kind == ast.KindClassDeclaration:
					if n.Name() != nil {
						mark(n.Name())
					}
				case n.Kind == ast.KindForOfStatement || n.Kind == ast.KindForInStatement:
					loop := n.AsForInOrOfStatement()
					if v.reaches(loop.Expression) {
						markTarget(loop.Initializer, mark)
					}
				case ast.IsBinaryExpression(n) && ast.IsAssignmentOperator(n.AsBinaryExpression().OperatorToken.Kind):
					if b := n.AsBinaryExpression(); v.reaches(b.Right) {
						markTarget(b.Left, mark)
					}
				}
			})
		}
	}
	return v
}

// hasPlainAnnotation reports whether declaration's written type is not a
// union, so that the checker never narrows the variable by its initializer.
func hasPlainAnnotation(c *checker.Checker, declaration *ast.Node) bool {
	annotation := declaration.Type()
	return annotation != nil && c.GetTypeFromTypeNode(annotation).Flags()&checker.TypeFlagsUnion == 0
}

// markTarget passes mark the names an assignment or a loop's declaration
// writes through target: a variable, the root of a property or element
// access, or each name of a destructuring pattern.
func markTarget(target *ast.Node, mark func(*ast.Node)) {
	if target == nil {
		return
	}
	switch {
	case target.Kind == ast.KindVariableDeclarationList:
		for _, declaration := range target.AsVariableDeclarationList().Declarations.Nodes {
			mark(declaration.Name())
		}
	case ast.IsIdentifier(target):
		mark(target)
	case ast.IsPropertyAccessExpression(target) || ast.IsElementAccessExpression(target) || ast.IsParenthesizedExpression(target):
		markTarget(target.Expression(), mark)
	default:
		visitAll(target, func(n *ast.Node) {
			if ast.IsIdentifier(n) && isReference(n) {
				mark(n)
			}
		})
	}
}

// forEachBoundName calls f with each identifier that name, an identifier or
// a binding pattern, binds.
func forEachBoundName(name *ast.Node, f func(*ast.Node)) {
	if ast.IsIdentifier(name) {
		f(name)
		return
	}
	name.ForEachChild(func(child *ast.Node) bool {
		if child.Kind == ast.KindBindingElement {
			forEachBoundName(child.Name(), f)
		}
		return false
	})
}

// holds reports whether e, a returned expression, is a const that holds a
// resume's result as it is.
func (v *resumedValues) holds(e *ast.Node) bool {
	e = ast.SkipParentheses(e)
	return ast.IsIdentifier(e) && v.held[e.Text()]
}

// reaches reports whether evaluating e can give a value computed from what a
// resume of the statement returned: e runs such a resume, or reads a name
// that holds such a value.
func (v *resumedValues) reaches(e *ast.Node) bool {
	found := false
	visitAll(e, func(n *ast.Node) {
		if !found && (isResumeOf(n, v.statement) || ast.IsIdentifier(n) && v.tainted[n.Text()] && isReference(n)) {
			found = true
		}
	})
	return found
}

// isReference reports whether id, an identifier, reads a variable: it is
// not a declaration's name, a property's name or key, a label, or part of a
// type.
func isReference(id *ast.Node) bool {
	p := id.Parent
	switch {
	case p == nil:
		return false
	case p.Kind == ast.KindShorthandPropertyAssignment:
		return true
	case ast.IsPropertyAccessExpression(p) && p.Name() == id,
		p.Kind == ast.KindBreakStatement, p.Kind == ast.KindContinueStatement, p.Kind == ast.KindLabeledStatement:
		return false
	}
	return !ast.IsDeclarationName(id) && !ast.IsPartOfTypeNode(id)
}

// visitAll calls f with node and every node under it.
func visitAll(node *ast.Node, f func(*ast.Node)) {
	f(node)
	node.ForEachChild(func(child *ast.Node) bool {
		visitAll(child, f)
		return false
	})
}

// resumesFirst reports whether block, a clause of statement, always resumes
// before it can end normally: one of its own statements always evaluates a
// resume. Such a clause then ends as the resumed block did.
func resumesFirst(block *ast.Node, statement *ast.Node) bool {
	for _, s := range block.AsBlock().Statements.Nodes[1:] {
		found := false
		visitAll(s, func(n *ast.Node) {
			if !found && isResumeOf(n, statement) && alwaysEvaluated(n, s) {
				found = true
			}
		})
		if found {
			return true
		}
	}
	return false
}

// alwaysEvaluated reports whether evaluating top, a statement, evaluates node
// unless something before node fails or jumps.
func alwaysEvaluated(node *ast.Node, top *ast.Node) bool {
	for n := node; n != top; n = n.Parent {
		p := n.Parent
		if p == nil || isFunctionBoundary(p) {
			return false
		}
		switch p.Kind {
		case ast.KindConditionalExpression:
			if n != p.AsConditionalExpression().Condition {
				return false
			}
		case ast.KindBinaryExpression:
			b := p.AsBinaryExpression()
			if op := b.OperatorToken.Kind; n != b.Left && (ast.IsLogicalOrCoalescingBinaryOperator(op) || ast.IsLogicalOrCoalescingAssignmentOperator(op)) {
				return false
			}
		case ast.KindIfStatement:
			if n != p.AsIfStatement().Expression {
				return false
			}
		case ast.KindWhileStatement:
			if n != p.AsWhileStatement().Expression {
				return false
			}
		case ast.KindDoStatement:
			if n != p.AsDoStatement().Statement {
				return false
			}
		case ast.KindForStatement:
			if n != p.AsForStatement().Initializer {
				return false
			}
		case ast.KindForInStatement, ast.KindForOfStatement:
			if n != p.AsForInOrOfStatement().Expression {
				return false
			}
		case ast.KindSwitchStatement:
			if n != p.AsSwitchStatement().Expression {
				return false
			}
		case ast.KindCaseBlock, ast.KindCaseClause, ast.KindDefaultClause, ast.KindCatchClause:
			return false
		case ast.KindTryStatement:
			if t := p.AsTryStatement(); n == t.TryBlock && t.CatchClause != nil {
				return false
			}
		default:
			if ast.IsOptionalChain(p) && n != p.Expression() {
				return false
			}
		}
	}
	return true
}

// jumpsOut reports whether a break or continue in block leaves statement.
func jumpsOut(block *ast.Node, statement *ast.Node) bool {
	out := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if out || isFunctionBoundary(n) {
			return out
		}
		if n.Kind == ast.KindBreakStatement || n.Kind == ast.KindContinueStatement {
			if target := jumpTarget(n); target == nil || contains(target, statement) {
				out = true
			}
			return out
		}
		return n.ForEachChild(visit)
	}
	visit(block)
	return out
}

// jumpTarget returns the statement that jump, a break or continue, leaves or
// continues: the labeled statement it names, or the nearest loop, or for a
// break the nearest switch.
func jumpTarget(jump *ast.Node) *ast.Node {
	label := ""
	if l := jump.Label(); l != nil {
		label = l.Text()
	}
	for n := jump.Parent; n != nil && !isFunctionBoundary(n); n = n.Parent {
		switch {
		case label != "":
			if n.Kind == ast.KindLabeledStatement && n.AsLabeledStatement().Label.Text() == label {
				return n
			}
		case ast.IsIterationStatement(n, false), n.Kind == ast.KindSwitchStatement && jump.Kind == ast.KindBreakStatement:
			return n
		}
	}
	return nil
}

// contains reports whether node is ancestor or lies inside it.
func contains(ancestor *ast.Node, node *ast.Node) bool {
	for n := node; n != nil; n = n.Parent {
		if n == ancestor {
			return true
		}
	}
	return false
}

// checkHandleResults reports EK2119 at a return in a handle statement's
// clause, computed from what a resume returned, that the statement's result
// type does not include, and EK2110 at a resume whose result a clause of a
// handle call reads where the handle can produce something else.
func checkHandleResults(c *checker.Checker, file *ast.SourceFile) {
	h := handleResultsOf(c)
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case isHandleStatement(n):
			checkStatementResults(c, h, n)
		case ast.IsCallExpression(n) && len(n.Arguments()) >= 3 && ast.IsObjectLiteralExpression(n.Arguments()[2]) && runtimeExport(c, n.Expression()) == "handle":
			checkHandleCallResults(c, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkStatementResults reports EK2119 for statement, a handle statement in
// a function without a written success type.
func checkStatementResults(c *checker.Checker, h *handleResults, statement *ast.Node) {
	plan := h.plan(c, statement)
	if plan.fn == nil || len(plan.dependent) == 0 || declaredSuccess(analyzerFor(c), plan.fn) != nil {
		return
	}
	result := h.resultType(c, statement)
	if result == nil {
		return
	}
	for _, e := range plan.dependent {
		t := returnedType(c, e, true)
		if c.IsTypeAssignableTo(t, result) {
			continue
		}
		d := report(c, e, EK2119, c.TypeToString(t), c.TypeToString(result))
		note(d, "Write the function's success type to include it, such as Effect<{0}, infer E, infer R>, which still infers E and R; resume's result then has that type.", c.TypeToString(c.GetUnionType([]*checker.Type{result, t})))
	}
}

// checkHandleCallResults reports EK2110 at each resume whose result a clause
// of call, a handle call, reads, when the handle can produce a result that
// the type of resume's result does not include.
func checkHandleCallResults(c *checker.Checker, call *ast.Node) {
	var produced *checker.Type
	for _, property := range call.Arguments()[2].AsObjectLiteralExpression().Properties.Nodes {
		fn := clauseFunctionOf(property)
		if fn == nil || fn.Body() == nil {
			continue
		}
		for _, resume := range readResumes(c, fn) {
			if produced == nil {
				if produced = signatureSuccess(c, call); produced == nil {
					return
				}
			}
			result := signatureSuccess(c, resume)
			if result == nil || c.IsTypeAssignableTo(produced, result) {
				continue
			}
			d := report(c, resume, EK2110, c.TypeToString(produced), c.TypeToString(result))
			if len(call.Arguments()) > 3 {
				note(d, "With onReturn, resume's result is typed never: return it unread, or transform the handle's result after handle returns.")
			} else {
				note(d, "A clause's return ends the handle with that value, which a resume still waiting then returns. Make every clause return {0}, or return resume's result unread.", c.TypeToString(result))
			}
		}
	}
}

// clauseFunctionOf returns the function that property, a property of a
// handle call's clauses object, holds: a method, or a function or arrow
// function assigned to the property.
func clauseFunctionOf(property *ast.Node) *ast.Node {
	switch {
	case property.Kind == ast.KindMethodDeclaration:
		return property
	case ast.IsPropertyAssignment(property):
		if initializer := ast.SkipParentheses(property.Initializer()); initializer.Kind == ast.KindArrowFunction || initializer.Kind == ast.KindFunctionExpression {
			return initializer
		}
	}
	return nil
}

// readResumes returns the resumes and resumeWiths in fn, a clause of a
// handle call, whose result fn's own code reads: those that pass one of fn's
// parameters, the continuation, and whose result it does not discard, return,
// or hold in a const that it only returns.
func readResumes(c *checker.Checker, fn *ast.Node) []*ast.Node {
	parameters := map[string]bool{}
	for _, parameter := range fn.Parameters() {
		if ast.IsIdentifier(parameter.Name()) {
			parameters[parameter.Name().Text()] = true
		}
	}
	var resumes []*ast.Node
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsCallExpression(n) && len(n.Arguments()) > 0 && ast.IsIdentifier(n.Arguments()[0]) && parameters[n.Arguments()[0].Text()] &&
			resumeKind(c, n) != "" && isResultRead(n, fn.Body()) {
			resumes = append(resumes, n)
		}
		return n.ForEachChild(visit)
	}
	if body := fn.Body(); ast.IsBlock(body) {
		body.ForEachChild(visit)
	} else {
		visit(body) // an arrow function's expression body
	}
	return resumes
}

// isResultRead reports whether code reads what call returns: anything but
// discarding it, returning it, or holding it in a const that body only
// returns.
func isResultRead(call *ast.Node, body *ast.Node) bool {
	n := call
	for n.Parent != nil && ast.IsParenthesizedExpression(n.Parent) {
		n = n.Parent
	}
	p := n.Parent
	switch {
	case p == nil, p.Kind == ast.KindExpressionStatement, p.Kind == ast.KindVoidExpression, p.Kind == ast.KindReturnStatement:
		return false
	case p.Kind == ast.KindArrowFunction && p.Body() == n:
		return false
	case p.Kind == ast.KindVariableDeclaration && p.Initializer() == n && p.Type() == nil && ast.IsIdentifier(p.Name()) && ast.IsVarConst(p):
		name := p.Name()
		read := false
		visitAll(body, func(m *ast.Node) {
			if !read && m != name && ast.IsIdentifier(m) && m.Text() == name.Text() && isReference(m) && !isReturnedValue(m) {
				read = true
			}
		})
		return read
	}
	return true
}

// signatureSuccess returns the success type of the Effect that call's
// resolved signature returns, or nil.
func signatureSuccess(c *checker.Checker, call *ast.Node) *checker.Type {
	sig := c.GetResolvedSignature(call)
	if sig == nil {
		return nil
	}
	return successType(c, c.GetReturnTypeOfSignature(sig))
}
