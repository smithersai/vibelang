package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Theorems (VIP-43, Appendix F "Theorems"). The parser reads
//
//	theorem clampInRange(x: number, lo: number, hi: number) {
//	  assume(lo <= hi)
//	  const result = clamp(x, lo, hi)
//	  assert(lo <= result && result <= hi)
//	}
//
// as a function declaration flagged ast.NodeFlagsVibeLangSpec and
// ast.NodeFlagsVibeLangProof (parser/vibelang_proofs.go). The checker types
// it as a plain function that returns void, with each proof statement typed
// against its own signature. This file checks the rules the compiler owns:
// the header (4302, 4303), the body (4304 to 4307), references (4310), and,
// for every proof context, procedure calls (4308) and the verification
// expression forms (4311). proofs.go erases a theorem with the spec
// functions, and prove.go lowers it for LemmaScript.

var (
	// EK4303: a theorem header outside its form. {0} says what is wrong.
	EK4303 = message(4303, errorCategory, "A theorem's parameters are plain names with type annotations, and a theorem has no return type, but {0}. Give each parameter a plain name and a type, and remove the return type.")
	// EK4308: a procedure call in a verification expression. {0} is the procedure.
	EK4308 = message(4308, errorCategory, "{0} is a procedure, so proofs see only its ensures contract, and a verification expression can't call it here. Move the call into a const at the theorem body's top level.")
	// EK4311: an expression outside the verification expression forms. {0} names the form.
	EK4311 = message(4311, errorCategory, "{0} is outside the verification expression forms. Rewrite it with names, literals, calls, member and element accesses, !, -, *, +, comparisons, ===, !==, &&, ||, ?:, Math.floor(a / b), every and some, or move the computation into a spec function.")
)

var (
	theoremModifier = EK4302.With("A theorem can't be {0}: theorems are local to their module and erase from the emitted code. Remove it.")
	// proofDeclarationPlace is rule 4301. Appendix B keeps the number 4301
	// for an interim rule until a coordinated renumber frees it, so the
	// compiler reports the rule under 4302, the other placement rule of
	// theorem and spec function declarations, until then.
	proofDeclarationPlace = EK4302.With("{0} goes at the top level of a .vibe or .vibex module, not in a block, a function body or a namespace: it is local to its module and erases from the emitted code. Move it to the module's top level.")
	theoremReference      = EK4310.With("{0} is a theorem: it states a fact and erases from the emitted code, so nothing can reference it. Remove the reference, or call a plain function.")
	theoremStatement      = EK4305.With("A theorem body holds assume statements first, then assert statements, const declarations, if statements and blocks, and runs none of them. Use const, if and proof statements.")
	theoremLateAssume     = EK4305.With("assume is a hypothesis of the whole theorem, so it comes before every other statement, as a direct statement of the theorem body. Move it to the top of the theorem, or write the condition as an if around the assert.")
	theoremNoAssert       = EK4305.With("{0} has no assert, so it states no fact. State at least one assertion.")
)

func init() {
	for _, m := range []*Message{EK4303, EK4308, EK4311} {
		registerDiagnostic(m)
	}
}

// isTheorem reports whether node is a theorem declaration.
func isTheorem(node *ast.Node) bool {
	const flags = ast.NodeFlagsVibeLangSpec | ast.NodeFlagsVibeLangProof
	return node != nil && node.Kind == ast.KindFunctionDeclaration && node.Flags&flags == flags
}

// checkProofDeclarationPlace reports a theorem or spec function that is not
// a statement of its module's top level (rule 4301).
func checkProofDeclarationPlace(c *checker.Checker, fn *ast.Node) {
	if fn.Parent != nil && fn.Parent.Kind == ast.KindSourceFile {
		return
	}
	form := "A spec function"
	if isTheorem(fn) {
		form = "A theorem"
	}
	at := fn.Name()
	if at == nil {
		at = fn
	}
	report(c, at, proofDeclarationPlace, form)
}

// markTheoremsReferenced records a use of each module-level theorem, as the
// TypeScript projection's void T; does, so that noUnusedLocals never reports
// one (Appendix F "Names and placement").
func markTheoremsReferenced(c *checker.Checker, file *ast.SourceFile, theorems []*ast.Node) {
	for _, fn := range theorems {
		if fn.Name() != nil && fn.Parent != nil && fn.Parent.Kind == ast.KindSourceFile {
			c.ResolveName(fn.Name().Text(), file.AsNode(), ast.SymbolFlagsValue, true /*excludeGlobals*/)
		}
	}
}

// checkTheorem checks fn's header (4302, 4303) and body (4305 to 4308, 4311).
func checkTheorem(c *checker.Checker, t *transparency, fn *ast.Node) {
	checkTheoremHead(c, fn)
	body := fn.Body()
	if body == nil {
		return
	}
	state := &theoremBody{c: c}
	state.statements(body.Statements(), true /*direct*/)
	if state.asserts == 0 {
		at := fn.Name()
		if at == nil {
			at = fn
		}
		report(c, at, theoremNoAssert, at.Text())
	}
	checkProofBy(c, body)
	checkVerificationExpressions(c, t, body.Statements(), true /*theorem*/)
}

// checkTheoremHead reports EK4302 for each modifier or overload of fn, and
// EK4303 for each parameter outside x: T and for a return type.
func checkTheoremHead(c *checker.Checker, fn *ast.Node) {
	if modifiers := fn.Modifiers(); modifiers != nil {
		for _, m := range modifiers.Nodes {
			switch m.Kind {
			case ast.KindExportKeyword:
				report(c, m, theoremModifier, "exported")
			case ast.KindDeclareKeyword:
				report(c, m, theoremModifier, "declared")
			case ast.KindAsyncKeyword:
				report(c, m, theoremModifier, "async")
			}
		}
	}
	at := fn.Name()
	if at == nil {
		at = fn
	}
	if fn.Body() == nil || isOverloaded(c, fn) {
		report(c, at, theoremModifier, "overloaded")
	}
	for _, parameter := range fn.Parameters() {
		p := parameter.AsParameterDeclaration()
		name := p.Name()
		switch {
		case name != nil && ast.IsIdentifier(name) && name.Text() == "this" || name != nil && name.Kind == ast.KindThisKeyword:
			report(c, parameter, EK4303, "it has a this parameter")
		case p.DotDotDotToken != nil:
			report(c, parameter, EK4303, "this parameter is a rest parameter")
		case name == nil || !ast.IsIdentifier(name):
			report(c, parameter, EK4303, "this parameter is destructured")
		case p.QuestionToken != nil:
			report(c, parameter, EK4303, name.Text()+" is optional")
		case p.Initializer != nil:
			report(c, parameter, EK4303, name.Text()+" has a default value")
		case p.Type == nil:
			report(c, parameter, EK4303, name.Text()+" has no type annotation")
		}
	}
	if fn.Type() != nil {
		report(c, fn.Type(), EK4303, "this theorem has a return type")
	}
}

// theoremBody checks the statements of one theorem body (Appendix F "Body").
type theoremBody struct {
	c *checker.Checker
	// other is set once a statement other than a leading assume is seen.
	other bool
	// asserts counts the assert statements.
	asserts int
}

// statements checks list, the theorem body's own statements when direct is
// set, and otherwise the statements of an if or block inside it.
func (b *theoremBody) statements(list []*ast.Node, direct bool) {
	for i, statement := range list {
		b.statement(statement, direct)
		if declaration := proofConst(statement); declaration != nil && !referencedLater(b.c, declaration, list[i+1:]) {
			report(b.c, declaration.Name(), proofUnusedConst, declaration.Name().Text())
		}
	}
}

func (b *theoremBody) statement(statement *ast.Node, direct bool) {
	if name, ok := isProofStatement(statement); ok {
		call := statement.Expression()
		switch name {
		case "assume":
			if !direct || b.other {
				report(b.c, call.Expression(), theoremLateAssume)
			}
			return
		case "assert":
			b.asserts++
			if args := call.Arguments(); len(args) > 1 {
				report(b.c, args[1], EK4307)
			}
		case "ensures":
			report(b.c, call.Expression(), EK4306, name, "a function's leading proof block")
		case "decreases":
			report(b.c, call.Expression(), EK4306, name, "a function's or loop's leading proof block")
		case "invariant":
			report(b.c, call.Expression(), EK4306, name, "a while, for or for … of loop's leading proof block")
		}
		b.other = true
		return
	}
	b.other = true
	switch statement.Kind {
	case ast.KindVariableStatement:
		if proofConst(statement) == nil {
			report(b.c, statement, theoremStatement)
		}
	case ast.KindIfStatement:
		ifStatement := statement.AsIfStatement()
		b.statements([]*ast.Node{ifStatement.ThenStatement}, false /*direct*/)
		if ifStatement.ElseStatement != nil {
			b.statements([]*ast.Node{ifStatement.ElseStatement}, false /*direct*/)
		}
	case ast.KindBlock:
		// A proof block here is rule 4304, which checkProofBlock reports.
		if !isProofBlock(statement) {
			b.statements(statement.Statements(), false /*direct*/)
		}
	default:
		report(b.c, statement, theoremStatement)
	}
}

// verificationExpression is one verification expression of a proof context
// (Appendix F "Verification expressions").
type verificationExpression struct {
	node *ast.Node
	// directConst is set for the initializer of a const that is a direct
	// statement of a theorem body, the one place that may call a procedure.
	directConst bool
}

// verificationExpressions returns the verification expressions of
// statements, the statements of a proof context: the arguments of proof
// statements, the initializers of const declarations and the conditions of
// if statements, in source order. theorem is whether the context is a
// theorem body. A nested proof block holds its own.
func verificationExpressions(statements []*ast.Node, theorem bool) []verificationExpression {
	var found []verificationExpression
	var visit func(list []*ast.Node, direct bool)
	visit = func(list []*ast.Node, direct bool) {
		for _, statement := range list {
			if name, ok := isProofStatement(statement); ok {
				args := statement.Expression().Arguments()
				if len(args) == 0 {
					continue
				}
				argument := args[0]
				if name == "ensures" {
					if !isPostconditionArrow(argument) {
						continue // rule 4309
					}
					argument = argument.Body()
				}
				found = append(found, verificationExpression{node: argument})
				continue
			}
			switch statement.Kind {
			case ast.KindVariableStatement:
				if declaration := proofConst(statement); declaration != nil {
					found = append(found, verificationExpression{node: declaration.Initializer(), directConst: theorem && direct})
				}
			case ast.KindIfStatement:
				ifStatement := statement.AsIfStatement()
				found = append(found, verificationExpression{node: ifStatement.Expression})
				visit([]*ast.Node{ifStatement.ThenStatement}, false)
				if ifStatement.ElseStatement != nil {
					visit([]*ast.Node{ifStatement.ElseStatement}, false)
				}
			case ast.KindBlock:
				if !isProofBlock(statement) {
					visit(statement.Statements(), false)
				}
			}
		}
	}
	visit(statements, true)
	return found
}

// checkVerificationExpressions reports, for each verification expression of
// statements, EK4311 at each form outside the verification expression forms
// and EK4308 at each call of a procedure outside the initializer of a const
// that is a direct statement of a theorem body.
func checkVerificationExpressions(c *checker.Checker, t *transparency, statements []*ast.Node, theorem bool) {
	for _, expression := range verificationExpressions(statements, theorem) {
		checkVerificationForms(c, expression.node)
		if expression.directConst {
			continue
		}
		var visit func(n *ast.Node) bool
		visit = func(n *ast.Node) bool {
			if ast.IsCallExpression(n) && n.Flags&ast.NodeFlagsVibeLangProof == 0 {
				if callee := t.procedure(n); callee != nil {
					report(c, n.Expression(), EK4308, callee.Name().Text())
				}
			}
			return n.ForEachChild(visit)
		}
		visit(expression.node)
	}
}

// verificationOperators are the binary operators of verification
// expressions. / is allowed only as the whole argument of Math.floor.
var verificationOperators = map[ast.Kind]bool{
	ast.KindAsteriskToken: true, ast.KindPlusToken: true, ast.KindMinusToken: true,
	ast.KindLessThanToken: true, ast.KindLessThanEqualsToken: true, ast.KindGreaterThanToken: true, ast.KindGreaterThanEqualsToken: true,
	ast.KindEqualsEqualsEqualsToken: true, ast.KindExclamationEqualsEqualsToken: true,
	ast.KindAmpersandAmpersandToken: true, ast.KindBarBarToken: true,
}

// checkVerificationForms reports EK4311 at each outermost part of node that
// is not a verification expression form.
func checkVerificationForms(c *checker.Checker, node *ast.Node) {
	if node == nil {
		return
	}
	bad := func(at *ast.Node, what string) {
		report(c, at, EK4311, what)
	}
	each := func(nodes []*ast.Node) {
		for _, n := range nodes {
			checkVerificationForms(c, n)
		}
	}
	switch node.Kind {
	case ast.KindIdentifier, ast.KindBigIntLiteral, ast.KindStringLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword:
	case ast.KindNumericLiteral:
		if !isProofInteger(node) {
			bad(node, "The number "+sourceTextOf(node)+", which is not an integer of at most Number.MAX_SAFE_INTEGER,")
		}
	case ast.KindParenthesizedExpression:
		checkVerificationForms(c, node.Expression())
	case ast.KindArrayLiteralExpression:
		for _, element := range node.Elements() {
			switch element.Kind {
			case ast.KindSpreadElement:
				bad(element, "A spread element")
			case ast.KindOmittedExpression:
				bad(node, "An array literal with a hole")
			default:
				checkVerificationForms(c, element)
			}
		}
	case ast.KindObjectLiteralExpression:
		for _, property := range node.Properties() {
			switch {
			case property.Kind == ast.KindPropertyAssignment && property.Name() != nil && ast.IsIdentifier(property.Name()):
				checkVerificationForms(c, property.Initializer())
			case property.Kind == ast.KindShorthandPropertyAssignment && property.AsShorthandPropertyAssignment().ObjectAssignmentInitializer == nil:
			default:
				bad(property, "An object property other than name: value or a shorthand name")
			}
		}
	case ast.KindPropertyAccessExpression:
		if node.Flags&ast.NodeFlagsOptionalChain != 0 {
			bad(node, "Optional chaining, ?.,")
			return
		}
		if !ast.IsIdentifier(node.Name()) {
			bad(node.Name(), "A private name")
			return
		}
		checkVerificationForms(c, node.Expression())
	case ast.KindElementAccessExpression:
		if node.Flags&ast.NodeFlagsOptionalChain != 0 {
			bad(node, "Optional chaining, ?.,")
			return
		}
		checkVerificationForms(c, node.Expression())
		checkVerificationForms(c, node.AsElementAccessExpression().ArgumentExpression)
	case ast.KindCallExpression:
		checkVerificationCall(c, node)
	case ast.KindPrefixUnaryExpression:
		unary := node.AsPrefixUnaryExpression()
		if unary.Operator != ast.KindExclamationToken && unary.Operator != ast.KindMinusToken {
			bad(node, "The operator "+scanner.TokenToString(unary.Operator))
			return
		}
		checkVerificationForms(c, unary.Operand)
	case ast.KindBinaryExpression:
		binary := node.AsBinaryExpression()
		if !verificationOperators[binary.OperatorToken.Kind] {
			what := "The operator " + scanner.TokenToString(binary.OperatorToken.Kind)
			if binary.OperatorToken.Kind == ast.KindSlashToken {
				what += ", outside the whole argument of Math.floor,"
			}
			bad(binary.OperatorToken, what)
			return
		}
		checkVerificationForms(c, binary.Left)
		checkVerificationForms(c, binary.Right)
	case ast.KindConditionalExpression:
		conditional := node.AsConditionalExpression()
		each([]*ast.Node{conditional.Condition, conditional.WhenTrue, conditional.WhenFalse})
	default:
		bad(node, verificationFormName(node))
	}
}

// checkVerificationCall checks call, a call in a verification expression:
// F(E, …) without spread, where F is an identifier or member expression;
// Math.floor(A / B); and the quantifiers R.every(cb) and R.some(cb).
func checkVerificationCall(c *checker.Checker, call *ast.Node) {
	if call.Flags&ast.NodeFlagsOptionalChain != 0 {
		report(c, call, EK4311, "Optional chaining, ?.,")
		return
	}
	callee := ast.SkipParentheses(call.Expression())
	if !ast.IsIdentifier(callee) && !ast.IsPropertyAccessExpression(callee) {
		report(c, callee, EK4311, "A call whose callee is not a name or a member access")
		return
	}
	checkVerificationForms(c, callee)
	args := call.Arguments()
	if ast.IsPropertyAccessExpression(callee) && len(args) == 1 {
		method := callee.Name().Text()
		receiver := callee.Expression()
		// Math.floor(A / B), the only place / appears.
		if method == "floor" && ast.IsIdentifier(receiver) && receiver.Text() == "Math" {
			if division := ast.SkipParentheses(args[0]); ast.IsBinaryExpression(division) && division.AsBinaryExpression().OperatorToken.Kind == ast.KindSlashToken {
				checkVerificationForms(c, division.AsBinaryExpression().Left)
				checkVerificationForms(c, division.AsBinaryExpression().Right)
				return
			}
		}
		// R.every(cb) and R.some(cb), the quantifiers.
		if (method == "every" || method == "some") && args[0].Kind == ast.KindArrowFunction {
			arrow := args[0]
			switch {
			case !isQuantifierArrow(arrow):
				report(c, arrow, EK4311, "A "+method+" callback other than (x) => E or (x, i) => E, with plain names and an expression body,")
			case !isArrayTyped(c, receiver):
				report(c, receiver, EK4311, "A call of "+method+" on a value that is not an array")
			default:
				checkVerificationForms(c, arrow.Body())
			}
			return
		}
	}
	for _, arg := range args {
		if arg.Kind == ast.KindSpreadElement {
			report(c, arg, EK4311, "A spread argument")
			continue
		}
		checkVerificationForms(c, arg)
	}
}

// isQuantifierArrow reports whether node is (x) => E or (x, i) => E: an arrow
// with one or two plain identifier parameters and an expression body.
func isQuantifierArrow(node *ast.Node) bool {
	if node.Kind != ast.KindArrowFunction || node.Flags&ast.NodeFlagsVibeLangEffect != 0 || node.Modifiers() != nil {
		return false
	}
	arrow := node.AsArrowFunction()
	if arrow.TypeParameters != nil || ast.IsBlock(arrow.Body) {
		return false
	}
	parameters := arrow.Parameters.Nodes
	if len(parameters) == 0 || len(parameters) > 2 {
		return false
	}
	for _, parameter := range parameters {
		p := parameter.AsParameterDeclaration()
		if !ast.IsIdentifier(p.Name()) || p.Initializer != nil || p.DotDotDotToken != nil || p.QuestionToken != nil {
			return false
		}
	}
	return true
}

// isArrayTyped reports whether node's type is an array or tuple type.
func isArrayTyped(c *checker.Checker, node *ast.Node) bool {
	t := c.GetTypeAtLocation(node)
	return t != nil && c.IsArrayLikeType(t)
}

// isProofInteger reports whether node, a numeric literal, is an integer of
// magnitude at most Number.MAX_SAFE_INTEGER (Appendix F "Numbers"). The
// parser stores a numeric literal's text as its value's shortest decimal
// form.
func isProofInteger(node *ast.Node) bool {
	value, err := strconv.ParseFloat(node.Text(), 64)
	const maxSafeInteger = 9007199254740991
	return err == nil && value >= 0 && value <= maxSafeInteger && value == float64(int64(value))
}

// sourceTextOf is node's source text.
func sourceTextOf(node *ast.Node) string {
	file := ast.GetSourceFileOfNode(node)
	return file.Text()[scanner.SkipTrivia(file.Text(), node.Pos()):node.End()]
}

// verificationFormName names node, a form no verification expression holds,
// for EK4311.
func verificationFormName(node *ast.Node) string {
	switch node.Kind {
	case ast.KindNullKeyword:
		return "null"
	case ast.KindThisKeyword:
		return "this"
	case ast.KindTemplateExpression, ast.KindNoSubstitutionTemplateLiteral, ast.KindTaggedTemplateExpression:
		return "A template literal"
	case ast.KindTypeOfExpression:
		return "typeof"
	case ast.KindAsExpression, ast.KindTypeAssertionExpression:
		return "A type assertion"
	case ast.KindSatisfiesExpression:
		return "satisfies"
	case ast.KindNonNullExpression:
		return "The non-null !"
	case ast.KindNewExpression:
		return "new"
	case ast.KindArrowFunction, ast.KindFunctionExpression:
		return "An arrow or function expression outside an every or some callback"
	case ast.KindPostfixUnaryExpression:
		return "The operator " + scanner.TokenToString(node.AsPostfixUnaryExpression().Operator)
	case ast.KindAwaitExpression:
		return "await"
	case ast.KindRegularExpressionLiteral:
		return "A regular expression"
	}
	text := sourceTextOf(node)
	if line, _, cut := strings.Cut(text, "\n"); cut {
		text = line + " …"
	}
	if runes := []rune(text); len(runes) > 40 {
		text = string(runes[:40]) + "…"
	}
	return "The expression " + text
}
