package vibelang

import (
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Result.gen is eager: its body runs at the call, stops at the first yielded
// failure, and wraps a normal completion in a success. A plain function called
// in place does the same in .vibe, where function* declares a producer. A
// failure the plain form returns is a fresh one holding the same error,
// because a yielded failure's success type need not be the enclosing Result's.
func planResultGen(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || !isEffectFunction(c, call.Expression(), "Result", "gen") {
		return nil
	}
	refuse := func(why string) *formRewrite { return &formRewrite{why: "No quick fix: " + why + "."} }
	if len(call.Arguments()) != 1 || call.TypeArguments() != nil || call.QuestionDotToken() != nil {
		return refuse("Result.gen has an unusual argument list")
	}
	gen := call.Arguments()[0]
	if !ast.IsFunctionExpression(gen) || gen.BodyData().AsteriskToken == nil || gen.Name() != nil || len(gen.Parameters()) != 0 || gen.TypeParameters() != nil || gen.Type() != nil || gen.Body() == nil {
		return refuse("its generator is not an anonymous function* () { … } written in place")
	}
	block := gen.Body()
	statements := block.Statements()
	if len(statements) == 0 || !ast.IsReturnStatement(statements[len(statements)-1]) {
		return refuse("a fallthrough would change the inferred Result type")
	}
	if hasComment(file.Text()[nodeStart(file, call):nodeStart(file, block)]) || hasComment(file.Text()[block.End():call.End()]) {
		return refuse("a comment stands outside the generator body")
	}
	names := &freshNames{file: file}
	module := expressionText(file, call.Expression().Expression())
	var edits []sourceEdit
	why := ""
	index := 0
	var yielded []*checker.Type
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if why != "" {
			return true
		}
		if isFunctionBoundary(n) {
			// No yield of this generator stands in a nested function, which
			// keeps its meaning, except what an arrow reads from the generator.
			why = resultGenBoundaryProblem(n)
			return why != ""
		}
		switch n.Kind {
		case ast.KindThisKeyword, ast.KindSuperKeyword, ast.KindMetaProperty:
			why = "the generator uses this, super or new.target"
			return true
		case ast.KindIdentifier:
			if n.Text() == "arguments" {
				why = "the generator uses arguments"
				return true
			}
		case ast.KindTryStatement:
			why = "a try or finally block can observe generator short-circuiting"
			return true
		case ast.KindReturnStatement:
			value := n.Expression()
			if value == nil {
				why = "a void return would change the inferred Result type"
				return true
			}
			if ast.IsYieldExpression(value) {
				return n.ForEachChild(visit)
			}
			if containsOptionYield(value) {
				why = "a yield is nested in a return expression"
				return true
			}
			if visit(value) {
				return true
			}
			trivia := keptComments(file.Text()[nodeStart(file, n)+len("return") : nodeStart(file, value)])
			edits = append(edits, sourceEdit{nodeStart(file, n), n.End(), "return " + module + ".succeed(" + trivia + expressionText(file, value) + ");"})
			return false
		case ast.KindYieldExpression:
			// Result.gen abandons its generator at a failure. Returning from
			// the plain function would instead close every active for-of
			// iterator; an array's has no return method, so closing it does nothing.
			for region := n; region.Parent != nil && region.Parent != gen; region = region.Parent {
				if ast.IsForOfStatement(region.Parent) && region.Parent.Statement() == region && !c.IsArrayLikeType(c.GetTypeAtLocation(region.Parent.Expression())) {
					why = "a delegated failure would close an enclosing for-of iterator"
					return true
				}
			}
			y := n.AsYieldExpression()
			if y.AsteriskToken == nil || y.Expression == nil || !isResultValueType(c, c.GetTypeAtLocation(y.Expression)) || containsOptionYield(y.Expression) {
				why = "a yield does not delegate directly to a Result"
				return true
			}
			yielded = append(yielded, c.GetTypeAtLocation(y.Expression))
			if visit(y.Expression) {
				return true
			}
			operand := keptComments(file.Text()[nodeStart(file, n)+len("yield"):nodeStart(file, y.AsteriskToken)]+file.Text()[y.AsteriskToken.End():nodeStart(file, y.Expression)]) + expressionText(file, y.Expression)
			parent := n.Parent
			if ast.IsReturnStatement(parent) {
				// A success comes back holding the same value, a failure the same error.
				edits = append(edits, sourceEdit{nodeStart(file, parent), parent.End(), "return " + operand + ";"})
				return false
			}
			temp := names.freshName("$result" + strconv.Itoa(index))
			index++
			prefix := "const " + temp + " = " + operand + "; if (" + module + ".isFailure(" + temp + ")) return " + module + ".fail(" + temp + ".failure); "
			switch {
			case ast.IsVariableDeclaration(parent) && parent.Initializer() == n && ast.IsVariableDeclarationList(parent.Parent) && len(parent.Parent.AsVariableDeclarationList().Declarations.Nodes) == 1 && ast.IsVariableStatement(parent.Parent.Parent):
				statement := parent.Parent.Parent
				edits = append(edits, sourceEdit{nodeStart(file, statement), statement.End(), prefix + file.Text()[nodeStart(file, statement):nodeStart(file, n)] + temp + ".success;"})
			case ast.IsExpressionStatement(parent):
				edits = append(edits, sourceEdit{nodeStart(file, parent), parent.End(), "{ " + prefix + "}"})
			default:
				why = "a yield is nested in an expression"
				return true
			}
			return false
		}
		if isInvocation(n) && analyzerFor(c).performs(n) {
			why = "the Result generator builds an Effect whose evaluation would change in plain code"
			return true
		}
		return n.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	if why != "" {
		return refuse(why)
	}
	returns := resultGenReturnText(c, file, call, yielded)
	if returns == "" {
		return refuse("nothing says its Result type; annotate the function that holds it")
	}
	body := applyEdits(file.Text()[:block.End()], edits)[nodeStart(file, block):]
	return withImportRemovals(c, file, &formRewrite{
		edits:       []sourceEdit{{nodeStart(file, call), call.End(), "((): " + returns + " => " + body + ")()"}},
		description: "an eager plain Result body",
	})
}

// keptComments is trivia, the text between two tokens a rewrite joins, without
// its spaces when it holds no comment.
func keptComments(trivia string) string {
	if strings.TrimSpace(trivia) == "" {
		return ""
	}
	return trivia
}

// resultGenReturnText writes the type of call, a Result.gen, for the plain
// function that replaces it: its success from the call, and its failure from
// what the body yields, which the checker doesn't read from a function* in a
// .vibe file. The plain body's returns alone would infer a union of a success
// and a failure, or widen a literal the call's contextual type kept, and so
// change the declaration of an inferred export. The annotation of the function
// that returns the call says all of this when it is written. Otherwise it returns
// "" when the call's success or a yield's type isn't an alias of Result it can read.
func resultGenReturnText(c *checker.Checker, file *ast.SourceFile, call *ast.Node, yielded []*checker.Type) string {
	if annotation := resultGenWrittenReturn(call); annotation != nil {
		return nodeText(file, annotation)
	}
	success, _, ok := resultChannels(c.GetTypeAtLocation(call))
	if !ok || success.Flags()&(checker.TypeFlagsUnknown|checker.TypeFlagsAny) != 0 {
		return ""
	}
	var failures []string
	for _, t := range yielded {
		_, failure, ok := resultChannels(t)
		if !ok {
			return ""
		}
		if text := typeTextAt(c, failure, call); text != "never" && !slices.Contains(failures, text) {
			failures = append(failures, text)
		}
	}
	failure := "never"
	if len(failures) > 0 {
		failure = strings.Join(failures, " | ")
	}
	text := "Result<" + typeTextAt(c, success, call) + ", " + failure + ">"
	if strings.Contains(text, " more ...") {
		return "" // the checker shortened a long type, which no longer parses
	}
	return text
}

// resultGenWrittenReturn returns the return annotation of the function that
// returns call, a Result.gen, or nil.
func resultGenWrittenReturn(call *ast.Node) *ast.Node {
	parent := call.Parent
	for ast.IsParenthesizedExpression(parent) {
		parent = parent.Parent
	}
	switch {
	case ast.IsArrowFunction(parent) && parent.Body() == call:
		return parent.Type()
	case ast.IsReturnStatement(parent):
		if fn := enclosingFunction(parent); fn != nil {
			return fn.Type()
		}
	}
	return nil
}

// resultChannels returns the success and failure types of t, an alias of
// Result that names both.
func resultChannels(t *checker.Type) (success, failure *checker.Type, ok bool) {
	if t == nil || t.Alias() == nil || t.Alias().Symbol().Name() != "Result" || len(t.Alias().TypeArguments()) != 2 {
		return nil, nil, false
	}
	arguments := t.Alias().TypeArguments()
	return arguments[0], arguments[1], true
}

// resultGenBoundaryProblem says why fn, a nested function or class, can't move
// into a plain function: it is a generator of its own, or an arrow that reads
// the generator's this or arguments. It returns "" when it can.
func resultGenBoundaryProblem(fn *ast.Node) string {
	if ast.IsFunctionLike(fn) && fn.BodyData() != nil && fn.BodyData().AsteriskToken != nil {
		return "the generator holds another function*"
	}
	if fn.Kind != ast.KindArrowFunction {
		return ""
	}
	problem := ""
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		switch {
		case n.Kind == ast.KindThisKeyword || n.Kind == ast.KindSuperKeyword || n.Kind == ast.KindMetaProperty:
			problem = "the generator uses this, super or new.target"
		case n.Kind == ast.KindIdentifier && n.Text() == "arguments":
			problem = "the generator uses arguments"
		case isFunctionBoundary(n) && n.Kind != ast.KindArrowFunction:
			return false
		}
		return problem != "" || n.ForEachChild(visit)
	}
	fn.ForEachChild(visit)
	return problem
}

// isResultValueType reports whether t is effect's Result: a Success, a
// Failure, or their union, which the Result module declares.
func isResultValueType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	members := t.Distributed()
	if len(members) == 0 {
		return false
	}
	for _, member := range members {
		symbol := member.Symbol()
		if symbol == nil || len(symbol.Declarations()) == 0 || effectModuleOfFile(ast.GetSourceFileOfNode(symbol.Declarations()[0])) != "Result" {
			return false
		}
		switch symbol.Name() {
		case "Success", "Failure", "Result":
		default:
			return false
		}
	}
	return true
}
