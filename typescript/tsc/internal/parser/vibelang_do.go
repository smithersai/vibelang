package parser

import (
	"fmt"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// do { … } is exactly TC39's do expression (VIP-2), pinned to this snapshot
// of the proposal, which docs/design/vips/tc39-do-expressions vendors.
// VibeLang moves to a newer snapshot deliberately, never automatically.
const (
	DoExpressionsCommit = "3ef6d463b8163cbf222846b40d17178cca36e9e1"
	DoExpressionsDate   = "2021-03-03"
)

// The diagnostics of a do expression. The checker's registry lists the same
// codes and texts (vibelang/diagnostics.go).
const (
	// DoEndsCode: the block ends in a declaration, a loop or an if without
	// an else, TC39's EndsInIterationOrBareIfOrDeclaration. {0} names it,
	// {1} says how to fix it.
	DoEndsCode    = 201
	DoEndsMessage = "A do expression's value is its last statement's, so the block cannot end with {0}. {1}"
	// DoLoopHeadCode: a jump in a do expression in a loop's head leaves the
	// do expression unlabeled, or targets that loop. {0} is the keyword.
	DoLoopHeadCode    = 205
	DoLoopHeadMessage = "{0} cannot leave a do expression that stands in a loop's head unless a label names an outer statement."
	// DoParameterVarCode: a var declaration in a do expression in a
	// parameter list.
	DoParameterVarCode    = 203
	DoParameterVarMessage = "A do expression in a parameter list cannot declare var. Use let or const."
	// DoBoundaryCode: a do expression where VibeLang still writes a function
	// around it, which return, var, a jump out, await or yield cannot cross.
	// {0} is the keyword, {1} where the do expression stands.
	DoBoundaryCode    = 204
	DoBoundaryMessage = "{0} cannot leave this do expression: VibeLang still compiles {1} to a function. Move the do expression into a statement of its own."
)

// A do expression parses into (() => block)() while the file is read, as
// D187 had it, and parseVibeLangDos then lowers each one, once the whole
// file is known:
//
//	const x = f(g(), do { const a = h(); a + 1 })
//	                                    const $do_t1 = g()
//	                                    let $do1
//	                                    { const a = h(); $do1 = a + 1 }
//	                                    const x = f($do_t1, $do1)
//
// The block runs where the do expression stands, in the enclosing function,
// so return, break, continue, var, await, yield and try inside it mean what
// they mean around it. Its completion value is TC39's: each expression
// statement assigns the temporary, and each if, switch, try and loop first
// resets it to undefined, as UpdateEmpty does. Operands the expression
// evaluates before the do expression and that may have effects are read
// into constants first, so they still run first. A logical, conditional or
// logical-assignment operator that evaluates the do expression only
// sometimes becomes an if.
//
// A do expression where no statement surrounds it, such as a parameter
// default, a class member, a case test, an optional chain or a VibeLang
// form that is still a function (match, catch, throw expressions, fork),
// keeps its function. That is exact unless the block returns, declares var,
// jumps out, awaits or yields, which is DoBoundaryCode.

// doExpression is one do expression as written.
type doExpression struct {
	call    *ast.Node // (() => block)()
	arrow   *ast.Node
	block   *ast.Node
	keyword core.TextRange
	match   bool      // a surrounding match lowered with a native do expression
	lifted  bool      // lowered to statements, rather than kept as its function
	name    *ast.Node // the temporary that holds its completion value
}

func (p *Parser) recordVibeLangDo(call, arrow, block *ast.Node, keyword core.TextRange) {
	if p.vibelangDos == nil {
		p.vibelangDos = map[*ast.Node]*doExpression{}
	}
	d := &doExpression{call: call, arrow: arrow, block: block, keyword: keyword}
	p.vibelangDos[call] = d
	p.vibelangDoOrder = append(p.vibelangDoOrder, d)
}

func (p *Parser) doError(at core.TextRange, code int32, text string, args ...string) {
	for i, arg := range args {
		text = strings.ReplaceAll(text, "{"+strconv.Itoa(i)+"}", arg)
	}
	p.diagnostics = append(p.diagnostics, ast.NewExternalDiagnostic(nil, at, "EK", diagnostics.CategoryError, code, text))
}

// parseVibeLangDos checks and lowers the file's do expressions.
func (p *Parser) parseVibeLangDos(file *ast.SourceFile) {
	if len(p.vibelangDoOrder) == 0 {
		return
	}
	p.prepareDoMatches()
	marked := map[*ast.Node]bool{}
	sites := map[*doExpression]*ast.Node{}
	for _, d := range p.vibelangDoOrder {
		if site := p.doSite(d.call); site != nil && !p.opts.VibeLangDoAsFunction {
			d.lifted = true
			sites[d] = site
		}
	}
	for _, d := range p.vibelangDoOrder {
		inParameter := false
		if !d.match {
			p.checkDoEnds(d)
			p.checkDoLoopHead(d)
			inParameter = p.checkDoParameterVar(d)
		}
		if !d.lifted {
			what := "a do expression in this position"
			if p.opts.VibeLangDoAsFunction {
				what = "every do expression for the TS7 mapper"
			}
			p.checkDoBoundary(d, d.arrow, what, inParameter)
			continue
		}
		site := sites[d]
		if boundary, what := p.transparentFunctionOf(site); boundary != nil {
			p.checkDoBoundary(d, boundary, what, inParameter)
		}
		for n := d.call; n != site; n = n.Parent {
			marked[n] = true
		}
	}
	l := &doLowering{p: p, marked: marked}
	for i, d := range p.vibelangDoOrder {
		statements := d.block.AsBlock().Statements
		if p.opts.VibeLangDoAsFunction {
			// The TS7 mapper prints a function that returns the last
			// statement's value.
			if len(statements.Nodes) != 0 {
				p.mapperCompletion(statements)
			}
			continue
		}
		d.name = p.mTemp("$do"+strconv.Itoa(i+1), d.keyword)
		statements.Nodes = l.completeList(d.name, statements.Nodes)
		if !d.lifted {
			// The function returns the completion value: (() => { let $do1; …; return $do1 })()
			end := d.keyword
			ref := l.ref(d.name, end)
			returned := p.vibelangSpanning(p.factory.NewReturnStatement(ref), end)
			let := l.letStatement(l.ref(d.name, d.keyword), d.keyword)
			p.completionSite(let, ref)
			statements.Nodes = append(append([]*ast.Node{let}, statements.Nodes...), returned)
		}
		p.overrideParentInImmediateChildren(d.block)
	}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		n.ForEachChild(visit)
		l.lowerIn(n)
		return false
	}
	file.AsNode().ForEachChild(visit)
	file.Statements.Nodes = l.statements(file.Statements.Nodes)
	p.overrideParentInImmediateChildren(file.AsNode())
	if sites := p.vibelangDoSites; sites != nil {
		file.GetOrComputeData(ast.VibeLangDoSites, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return sites })
	}
	file.SetDiagnostics(attachFileToDiagnostics(p.diagnostics, file))
}

// completionSite marks the declaration of let, the statement declaring a do
// expression's completion temporary, and records ref, the reference that
// stands where the do expression was, for the checker: an assignment of a
// completion value takes ref's contextual type, as the value returned from
// the function the do first was takes the function's (ast.VibeLangDoSites;
// chapter 002, "Contextual typing reaches only the expression alternatives
// contributing to the normal result").
func (p *Parser) completionSite(let, ref *ast.Node) {
	declaration := let.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	declaration.Flags |= ast.NodeFlagsVibeLangDoCompletion
	if p.vibelangDoSites == nil {
		p.vibelangDoSites = map[*ast.Node]*ast.Node{}
	}
	p.vibelangDoSites[declaration] = ref
}

// prepareDoMatches removes the synthetic callable boundary around a match
// containing a do expression. A matched arm assigns the match completion and
// leaves its label; a source return/break/continue inside do remains outward.
// Only native do-bearing matches participate, and the TS mapper retains its
// documented callable-boundary diagnostic.
func (p *Parser) prepareDoMatches() {
	if p.opts.VibeLangDoAsFunction {
		return
	}
	var matches []*ast.Node
	seen := map[*ast.Node]bool{}
	for _, d := range p.vibelangDoOrder {
		for n := d.call.Parent; n != nil; n = n.Parent {
			if ast.IsFunctionLike(n) && !isSynthesizedArrow(n) {
				break
			}
			if n.Kind == ast.KindCallExpression && p.vibelangMatches[n] != nil && !seen[n] {
				seen[n] = true
				matches = append(matches, n)
			}
		}
	}
	for _, call := range matches {
		info := p.vibelangMatches[call]
		arrow := ast.SkipParentheses(call.Expression())
		p.vibelangMatchTemps++
		label := "$doMatch" + strconv.Itoa(p.vibelangMatchTemps)
		statements := p.matchStatements(info, func(value *ast.Node, at core.TextRange) []*ast.Node {
			leave := p.vibelangSpanning(p.factory.NewBreakStatement(p.mTemp(label, info.anchor)), at)
			return []*ast.Node{p.vibelangSpanning(p.factory.NewExpressionStatement(value), at), leave}
		}, func(noMatch *ast.Node, at core.TextRange) *ast.Node {
			return p.vibelangSpanning(p.factory.NewExpressionStatement(noMatch), at)
		})
		body := p.mBlock(statements, call.Loc)
		labeled := p.vibelangSpanning(p.factory.NewLabeledStatement(p.mTemp(label, info.anchor), body), call.Loc)
		block := p.mBlock([]*ast.Node{labeled}, call.Loc)
		arrow.AsArrowFunction().Body = block
		p.overrideParentInImmediateChildren(arrow)
		d := &doExpression{call: call, arrow: arrow, block: block, keyword: info.anchor, match: true}
		p.vibelangDos[call] = d
		p.vibelangDoOrder = append(p.vibelangDoOrder, d)
	}
}

// ---------------------------------------------------------------- TC39's early errors

// checkDoEnds reports TC39's EndsInIterationOrBareIfOrDeclaration.
func (p *Parser) checkDoEnds(d *doExpression) {
	if bad := endsBadly(d.block.AsBlock().Statements.Nodes, nil, true); bad != nil {
		what, fix := "a declaration", "End it with the value, after the declaration."
		switch {
		case ast.IsIterationStatement(bad, false):
			what, fix = "a loop", "End it with the value, after the loop."
		case bad.Kind == ast.KindIfStatement:
			what, fix = "an if without an else", "Give the if an else with the value it has otherwise."
		}
		p.doError(p.skipRangeTrivia(bad.Loc), DoEndsCode, DoEndsMessage, what, fix)
	}
}

const emptyLabel = "" // the label set's ~empty~: an unlabeled break

func hasLabel(labels []string, label string) bool {
	for _, l := range labels {
		if l == label {
			return true
		}
	}
	return false
}

func withoutEmpty(labels []string) []string {
	var out []string
	for _, l := range labels {
		if l != emptyLabel {
			out = append(out, l)
		}
	}
	return out
}

// endsBadly is EndsInIterationOrBareIfOrDeclaration of a statement list: it
// returns the statement that makes it true, or nil.
func endsBadly(list []*ast.Node, labels []string, isLast bool) *ast.Node {
	if len(list) == 0 {
		return nil
	}
	item, rest := list[len(list)-1], list[:len(list)-1]
	if len(rest) == 0 {
		return endsBadlyStatement(item, labels, isLast)
	}
	if isEmptyStatement(item, nil) {
		return endsBadly(rest, labels, isLast)
	}
	if isBreakStatement(item, labels) {
		return endsBadly(rest, labels, true)
	}
	if bad := endsBadly(rest, labels, false); bad != nil {
		return bad
	}
	return endsBadlyStatement(item, labels, isLast)
}

func endsBadlyStatement(s *ast.Node, labels []string, isLast bool) *ast.Node {
	when := func(b bool) *ast.Node {
		if b {
			return s
		}
		return nil
	}
	switch s.Kind {
	case ast.KindEmptyStatement, ast.KindExpressionStatement, ast.KindContinueStatement, ast.KindBreakStatement,
		ast.KindReturnStatement, ast.KindThrowStatement, ast.KindDebuggerStatement:
		return nil
	case ast.KindVariableStatement:
		if s.AsVariableStatement().DeclarationList.Flags&ast.NodeFlagsBlockScoped == 0 {
			return nil
		}
		return when(isLast)
	case ast.KindBlock:
		return endsBadly(s.AsBlock().Statements.Nodes, labels, isLast)
	case ast.KindIfStatement:
		ifStatement := s.AsIfStatement()
		if ifStatement.ElseStatement == nil {
			if isLast {
				return s
			}
			return endsBadlyStatement(ifStatement.ThenStatement, labels, isLast)
		}
		if bad := endsBadlyStatement(ifStatement.ThenStatement, labels, isLast); bad != nil {
			return bad
		}
		return endsBadlyStatement(ifStatement.ElseStatement, labels, isLast)
	case ast.KindDoStatement, ast.KindWhileStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
		if isLast {
			return s
		}
		body := s.Statement()
		if isBreakStatement(body, labels) {
			return s
		}
		return endsBadlyStatement(body, labels, isLast)
	case ast.KindWithStatement:
		return endsBadlyStatement(s.AsWithStatement().Statement, labels, isLast)
	case ast.KindLabeledStatement:
		labeled := s.AsLabeledStatement()
		if isLast {
			return endsBadlyStatement(labeled.Statement, append(append([]string{}, labels...), labeled.Label.Text()), true)
		}
		return endsBadlyStatement(labeled.Statement, labels, isLast)
	case ast.KindSwitchStatement:
		var caseLabels []string
		if isLast {
			caseLabels = append(append([]string{}, labels...), emptyLabel)
		} else {
			caseLabels = withoutEmpty(labels)
		}
		clauses := s.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes
		for i := len(clauses) - 1; i >= 0; i-- {
			clause := clauses[i].AsCaseOrDefaultClause().Statements.Nodes
			if isEmptyList(clause, nil) {
				continue
			}
			if bad := endsBadly(clause, caseLabels, isLast); bad != nil {
				return bad
			}
			isLast = isBreakList(clause, caseLabels)
		}
		return nil
	case ast.KindTryStatement:
		try := s.AsTryStatement()
		if bad := endsBadlyStatement(try.TryBlock, labels, isLast); bad != nil {
			return bad
		}
		if try.CatchClause != nil {
			return endsBadlyStatement(try.CatchClause.AsCatchClause().Block, labels, isLast)
		}
		return nil
	}
	// A declaration of any kind other than var: let, const, using, function, class,
	// and TypeScript's type, interface, enum and namespace declarations.
	return when(isLast)
}

// isEmptyList is IsEmpty of a statement list.
func isEmptyList(list []*ast.Node, labels []string) bool {
	for i, s := range list {
		if isBreakList(list[:i], labels) && i > 0 {
			return true
		}
		if !isEmptyStatement(s, labels) {
			return false
		}
	}
	return true
}

func isEmptyStatement(s *ast.Node, labels []string) bool {
	switch s.Kind {
	case ast.KindExpressionStatement:
		return isVibeLangMaskMarker(s)
	case ast.KindEmptyStatement, ast.KindDebuggerStatement:
		return true
	case ast.KindBlock:
		return isEmptyList(s.AsBlock().Statements.Nodes, labels)
	case ast.KindBreakStatement:
		return isBreakStatement(s, labels)
	case ast.KindLabeledStatement:
		labeled := s.AsLabeledStatement()
		return isEmptyStatement(labeled.Statement, append(append([]string{}, labels...), labeled.Label.Text()))
	}
	return false
}

// isBreakList is IsBreak of a statement list: its first non-empty statement
// is a break of one of labels.
func isBreakList(list []*ast.Node, labels []string) bool {
	for _, s := range list {
		if isBreakStatement(s, labels) {
			return true
		}
		if !isEmptyStatement(s, nil) {
			return false
		}
	}
	return false
}

func isBreakStatement(s *ast.Node, labels []string) bool {
	switch s.Kind {
	case ast.KindBreakStatement:
		if label := s.Label(); label != nil {
			return hasLabel(labels, label.Text())
		}
		return hasLabel(labels, emptyLabel)
	case ast.KindBlock:
		return isBreakList(s.AsBlock().Statements.Nodes, labels)
	case ast.KindLabeledStatement:
		return isBreakStatement(s.AsLabeledStatement().Statement, labels)
	}
	return false
}

// forEachDoStatement calls f for each node of block's statements, not
// entering functions or classes.
func forEachDoStatement(block *ast.Node, f func(*ast.Node)) {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) || ast.IsClassLike(n) {
			return false
		}
		f(n)
		n.ForEachChild(visit)
		return false
	}
	block.ForEachChild(visit)
}

// jumpTargetWithin reports whether jump, a break or continue, targets a
// statement inside within.
func jumpTargetWithin(jump, within *ast.Node) bool {
	label := jump.Label()
	for n := jump.Parent; n != nil && n != within; n = n.Parent {
		if label != nil {
			if n.Kind == ast.KindLabeledStatement && n.AsLabeledStatement().Label.Text() == label.Text() {
				return true
			}
		} else if ast.IsIterationStatement(n, false) || jump.Kind == ast.KindBreakStatement && n.Kind == ast.KindSwitchStatement {
			return true
		}
	}
	return false
}

// loopHeadOf returns the loop whose head holds node, crossing no function.
func loopHeadOf(node *ast.Node) *ast.Node {
	for child, n := node, node.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsFunctionLike(n) || ast.IsClassLike(n) {
			return nil
		}
		if ast.IsIterationStatement(n, false) && child != n.Statement() {
			return n
		}
	}
	return nil
}

// checkDoLoopHead reports a jump that leaves a do expression in a loop's
// head unlabeled, or targets that loop: TC39 bans both.
func (p *Parser) checkDoLoopHead(d *doExpression) {
	loop := loopHeadOf(d.call)
	if loop == nil {
		return
	}
	outer := loop
	for ast.IsLabeledStatement(outer.Parent) {
		outer = outer.Parent
	}
	labels, _ := ast.CollectLabelChain(outer)
	forEachDoStatement(d.block, func(n *ast.Node) {
		if n.Kind != ast.KindBreakStatement && n.Kind != ast.KindContinueStatement || jumpTargetWithin(n, d.block) {
			return
		}
		label := n.Label()
		targetsLoop := label != nil && slices.ContainsFunc(labels, func(n *ast.Node) bool {
			return n.AsLabeledStatement().Label.Text() == label.Text()
		})
		if label == nil || targetsLoop {
			p.doError(p.skipRangeTrivia(n.Loc), DoLoopHeadCode, DoLoopHeadMessage, keywordOf(n))
		}
	})
}

func keywordOf(jump *ast.Node) string {
	if jump.Kind == ast.KindBreakStatement {
		return "break"
	}
	return "continue"
}

// checkDoParameterVar reports var in a do expression in a parameter list,
// and reports whether the do expression stands in one.
func (p *Parser) checkDoParameterVar(d *doExpression) bool {
	inParameter := false
	for n := d.call.Parent; n != nil && !ast.IsFunctionLike(n) && !ast.IsClassLike(n); n = n.Parent {
		if n.Kind == ast.KindParameter {
			inParameter = true
			break
		}
	}
	if !inParameter {
		return false
	}
	forEachDoStatement(d.block, func(n *ast.Node) {
		if n.Kind == ast.KindVariableDeclarationList && n.Flags&ast.NodeFlagsBlockScoped == 0 {
			p.doError(p.skipRangeTrivia(n.Loc), DoParameterVarCode, DoParameterVarMessage)
		}
	})
	return true
}

// checkDoBoundary reports what cannot leave d through boundary, a function
// VibeLang writes around it: a return, a var declaration, a jump whose
// target is outside boundary, await and yield.
func (p *Parser) checkDoBoundary(d *doExpression, boundary *ast.Node, what string, inParameter bool) {
	forEachDoStatement(d.block, func(n *ast.Node) {
		keyword := ""
		switch n.Kind {
		case ast.KindReturnStatement:
			keyword = "return"
		case ast.KindVariableDeclarationList:
			if n.Flags&ast.NodeFlagsBlockScoped == 0 && !inParameter {
				keyword = "var"
			}
		case ast.KindBreakStatement, ast.KindContinueStatement:
			if !jumpTargetWithin(n, boundary) {
				keyword = keywordOf(n)
			}
		case ast.KindAwaitExpression:
			keyword = "await"
		case ast.KindYieldExpression:
			keyword = "yield"
		}
		if keyword != "" {
			if p.doForTryHeadJump(boundary, n) {
				return // The for try checker owns EK2002/EK2003, once.
			}
			p.doError(p.skipRangeTrivia(n.Loc), DoBoundaryCode, DoBoundaryMessage, keyword, what)
		}
	})
}

// A forbidden per-item jump belongs to VIP-20, even when an unsupported do
// position is still an IIFE. Letting the for try checker report its language error avoids
// hiding or duplicating EK2002/EK2003 with implementation-boundary EK0204.
func (p *Parser) doForTryHeadJump(boundary, jump *ast.Node) bool {
	if jump.Kind != ast.KindReturnStatement && (!ast.IsBreakOrContinueStatement(jump) || jump.Label() == nil) {
		return false
	}
	isDo := func(fn *ast.Node) bool {
		call := fn.Parent
		for call != nil && call.Kind == ast.KindParenthesizedExpression {
			call = call.Parent
		}
		d := p.vibelangDos[call]
		return d != nil && d.arrow == fn
	}
	var loop *ast.Node
	for child, n := boundary, boundary.Parent; n != nil; child, n = n, n.Parent {
		if ast.IsClassLike(n) || ast.IsFunctionLike(n) && !isDo(n) {
			return false
		}
		if n.Kind == ast.KindForOfStatement && n.Flags&ast.NodeFlagsVibeLang != 0 && child == n.AsForInOrOfStatement().Initializer {
			loop = n
			break
		}
	}
	if loop == nil {
		return false
	}
	if jump.Kind == ast.KindReturnStatement {
		return true
	}
	for n := jump.Parent; n != nil; n = n.Parent {
		if ast.IsClassLike(n) || ast.IsFunctionLike(n) && !isDo(n) {
			return false
		}
		if n.Kind != ast.KindLabeledStatement || n.Label().Text() != jump.Label().Text() {
			continue
		}
		target := n.Statement()
		for target != nil && target.Kind == ast.KindLabeledStatement {
			target = target.Statement()
		}
		if target == loop {
			return false
		}
		for parent := n; parent != nil; parent = parent.Parent {
			if parent == loop {
				return false
			}
		}
		return true
	}
	return false
}

// ---------------------------------------------------------------- where a do expression is lowered

// isSynthesizedArrow reports whether node is an arrow the parser writes,
// whose => token is synthesized.
func isSynthesizedArrow(node *ast.Node) bool {
	return node != nil && node.Kind == ast.KindArrowFunction && node.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0
}

// transparentFunctionOf returns the function the parser writes around site
// for a form that is an expression in the source, a match, throw or catch
// expression or a do expression kept as its function, and what it is; or
// nil when site's function is one the source wrote.
func (p *Parser) transparentFunctionOf(site *ast.Node) (*ast.Node, string) {
	fn := site
	if !isSynthesizedArrow(fn) {
		// The arrow of a do expression lowered to statements is no function.
		fn = ast.FindAncestor(site.Parent, func(n *ast.Node) bool {
			if !ast.IsFunctionLike(n) {
				return false
			}
			call := n.Parent
			for call != nil && call.Kind == ast.KindParenthesizedExpression {
				call = call.Parent
			}
			d := p.vibelangDos[call]
			return d == nil || !d.lifted
		})
	}
	if !isSynthesizedArrow(fn) {
		return nil, ""
	}
	outer := fn
	for outer.Parent != nil && outer.Parent.Kind == ast.KindParenthesizedExpression {
		outer = outer.Parent
	}
	if call := outer.Parent; call != nil && call.Kind == ast.KindCallExpression {
		if call.Expression() == outer && len(call.Arguments()) == 0 {
			return fn, "the match, throw or do expression around it"
		}
		if callee := call.Expression(); ast.IsIdentifier(callee) && callee.Text() == "$catchExpression" {
			return fn, "the catch expression around it"
		}
	}
	return nil, ""
}

// isIntrinsicCall returns the name of call's synthesized callee, as
// $awaitAll or fork, or "".
func isIntrinsicCall(call *ast.Node) string {
	callee := call.Expression()
	if ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsReparsed != 0 {
		return callee.Text()
	}
	if ast.IsIdentifier(callee) && callee.Text() == "fork" {
		return "fork"
	}
	return ""
}

// isAwaitLiteralOperation reports whether call is await.all, allSettled,
// race or any, whose literal operand's elements are programs by syntax.
func isAwaitLiteralOperation(name string) bool {
	switch name {
	case "$awaitAll", "$awaitAllSettled", "$awaitRace", "$awaitAny":
		return true
	}
	return false
}

// isTryOperation reports whether name is the helper of try.all, race, any
// or allSettled (VIP-18).
func isTryOperation(name string) bool {
	switch name {
	case "$tryAll", "$tryAllSettled", "$tryRace", "$tryAny":
		return true
	}
	return false
}

// doSite returns the statement that do, a do expression's call, is lowered
// before: an expression statement, a declaration, a return, a throw, an
// export assignment, the head of an if, switch, while or for-in/of loop, or
// a for loop's initializer; or a source arrow whose expression body holds
// it. It returns nil where it stays a function.
func (p *Parser) doSite(do *ast.Node) *ast.Node {
	child := do
	for {
		n := child.Parent
		if n == nil {
			return nil
		}
		switch n.Kind {
		case ast.KindParenthesizedExpression, ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindNonNullExpression,
			ast.KindTypeAssertionExpression, ast.KindTypeOfExpression, ast.KindVoidExpression, ast.KindDeleteExpression,
			ast.KindAwaitExpression, ast.KindYieldExpression, ast.KindSpreadElement, ast.KindPrefixUnaryExpression,
			ast.KindPostfixUnaryExpression, ast.KindTemplateSpan, ast.KindTemplateExpression, ast.KindArrayLiteralExpression,
			ast.KindSpreadAssignment, ast.KindObjectLiteralExpression, ast.KindConditionalExpression, ast.KindTaggedTemplateExpression:
		case ast.KindPropertyAccessExpression, ast.KindElementAccessExpression:
			if n.Flags&ast.NodeFlagsOptionalChain != 0 {
				return nil
			}
		case ast.KindCallExpression, ast.KindNewExpression:
			if n.Flags&ast.NodeFlagsOptionalChain != 0 {
				return nil
			}
			if n.Kind == ast.KindCallExpression {
				switch name := isIntrinsicCall(n); {
				case name == "", name == "$await", name == "$join", isTryOperation(name):
					// VIP-2: a do element of try.all, race, any or
					// allSettled runs now, as any do does; VIP-18's
					// operand is an array of Effect values.
				case isAwaitLiteralOperation(name):
					// D322: a do element is still a program by syntax.
					return nil
				default:
					return nil
				}
			}
		case ast.KindBinaryExpression:
			binary := n.AsBinaryExpression()
			operator := binary.OperatorToken.Kind
			if child == binary.Right && ast.IsCompoundAssignmentOperator(operator) && !ast.IsIdentifier(ast.SkipParentheses(binary.Left)) {
				return nil
			}
		case ast.KindPropertyAssignment:
			if child != n.Initializer() && child != n.Name() {
				return nil
			}
		case ast.KindComputedPropertyName:
			if n.Parent.Kind != ast.KindPropertyAssignment {
				return nil
			}
		case ast.KindVariableDeclaration:
			if child != n.Initializer() {
				return nil
			}
			list := n.Parent
			switch statement := list.Parent; {
			case statement.Kind == ast.KindVariableStatement:
				return statement
			case statement.Kind == ast.KindForStatement && statement.AsForStatement().Initializer == list:
				// The head owns its lexical/per-iteration environment. Keep the
				// expression in that environment until this position can lower
				// without moving bindings outside the loop.
				return nil
			}
			return nil
		case ast.KindExpressionStatement, ast.KindReturnStatement, ast.KindThrowStatement, ast.KindExportAssignment:
			return n
		case ast.KindIfStatement, ast.KindSwitchStatement, ast.KindWhileStatement, ast.KindForOfStatement, ast.KindForInStatement:
			if child == n.Expression() {
				return n
			}
			return nil
		case ast.KindForStatement:
			if child == n.AsForStatement().Initializer {
				return n
			}
			return nil
		case ast.KindArrowFunction:
			if child == n.Body() && !isSynthesizedArrow(n) {
				return n
			}
			return nil
		default:
			return nil
		}
		child = n
	}
}

// ---------------------------------------------------------------- lowering

type doLowering struct {
	p      *Parser
	marked map[*ast.Node]bool // the nodes from each lowered do expression up to its statement
	temps  int
}

func (l *doLowering) temp(prefix string, at core.TextRange) *ast.Node {
	l.temps++
	return l.p.mTemp(prefix+strconv.Itoa(l.temps), at)
}

func (l *doLowering) ref(temp *ast.Node, at core.TextRange) *ast.Node {
	// Synthesized references have no leading trivia. In a logical
	// expression the left operand may start before the generated let
	// anchor; carrying that trivia invents a use before declaration.
	return l.p.mTemp(temp.Text(), l.p.skipRangeTrivia(at))
}

func (l *doLowering) letStatement(name *ast.Node, at core.TextRange) *ast.Node {
	return l.p.mConst(name, ast.NodeFlagsLet, nil, at)
}

func (l *doLowering) assign(target, value *ast.Node, at core.TextRange) *ast.Node {
	if value.Kind == ast.KindBinaryExpression && value.AsBinaryExpression().OperatorToken.Kind == ast.KindCommaToken {
		value = l.p.mParens(value, value.Loc)
	}
	return l.p.mBinary(target, ast.KindEqualsToken, value, at)
}

func (l *doLowering) statement(expression *ast.Node, at core.TextRange) *ast.Node {
	return l.p.vibelangSpanning(l.p.factory.NewExpressionStatement(expression), at)
}

func (l *doLowering) undefined(at core.TextRange) *ast.Node {
	return l.p.vibelangSpanning(l.p.factory.NewVoidExpression(l.p.mNumber(0, at)), at)
}

// completeList makes statements assign each completion value to name, as
// TC39 evaluates them: an expression statement sets it, and an if, switch,
// try or loop resets it to undefined first, as UpdateEmpty does. A normal
// finally preserves the protected value; an abrupt one replaces it.
//
// An expression statement that the next statement overwrites, by setting or
// resetting the value, keeps its own expression, so a value such as a fiber
// that only passes through the block does not flow into the temporary.
func (l *doLowering) completeList(name *ast.Node, statements []*ast.Node) []*ast.Node {
	var out []*ast.Node
	for i, s := range statements {
		if s.Kind == ast.KindExpressionStatement && i+1 < len(statements) && setsCompletion(statements[i+1]) {
			out = append(out, s)
			continue
		}
		out = append(out, l.complete(name, s)...)
	}
	return out
}

// setsCompletion reports whether s sets or resets the completion value
// before anything else it does can leave the block.
func setsCompletion(s *ast.Node) bool {
	if isVibeLangMaskMarker(s) {
		return false
	}
	switch s.Kind {
	case ast.KindExpressionStatement, ast.KindIfStatement, ast.KindSwitchStatement, ast.KindTryStatement,
		ast.KindDoStatement, ast.KindWhileStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
		return true
	}
	return false
}

func (l *doLowering) reset(name *ast.Node, at core.TextRange) *ast.Node {
	return l.statement(l.assign(l.ref(name, at), l.undefined(at), at), at)
}

// complete returns s with its completion values assigned to name, preceded
// by the reset that an if, switch, try or loop makes.
func (l *doLowering) complete(name *ast.Node, s *ast.Node) []*ast.Node {
	if isVibeLangMaskMarker(s) {
		return []*ast.Node{s}
	}
	at := l.p.skipRangeTrivia(s.Loc)
	switch s.Kind {
	case ast.KindExpressionStatement:
		statement := s.AsExpressionStatement()
		value := statement.Expression
		statement.Expression = l.assign(l.ref(name, value.Loc), value, value.Loc)
		l.p.overrideParentInImmediateChildren(s)
		if l.marked[value] {
			// keep the path to a do expression inside it
			for n := value.Parent; n != s; n = n.Parent {
				l.marked[n] = true
			}
		}
		return []*ast.Node{s}
	case ast.KindBlock:
		block := s.AsBlock()
		block.Statements.Nodes = l.completeList(name, block.Statements.Nodes)
		l.p.overrideParentInImmediateChildren(s)
		return []*ast.Node{s}
	case ast.KindLabeledStatement:
		labeled := s.AsLabeledStatement()
		inner := l.complete(name, labeled.Statement)
		labeled.Statement = inner[len(inner)-1]
		l.p.overrideParentInImmediateChildren(s)
		return append(inner[:len(inner)-1:len(inner)-1], s)
	case ast.KindIfStatement:
		ifStatement := s.AsIfStatement()
		ifStatement.ThenStatement = l.completeSlot(name, ifStatement.ThenStatement)
		if ifStatement.ElseStatement != nil {
			ifStatement.ElseStatement = l.completeSlot(name, ifStatement.ElseStatement)
		}
		l.p.overrideParentInImmediateChildren(s)
		return []*ast.Node{l.reset(name, at), s}
	case ast.KindSwitchStatement:
		for _, clause := range s.AsSwitchStatement().CaseBlock.AsCaseBlock().Clauses.Nodes {
			c := clause.AsCaseOrDefaultClause()
			c.Statements.Nodes = l.completeList(name, c.Statements.Nodes)
			l.p.overrideParentInImmediateChildren(clause)
		}
		return []*ast.Node{l.reset(name, at), s}
	case ast.KindTryStatement:
		try := s.AsTryStatement()
		l.complete(name, try.TryBlock)
		if try.CatchClause != nil {
			block := try.CatchClause.AsCatchClause().Block
			l.complete(name, block)
			statements := block.AsBlock().Statements
			statements.Nodes = append([]*ast.Node{l.reset(name, l.p.skipRangeTrivia(block.Loc))}, statements.Nodes...)
			l.p.overrideParentInImmediateChildren(block)
		}
		if block := try.FinallyBlock; block != nil {
			// Normal finalization leaves the protected completion untouched.
			// A jump out carries the finalizer's independent completion,
			// initialized to undefined for TryStatement's UpdateEmpty.
			finalAt := l.p.skipRangeTrivia(block.Loc)
			value := l.temp("$do_finally", finalAt)
			l.complete(value, block)
			statements := block.AsBlock().Statements
			statements.Nodes = append([]*ast.Node{l.letStatement(value, finalAt)}, statements.Nodes...)
			var transfer func(*ast.Node) bool
			transfer = func(n *ast.Node) bool {
				if ast.IsClassLike(n) || ast.IsFunctionLike(n) && !isSynthesizedArrow(n) {
					return false
				}
				n.ForEachChild(transfer)
				if !ast.IsBreakOrContinueStatement(n) || jumpTargetWithin(n, block) {
					return false
				}
				parent := n.Parent
				at := l.p.skipRangeTrivia(n.Loc)
				completion := value
				// An abrupt nested do expression already carries its own
				// UpdateEmpty value before its enclosing statement finishes.
				for ancestor := parent; ancestor != nil && ancestor != block; ancestor = ancestor.Parent {
					if d := l.p.vibelangDos[ancestor]; d != nil && d.name != nil {
						completion = d.name
						break
					}
				}
				copy := l.statement(l.assign(l.ref(name, at), l.ref(completion, at), at), at)
				replacement := l.p.mBlock([]*ast.Node{copy, n}, n.Loc)
				switch parent.Kind {
				case ast.KindBlock, ast.KindModuleBlock, ast.KindCaseClause, ast.KindDefaultClause:
					for i, child := range parent.StatementList().Nodes {
						if child == n {
							parent.StatementList().Nodes[i] = replacement
							break
						}
					}
				case ast.KindIfStatement:
					branch := parent.AsIfStatement()
					if branch.ThenStatement == n {
						branch.ThenStatement = replacement
					} else {
						branch.ElseStatement = replacement
					}
				case ast.KindLabeledStatement:
					parent.AsLabeledStatement().Statement = replacement
				case ast.KindWithStatement:
					parent.AsWithStatement().Statement = replacement
				default:
					setStatement(parent, replacement)
				}
				l.p.overrideParentInImmediateChildren(parent)
				return false
			}
			block.ForEachChild(transfer)
			l.p.overrideParentInImmediateChildren(block)
		}
		return []*ast.Node{l.reset(name, at), s}
	case ast.KindDoStatement, ast.KindWhileStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
		setStatement(s, l.completeSlot(name, s.Statement()))
		l.p.overrideParentInImmediateChildren(s)
		return []*ast.Node{l.reset(name, at), s}
	}
	return []*ast.Node{s}
}

// completeSlot completes s, a statement that stands alone, as an if's
// branch or a loop's body, in a block when it needs one.
func (l *doLowering) completeSlot(name *ast.Node, s *ast.Node) *ast.Node {
	out := l.complete(name, s)
	if len(out) == 1 {
		return out[0]
	}
	return l.p.mBlock(out, s.Loc)
}

func setStatement(loop *ast.Node, body *ast.Node) {
	switch loop.Kind {
	case ast.KindDoStatement:
		loop.AsDoStatement().Statement = body
	case ast.KindWhileStatement:
		loop.AsWhileStatement().Statement = body
	case ast.KindForStatement:
		loop.AsForStatement().Statement = body
	case ast.KindForInStatement, ast.KindForOfStatement:
		loop.AsForInOrOfStatement().Statement = body
	}
}

// lowerIn lowers the do expressions of n's own statements, its children's
// already lowered.
func (l *doLowering) lowerIn(n *ast.Node) {
	switch n.Kind {
	case ast.KindBlock:
		n.AsBlock().Statements.Nodes = l.statements(n.AsBlock().Statements.Nodes)
	case ast.KindModuleBlock:
		n.AsModuleBlock().Statements.Nodes = l.statements(n.AsModuleBlock().Statements.Nodes)
	case ast.KindCaseClause, ast.KindDefaultClause:
		n.AsCaseOrDefaultClause().Statements.Nodes = l.statements(n.AsCaseOrDefaultClause().Statements.Nodes)
	case ast.KindIfStatement:
		ifStatement := n.AsIfStatement()
		ifStatement.ThenStatement = l.slot(ifStatement.ThenStatement)
		if ifStatement.ElseStatement != nil {
			ifStatement.ElseStatement = l.slot(ifStatement.ElseStatement)
		}
	case ast.KindDoStatement, ast.KindWhileStatement, ast.KindForStatement, ast.KindForInStatement, ast.KindForOfStatement:
		setStatement(n, l.slot(n.Statement()))
	case ast.KindLabeledStatement:
		// lowered with the statement list that holds it
		return
	case ast.KindArrowFunction:
		body := n.Body()
		if body.Kind == ast.KindBlock || !l.marked[body] {
			return
		}
		returned := l.p.vibelangSpanning(l.p.factory.NewReturnStatement(body), body.Loc)
		pre, s := l.lift(returned)
		n.AsArrowFunction().Body = l.p.mBlock(append(pre, s), body.Loc)
	default:
		return
	}
	l.p.overrideParentInImmediateChildren(n)
}

func (l *doLowering) statements(list []*ast.Node) []*ast.Node {
	var out []*ast.Node
	changed := false
	for _, s := range list {
		pre, lowered := l.lift(s)
		if len(pre) != 0 || lowered != s {
			changed = true
		}
		out = append(append(out, pre...), lowered)
	}
	if !changed {
		return list
	}
	return out
}

func (l *doLowering) slot(s *ast.Node) *ast.Node {
	pre, lowered := l.lift(s)
	if len(pre) == 0 {
		return lowered
	}
	return l.p.mBlock(append(pre, lowered), s.Loc)
}

// lift lowers the do expressions of statement s's own expressions: it
// returns the statements that run first and the statement that takes s's
// place.
func (l *doLowering) lift(s *ast.Node) ([]*ast.Node, *ast.Node) {
	var pre []*ast.Node
	switch s.Kind {
	case ast.KindExpressionStatement:
		e := s.AsExpressionStatement()
		e.Expression = l.expr(e.Expression, &pre)
	case ast.KindReturnStatement:
		if r := s.AsReturnStatement(); r.Expression != nil {
			r.Expression = l.expr(r.Expression, &pre)
		}
	case ast.KindThrowStatement:
		t := s.AsThrowStatement()
		t.Expression = l.expr(t.Expression, &pre)
	case ast.KindExportAssignment:
		e := s.AsExportAssignment()
		e.Expression = l.expr(e.Expression, &pre)
	case ast.KindIfStatement:
		i := s.AsIfStatement()
		i.Expression = l.expr(i.Expression, &pre)
	case ast.KindSwitchStatement:
		w := s.AsSwitchStatement()
		w.Expression = l.expr(w.Expression, &pre)
	case ast.KindForInStatement, ast.KindForOfStatement:
		f := s.AsForInOrOfStatement()
		f.Expression = l.expr(f.Expression, &pre)
	case ast.KindVariableStatement:
		s = l.variableStatement(s, &pre)
	case ast.KindForStatement:
		f := s.AsForStatement()
		if init := f.Initializer; init != nil {
			if init.Kind == ast.KindVariableDeclarationList {
				l.declarations(init, &pre)
			} else {
				f.Initializer = l.expr(init, &pre)
			}
		}
	case ast.KindWhileStatement:
		w := s.AsWhileStatement()
		if !l.marked[w.Expression] {
			return nil, s
		}
		// while (c) body is for (;;) { pre; if (!c) break; body }, so the
		// do expression runs before each test.
		var inner []*ast.Node
		condition := l.expr(w.Expression, &inner)
		at := l.p.skipRangeTrivia(w.Expression.Loc)
		not := l.p.vibelangSpanning(l.p.factory.NewPrefixUnaryExpression(ast.KindExclamationToken, l.p.mParens(condition, condition.Loc)), condition.Loc)
		exit := l.p.vibelangSpanning(l.p.factory.NewIfStatement(not, l.p.vibelangSpanning(l.p.factory.NewBreakStatement(nil), at), nil), at)
		body := l.p.mBlock(append(append(inner, exit), w.Statement), w.Statement.Loc)
		loop := l.p.vibelangSpanning(l.p.factory.NewForStatement(nil, nil, nil, body), s.Loc)
		return nil, loop
	case ast.KindLabeledStatement:
		labeled := s.AsLabeledStatement()
		inner, statement := l.lift(labeled.Statement)
		if len(inner) != 0 && !isLoopChain(statement) {
			statement = l.p.mBlock(append(inner, statement), labeled.Statement.Loc)
			inner = nil
		}
		labeled.Statement = statement
		l.p.overrideParentInImmediateChildren(s)
		return inner, s
	default:
		return nil, s
	}
	if len(pre) != 0 {
		l.p.overrideParentInImmediateChildren(s)
	}
	return pre, s
}

func isLoopChain(s *ast.Node) bool {
	for s.Kind == ast.KindLabeledStatement {
		s = s.AsLabeledStatement().Statement
	}
	return ast.IsIterationStatement(s, false)
}

// variableStatement completes each earlier binding before lifting a later
// initializer. Saving only the earlier initializer would run the later do
// before BindingInitialization, turning a valid read into a TDZ failure.
func (l *doLowering) variableStatement(statement *ast.Node, pre *[]*ast.Node) *ast.Node {
	list := statement.AsVariableStatement().DeclarationList
	declarations := list.AsVariableDeclarationList().Declarations.Nodes
	last := -1
	for i, declaration := range declarations {
		if init := declaration.Initializer(); init != nil && l.marked[init] {
			last = i
		}
	}
	if last < 0 {
		return statement
	}
	group := func(declarations []*ast.Node, at core.TextRange) *ast.Node {
		var kinds []ast.Kind
		for _, modifier := range statement.ModifierNodes() {
			kinds = append(kinds, modifier.Kind)
		}
		modifiers := l.p.vibelangModifiers(nil, declarations[0].Name(), kinds...)
		// NodeList.End encodes a trailing comma. It must stop before the
		// statement semicolon, while retaining any real source trailing comma.
		end := declarations[len(declarations)-1].End()
		original := list.AsVariableDeclarationList().Declarations
		if declarations[len(declarations)-1] == original.Nodes[len(original.Nodes)-1] {
			end = original.End()
		}
		items := l.p.newNodeList(core.NewTextRange(declarations[0].Pos(), end), declarations)
		declarationList := l.p.vibelangSpanning(l.p.factory.NewVariableDeclarationList(items, list.Flags), at)
		return l.p.vibelangSpanning(l.p.factory.NewVariableStatement(modifiers, declarationList), at)
	}
	for i := 0; i <= last; i++ {
		declaration := declarations[i]
		if init := declaration.Initializer(); init != nil {
			declaration.AsVariableDeclaration().Initializer = l.expr(init, pre)
			l.p.overrideParentInImmediateChildren(declaration)
		}
		if i < last {
			at := declaration.Loc
			if i == 0 {
				at = core.NewTextRange(statement.Pos(), declaration.End())
			}
			*pre = append(*pre, group([]*ast.Node{declaration}, at))
		}
	}
	if last == 0 {
		return statement
	}
	return group(declarations[last:], core.NewTextRange(declarations[last].Pos(), statement.End()))
}

// declarations lowers a declaration list's initializers in order: an
// initializer before the last one that holds a do expression is read into a
// constant first.
func (l *doLowering) declarations(list *ast.Node, pre *[]*ast.Node) {
	declarations := list.AsVariableDeclarationList().Declarations.Nodes
	last := -1
	for i, d := range declarations {
		if init := d.Initializer(); init != nil && l.marked[init] {
			last = i
		}
	}
	for i := 0; i <= last; i++ {
		d := declarations[i].AsVariableDeclaration()
		if d.Initializer == nil {
			continue
		}
		d.Initializer = l.expr(d.Initializer, pre)
		if i < last {
			d.Initializer = l.spill(d.Initializer, pre)
		}
		l.p.overrideParentInImmediateChildren(declarations[i])
	}
}

// expr lowers the do expressions in e, appending what runs first to pre,
// and returns what takes e's place.
func (l *doLowering) expr(e *ast.Node, pre *[]*ast.Node) *ast.Node {
	if e == nil || !l.marked[e] {
		return e
	}
	if d := l.p.vibelangDos[e]; d != nil && d.lifted {
		let := l.letStatement(l.ref(d.name, d.keyword), d.keyword)
		*pre = append(*pre, let, d.block)
		at := l.p.sourceRange(e)
		if e.Flags&ast.NodeFlagsVibeLangTry == 0 {
			ref := l.ref(d.name, at)
			l.p.completionSite(let, ref)
			return ref
		}
		// try do { … } (VIP-5): the parser flagged the do's call and widened
		// it to start at try. The reference starts at do, after its let, and
		// $try runs the value, as try runs any operand that is not a call.
		ref := l.ref(d.name, core.NewTextRange(d.keyword.Pos(), at.End()))
		l.p.completionSite(let, ref)
		callee := l.p.vibelangIntrinsic("$try", core.NewTextRange(at.Pos(), at.Pos()+len("try")))
		return l.p.vibelangSpanning(l.p.factory.NewCallExpression(callee, nil, nil, l.p.newNodeList(ref.Loc, []*ast.Node{ref}), ast.NodeFlagsNone), at)
	}
	switch e.Kind {
	case ast.KindParenthesizedExpression, ast.KindAsExpression, ast.KindSatisfiesExpression, ast.KindNonNullExpression,
		ast.KindTypeAssertionExpression, ast.KindTypeOfExpression, ast.KindVoidExpression, ast.KindDeleteExpression,
		ast.KindAwaitExpression, ast.KindYieldExpression, ast.KindSpreadElement, ast.KindSpreadAssignment,
		ast.KindPropertyAccessExpression, ast.KindTemplateSpan, ast.KindComputedPropertyName:
		setExpression(e, l.expr(e.Expression(), pre))
	case ast.KindPrefixUnaryExpression:
		u := e.AsPrefixUnaryExpression()
		u.Operand = l.expr(u.Operand, pre)
	case ast.KindPostfixUnaryExpression:
		u := e.AsPostfixUnaryExpression()
		u.Operand = l.expr(u.Operand, pre)
	case ast.KindElementAccessExpression:
		a := e.AsElementAccessExpression()
		parts := l.ordered(pre, a.Expression, a.ArgumentExpression)
		a.Expression, a.ArgumentExpression = parts[0], parts[1]
	case ast.KindCallExpression:
		c := e.AsCallExpression()
		if isIntrinsicCall(e) != "" {
			// Parser intrinsics are syntax, not runtime callee reads.
			c.Arguments.Nodes = l.ordered(pre, c.Arguments.Nodes...)
			l.p.overrideParentInImmediateChildren(e)
			return e
		}
		// Capture a method's value before evaluating arguments, preserving
		// both getter order and its receiver (VIP-2 expression lowering):
		// e.m(do { … }) is const f = e.m.bind(e); …; f(…). bind keeps the
		// method's type, generics included, for the checker.
		later := false
		for _, argument := range c.Arguments.Nodes {
			later = later || l.marked[argument]
		}
		callee := ast.SkipParentheses(c.Expression)
		if later && (callee.Kind == ast.KindPropertyAccessExpression || callee.Kind == ast.KindElementAccessExpression) {
			at := l.p.sourceRange(e)
			this := func() *ast.Node {
				return l.p.vibelangSynthesized(l.p.factory.NewKeywordExpression(ast.KindThisKeyword), at)
			}
			// receiver returns the object the callee reads and the bound this.
			receiver := func(object *ast.Node) (*ast.Node, *ast.Node) {
				if object.Kind == ast.KindSuperKeyword || object.Kind == ast.KindThisKeyword {
					return object, this()
				}
				name := l.temp("$do_t", at)
				value := l.expr(object, pre)
				*pre = append(*pre, l.p.mConst(name, ast.NodeFlagsConst, value, at))
				return l.ref(name, at), l.ref(name, at)
			}
			var bound *ast.Node
			if callee.Kind == ast.KindPropertyAccessExpression {
				access := callee.AsPropertyAccessExpression()
				access.Expression, bound = receiver(access.Expression)
			} else {
				access := callee.AsElementAccessExpression()
				access.Expression, bound = receiver(access.Expression)
				access.ArgumentExpression = l.expr(access.ArgumentExpression, pre)
			}
			l.p.overrideParentInImmediateChildren(callee)
			c.Expression = l.spill(l.p.mCall(l.p.mProperty(callee, "bind", at), []*ast.Node{bound}, at), pre)
			c.Arguments.Nodes = l.ordered(pre, c.Arguments.Nodes...)
			break
		}
		c.Expression = l.callee(c.Expression, c.Arguments.Nodes, pre)
		c.Arguments.Nodes = l.ordered(pre, c.Arguments.Nodes...)
	case ast.KindNewExpression:
		c := e.AsNewExpression()
		var arguments []*ast.Node
		if c.Arguments != nil {
			arguments = c.Arguments.Nodes
		}
		c.Expression = l.callee(c.Expression, arguments, pre)
		if c.Arguments != nil {
			c.Arguments.Nodes = l.ordered(pre, c.Arguments.Nodes...)
		}
	case ast.KindTaggedTemplateExpression:
		t := e.AsTaggedTemplateExpression()
		t.Tag = l.callee(t.Tag, []*ast.Node{t.Template}, pre)
		t.Template = l.expr(t.Template, pre)
	case ast.KindTemplateExpression:
		spans := e.AsTemplateExpression().TemplateSpans.Nodes
		expressions := make([]*ast.Node, len(spans))
		for i, span := range spans {
			expressions[i] = span.Expression()
			l.marked[expressions[i]] = l.marked[expressions[i]] || l.marked[span]
		}
		for i, x := range l.ordered(pre, expressions...) {
			spans[i].AsTemplateSpan().Expression = x
			l.p.overrideParentInImmediateChildren(spans[i])
		}
	case ast.KindArrayLiteralExpression:
		a := e.AsArrayLiteralExpression()
		a.Elements.Nodes = l.ordered(pre, a.Elements.Nodes...)
	case ast.KindObjectLiteralExpression:
		o := e.AsObjectLiteralExpression()
		l.properties(o.Properties.Nodes, pre)
	case ast.KindPropertyAssignment:
		a := e.AsPropertyAssignment()
		a.Initializer = l.expr(a.Initializer, pre)
	case ast.KindConditionalExpression:
		return l.conditional(e, pre)
	case ast.KindBinaryExpression:
		return l.binary(e, pre)
	}
	l.p.overrideParentInImmediateChildren(e)
	return e
}

func setExpression(e, x *ast.Node) {
	switch e.Kind {
	case ast.KindParenthesizedExpression:
		e.AsParenthesizedExpression().Expression = x
	case ast.KindAsExpression:
		e.AsAsExpression().Expression = x
	case ast.KindSatisfiesExpression:
		e.AsSatisfiesExpression().Expression = x
	case ast.KindNonNullExpression:
		e.AsNonNullExpression().Expression = x
	case ast.KindTypeAssertionExpression:
		e.AsTypeAssertion().Expression = x
	case ast.KindTypeOfExpression:
		e.AsTypeOfExpression().Expression = x
	case ast.KindVoidExpression:
		e.AsVoidExpression().Expression = x
	case ast.KindDeleteExpression:
		e.AsDeleteExpression().Expression = x
	case ast.KindAwaitExpression:
		e.AsAwaitExpression().Expression = x
	case ast.KindYieldExpression:
		e.AsYieldExpression().Expression = x
	case ast.KindSpreadElement:
		e.AsSpreadElement().Expression = x
	case ast.KindSpreadAssignment:
		e.AsSpreadAssignment().Expression = x
	case ast.KindPropertyAccessExpression:
		e.AsPropertyAccessExpression().Expression = x
	case ast.KindTemplateSpan:
		e.AsTemplateSpan().Expression = x
	case ast.KindComputedPropertyName:
		e.AsComputedPropertyName().Expression = x
	}
}

// ordered lowers parts, which run in order: each part before the last one
// that holds a do expression is read into a constant first, unless reading
// it has no effect.
func (l *doLowering) ordered(pre *[]*ast.Node, parts ...*ast.Node) []*ast.Node {
	last := -1
	for i, part := range parts {
		if part != nil && l.marked[part] {
			last = i
		}
	}
	out := append([]*ast.Node{}, parts...)
	for i := 0; i <= last; i++ {
		out[i] = l.expr(parts[i], pre)
		if i < last {
			out[i] = l.spill(out[i], pre)
		}
	}
	return out
}

// properties lowers an object literal's properties in order.
func (l *doLowering) properties(properties []*ast.Node, pre *[]*ast.Node) {
	last := -1
	for i, property := range properties {
		if l.marked[property] {
			last = i
		}
	}
	for i := 0; i <= last; i++ {
		property := properties[i]
		switch property.Kind {
		case ast.KindPropertyAssignment:
			a := property.AsPropertyAssignment()
			if name := a.Name(); name.Kind == ast.KindComputedPropertyName {
				computed := name.AsComputedPropertyName()
				computed.Expression = l.expr(computed.Expression, pre)
				if l.marked[a.Initializer] || i < last {
					computed.Expression = l.spill(computed.Expression, pre)
				}
				l.p.overrideParentInImmediateChildren(name)
			}
			a.Initializer = l.expr(a.Initializer, pre)
			if i < last {
				a.Initializer = l.spill(a.Initializer, pre)
			}
		case ast.KindShorthandPropertyAssignment:
			if i < last {
				name := property.Name()
				value := l.spill(l.p.mIdent(name.Text(), name.Loc), pre)
				property = l.p.vibelangSpanning(l.p.factory.NewPropertyAssignment(nil, name, nil, nil, value), property.Loc)
				properties[i] = property
			}
		case ast.KindSpreadAssignment:
			a := property.AsSpreadAssignment()
			a.Expression = l.expr(a.Expression, pre)
			if i < last {
				a.Expression = l.spill(a.Expression, pre)
			}
		}
		l.p.overrideParentInImmediateChildren(property)
	}
}

// callee lowers a call's callee, read before its arguments: when an
// argument holds a do expression, a receiver or callee that may have effects
// is read into a constant first, and the call keeps its receiver.
func (l *doLowering) callee(callee *ast.Node, arguments []*ast.Node, pre *[]*ast.Node) *ast.Node {
	if ast.SkipParentheses(callee).Kind == ast.KindSuperKeyword {
		return callee // super(...) is syntax and cannot be captured as a value.
	}
	callee = l.expr(callee, pre)
	later := false
	for _, a := range arguments {
		later = later || l.marked[a]
	}
	if !later || isPureRead(callee) {
		return callee
	}
	switch callee.Kind {
	case ast.KindPropertyAccessExpression:
		access := callee.AsPropertyAccessExpression()
		access.Expression = l.spill(access.Expression, pre)
		l.p.overrideParentInImmediateChildren(callee)
		return callee
	case ast.KindElementAccessExpression:
		access := callee.AsElementAccessExpression()
		access.Expression = l.spill(access.Expression, pre)
		access.ArgumentExpression = l.spill(access.ArgumentExpression, pre)
		l.p.overrideParentInImmediateChildren(callee)
		return callee
	}
	return l.spill(callee, pre)
}

// conditional lowers c ? a : b whose branch holds a do expression to an if
// that assigns a temporary.
func (l *doLowering) conditional(e *ast.Node, pre *[]*ast.Node) *ast.Node {
	c := e.AsConditionalExpression()
	c.Condition = l.expr(c.Condition, pre)
	if !l.marked[c.WhenTrue] && !l.marked[c.WhenFalse] {
		l.p.overrideParentInImmediateChildren(e)
		return e
	}
	at := l.p.skipRangeTrivia(e.Loc)
	name := l.temp("$do_v", at)
	branch := func(x *ast.Node) *ast.Node {
		var inner []*ast.Node
		value := l.expr(x, &inner)
		return l.p.mBlock(append(inner, l.statement(l.assign(l.ref(name, x.Loc), value, x.Loc), x.Loc)), x.Loc)
	}
	*pre = append(*pre, l.letStatement(name, at), l.p.vibelangSpanning(l.p.factory.NewIfStatement(c.Condition, branch(c.WhenTrue), branch(c.WhenFalse)), e.Loc))
	return l.ref(name, l.p.sourceRange(e))
}

// binary lowers a binary expression. Its left side runs first; a logical
// operator or logical assignment whose right side holds a do expression
// becomes an if, and a compound assignment x op= e reads x first.
func (l *doLowering) binary(e *ast.Node, pre *[]*ast.Node) *ast.Node {
	b := e.AsBinaryExpression()
	operator := b.OperatorToken.Kind
	if !l.marked[b.Right] {
		b.Left = l.expr(b.Left, pre)
		l.p.overrideParentInImmediateChildren(e)
		return e
	}
	at := l.p.skipRangeTrivia(e.Loc)
	switch {
	case operator == ast.KindCommaToken:
		left := l.expr(b.Left, pre)
		*pre = append(*pre, l.statement(left, left.Loc))
		return l.expr(b.Right, pre)
	case operator == ast.KindAmpersandAmpersandToken || operator == ast.KindBarBarToken || operator == ast.KindQuestionQuestionToken:
		name := l.temp("$do_v", at)
		left := l.expr(b.Left, pre)
		*pre = append(*pre, l.letStatement(name, at), l.statement(l.assign(l.ref(name, left.Loc), left, left.Loc), left.Loc))
		var inner []*ast.Node
		right := l.expr(b.Right, &inner)
		inner = append(inner, l.statement(l.assign(l.ref(name, b.Right.Loc), right, b.Right.Loc), b.Right.Loc))
		*pre = append(*pre, l.p.vibelangSpanning(l.p.factory.NewIfStatement(l.shortCircuit(operator, l.ref(name, at), at), l.p.mBlock(inner, b.Right.Loc), nil), e.Loc))
		return l.ref(name, l.p.sourceRange(e))
	case ast.IsLogicalOrCoalescingAssignmentOperator(operator):
		// x ||= e: x is an identifier (doSite).
		target := ast.SkipParentheses(b.Left)
		var inner []*ast.Node
		right := l.expr(b.Right, &inner)
		inner = append(inner, l.statement(l.assign(l.p.mIdent(target.Text(), target.Loc), right, b.Right.Loc), b.Right.Loc))
		var test ast.Kind
		switch operator {
		case ast.KindAmpersandAmpersandEqualsToken:
			test = ast.KindAmpersandAmpersandToken
		case ast.KindBarBarEqualsToken:
			test = ast.KindBarBarToken
		default:
			test = ast.KindQuestionQuestionToken
		}
		*pre = append(*pre, l.p.vibelangSpanning(l.p.factory.NewIfStatement(l.shortCircuit(test, l.p.mIdent(target.Text(), at), at), l.p.mBlock(inner, b.Right.Loc), nil), e.Loc))
		return l.p.mIdent(target.Text(), l.p.sourceRange(e))
	case ast.IsCompoundAssignmentOperator(operator):
		// x op= e: x is an identifier (doSite), read before e.
		target := ast.SkipParentheses(b.Left)
		old := l.temp("$do_t", at)
		*pre = append(*pre, l.p.mConst(old, ast.NodeFlagsConst, l.p.mIdent(target.Text(), target.Loc), target.Loc))
		right := l.expr(b.Right, pre)
		b.OperatorToken = l.p.mToken(ast.KindEqualsToken, b.OperatorToken.Loc)
		b.Right = l.p.mBinary(l.ref(old, at), compoundOperator(operator), l.p.mParens(right, right.Loc), b.Right.Loc)
		l.p.overrideParentInImmediateChildren(e)
		return e
	case operator == ast.KindEqualsToken:
		// The target's object and key run before the value; a destructuring
		// target's parts run after it.
		switch left := ast.SkipParentheses(b.Left); left.Kind {
		case ast.KindPropertyAccessExpression:
			access := left.AsPropertyAccessExpression()
			access.Expression = l.spill(l.expr(access.Expression, pre), pre)
			l.p.overrideParentInImmediateChildren(left)
		case ast.KindElementAccessExpression:
			access := left.AsElementAccessExpression()
			parts := l.ordered(pre, access.Expression, access.ArgumentExpression)
			access.Expression, access.ArgumentExpression = l.spill(parts[0], pre), l.spill(parts[1], pre)
			l.p.overrideParentInImmediateChildren(left)
		}
		b.Right = l.expr(b.Right, pre)
	default:
		parts := l.ordered(pre, b.Left, b.Right)
		b.Left, b.Right = parts[0], parts[1]
	}
	l.p.overrideParentInImmediateChildren(e)
	return e
}

// shortCircuit returns the test under which operator evaluates its right
// side, given its left side's value v.
func (l *doLowering) shortCircuit(operator ast.Kind, v *ast.Node, at core.TextRange) *ast.Node {
	switch operator {
	case ast.KindAmpersandAmpersandToken:
		return v
	case ast.KindBarBarToken:
		return l.p.vibelangSpanning(l.p.factory.NewPrefixUnaryExpression(ast.KindExclamationToken, v), at)
	}
	return l.p.mBinary(v, ast.KindEqualsEqualsToken, l.p.mKeyword(ast.KindNullKeyword, at), at)
}

func compoundOperator(kind ast.Kind) ast.Kind {
	switch kind {
	case ast.KindPlusEqualsToken:
		return ast.KindPlusToken
	case ast.KindMinusEqualsToken:
		return ast.KindMinusToken
	case ast.KindAsteriskEqualsToken:
		return ast.KindAsteriskToken
	case ast.KindAsteriskAsteriskEqualsToken:
		return ast.KindAsteriskAsteriskToken
	case ast.KindSlashEqualsToken:
		return ast.KindSlashToken
	case ast.KindPercentEqualsToken:
		return ast.KindPercentToken
	case ast.KindLessThanLessThanEqualsToken:
		return ast.KindLessThanLessThanToken
	case ast.KindGreaterThanGreaterThanEqualsToken:
		return ast.KindGreaterThanGreaterThanToken
	case ast.KindGreaterThanGreaterThanGreaterThanEqualsToken:
		return ast.KindGreaterThanGreaterThanGreaterThanToken
	case ast.KindAmpersandEqualsToken:
		return ast.KindAmpersandToken
	case ast.KindBarEqualsToken:
		return ast.KindBarToken
	case ast.KindCaretEqualsToken:
		return ast.KindCaretToken
	}
	panic(fmt.Sprintf("not a compound assignment: %v", kind))
}

// spill reads e into a constant, unless reading it has no effect and a do
// expression that runs after it cannot tell when it ran.
func (l *doLowering) spill(e *ast.Node, pre *[]*ast.Node) *ast.Node {
	if e == nil || isPureRead(e) {
		return e
	}
	at := l.p.sourceRange(e)
	name := l.temp("$do_t", at)
	*pre = append(*pre, l.p.mConst(name, ast.NodeFlagsConst, e, at))
	return l.ref(name, at)
}

// isPureRead reports whether moving this read past arbitrary statements
// preserves its value. Names can be reassigned, and property reads can call
// getters, so neither is safe even when its syntax has no assignment.
func isPureRead(e *ast.Node) bool {
	switch e.Kind {
	case ast.KindNumericLiteral, ast.KindBigIntLiteral, ast.KindStringLiteral,
		ast.KindNoSubstitutionTemplateLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword,
		ast.KindNullKeyword, ast.KindThisKeyword:
		return true
	}
	return false
}

// mapperCompletion turns the last statement of statements into the
// statement that returns its completion value, in place, for the TS7
// mapper, which prints a do expression as (() => { …; return last })(). The
// last statements TC39 rejects are already EK0201.
func (p *Parser) mapperCompletion(statements *ast.NodeList) {
	i := len(statements.Nodes) - 1
	for i > 0 && statements.Nodes[i].Kind == ast.KindEmptyStatement {
		i--
	}
	last := statements.Nodes[i]
	if replaced := p.mapperCompletionOf(last); replaced != last {
		statements.Nodes[i] = replaced
	}
}

func (p *Parser) mapperCompletionOf(statement *ast.Node) *ast.Node {
	// Statement matches are already lowered to labeled blocks: return each
	// selected arm.
	if info := p.vibelangMatches[statement]; info != nil {
		returned := p.matchReturnStatementAt(info, statement.Loc)
		returned.Parent = statement.Parent
		return returned
	}
	switch statement.Kind {
	case ast.KindExpressionStatement:
		if isVibeLangMaskMarker(statement) {
			return statement
		}
		returned := p.factory.NewReturnStatement(statement.Expression())
		returned.Parent = statement.Parent
		return p.vibelangSpanning(returned, statement.Loc)
	case ast.KindBlock:
		if statements := statement.AsBlock().Statements; len(statements.Nodes) != 0 {
			p.mapperCompletion(statements)
			p.overrideParentInImmediateChildren(statement)
		}
	case ast.KindIfStatement:
		ifStatement := statement.AsIfStatement()
		if ifStatement.ElseStatement != nil {
			ifStatement.ThenStatement = p.mapperCompletionOf(ifStatement.ThenStatement)
			ifStatement.ElseStatement = p.mapperCompletionOf(ifStatement.ElseStatement)
			p.overrideParentInImmediateChildren(statement)
		}
	case ast.KindTryStatement:
		tryStatement := statement.AsTryStatement()
		p.mapperCompletionOf(tryStatement.TryBlock)
		if tryStatement.CatchClause != nil {
			p.mapperCompletionOf(tryStatement.CatchClause.AsCatchClause().Block)
		}
	}
	return statement
}
