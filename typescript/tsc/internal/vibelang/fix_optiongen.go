package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// Option.gen is eager: its body runs at the call, short-circuits at None,
// and wraps a normal completion in a fresh Some. A plain IIFE preserves that
// boundary. Only statement-position delegated yields are split; arbitrary
// expression yields, iterator protocols and finally need a different rewrite.
func planOptionGen(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if !ast.IsCallExpression(call) || !isEffectFunction(c, call.Expression(), "Option", "gen") {
		return nil
	}
	refuse := func(why string) *formRewrite { return &formRewrite{why: "No quick fix: " + why + "."} }
	if len(call.Arguments()) != 1 || call.TypeArguments() != nil || call.QuestionDotToken() != nil {
		return refuse("Option.gen has an unusual argument list")
	}
	gen := call.Arguments()[0]
	if !ast.IsFunctionExpression(gen) || gen.BodyData().AsteriskToken == nil || gen.Name() != nil || len(gen.Parameters()) != 0 || gen.Type() != nil || gen.TypeParameters() != nil || ast.GetFunctionFlags(gen)&ast.FunctionFlagsAsync != 0 {
		return refuse("its generator is not an anonymous function* () { … } written in place")
	}
	block := gen.Body()
	if block == nil {
		return nil
	}
	if len(block.Statements()) == 0 || !ast.IsReturnStatement(block.Statements()[len(block.Statements())-1]) || block.Statements()[len(block.Statements())-1].Expression() == nil {
		return refuse("a fallthrough or void return would change the inferred Option type")
	}
	if hasComment(file.Text()[nodeStart(file, call):nodeStart(file, block)]) || hasComment(file.Text()[block.End():call.End()]) {
		return refuse("a comment stands outside the generator body")
	}
	names := &freshNames{file: file}
	var edits []sourceEdit
	why := ""
	index := 0
	option := expressionText(file, call.Expression().Expression())
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if why != "" {
			return true
		}
		if isFunctionBoundary(n) {
			why = "the generator contains a nested function boundary"
			return true
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
			// A return yield is handled as a delegated yield below.
			value := n.Expression()
			if value != nil && ast.IsYieldExpression(ast.SkipParentheses(value)) {
				return n.ForEachChild(visit)
			}
			if value == nil {
				why = "a void return would change the inferred Option type"
				return true
			}
			if containsOptionYield(value) {
				why = "a yield is nested in a return expression"
				return true
			}
			visit(value)
			if why != "" {
				return true
			}
			trivia := file.Text()[nodeStart(file, n)+len("return") : nodeStart(file, value)]
			replacement := option + ".some(" + trivia + expressionText(file, value) + ")"
			edits = append(edits, sourceEdit{nodeStart(file, n), n.End(), "return " + replacement + ";"})
			// No yield can hide in a returned expression; reject rather than overlap edits.
			if value != nil && containsOptionYield(value) {
				why = "a yield is nested in a return expression"
			}
			return false
		case ast.KindYieldExpression:
			// Option.gen abandons its generator at None. Returning from the
			// IIFE would instead close every active for-of iterator.
			for region := n; region.Parent != nil && region.Parent != gen; region = region.Parent {
				parent := region.Parent
				if ast.IsForOfStatement(parent) && parent.Statement() == region {
					why = "a delegated None would close an enclosing for-of iterator"
					return true
				}
			}
			y := n.AsYieldExpression()
			if y.AsteriskToken == nil || y.Expression == nil || !isOptionType(c, c.GetTypeAtLocation(y.Expression)) || containsOptionYield(y.Expression) {
				why = "a yield does not delegate directly to an Option"
				return true
			}
			visit(y.Expression)
			if why != "" {
				return true
			}
			trivia := file.Text()[nodeStart(file, n)+len("yield"):nodeStart(file, y.AsteriskToken)] + file.Text()[y.AsteriskToken.End():nodeStart(file, y.Expression)]
			operand := trivia + expressionText(file, y.Expression)
			parent := n.Parent
			if ast.IsParenthesizedExpression(parent) {
				why = "a yield is nested in an expression"
				return true
			}
			temp := names.freshName("$option" + strconv.Itoa(index))
			index++
			// The early exit is a fresh None of the result type: the yielded None carries the yield's payload type, which the
			// enclosing Option type need not admit (Go test: None<{ value: number }> is not Option<number>). Effect's none() is
			// one shared value, so identity with the yielded None is kept where the original returned it.
			prefix := "const " + temp + " = " + operand + "; if (" + option + ".isNone(" + temp + ")) return " + option + ".none(); "
			switch {
			case ast.IsVariableDeclaration(parent) && parent.Initializer() == n && ast.IsVariableDeclarationList(parent.Parent) && len(parent.Parent.AsVariableDeclarationList().Declarations.Nodes) == 1 && ast.IsVariableStatement(parent.Parent.Parent) && ast.IsBlock(parent.Parent.Parent.Parent):
				statement := parent.Parent.Parent
				head := file.Text()[nodeStart(file, statement):nodeStart(file, n)]
				edits = append(edits, sourceEdit{nodeStart(file, statement), statement.End(), prefix + head + temp + ".value;"})
			case ast.IsExpressionStatement(parent):
				edits = append(edits, sourceEdit{nodeStart(file, parent), parent.End(), "{ " + prefix + temp + ".value; }"})
			case ast.IsReturnStatement(parent):
				edits = append(edits, sourceEdit{nodeStart(file, parent), parent.End(), "{ " + prefix + file.Text()[nodeStart(file, parent)+len("return"):nodeStart(file, n)] + "return " + option + ".some(" + temp + ".value); }"})
			default:
				why = "a yield is nested in an expression"
			}
			return false
		}
		if isInvocation(n) && analyzerFor(c).performs(n) {
			why = "the Option generator builds an Effect whose evaluation would change in plain code"
			return true
		}
		return n.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	if why != "" {
		return refuse(why)
	}
	start := nodeStart(file, block)
	end := block.End()
	body := applyEdits(file.Text()[:end], edits)[start:]
	replacement := "((): infer _ => " + body + ")()"
	return withImportRemovals(c, file, &formRewrite{
		edits:       []sourceEdit{{nodeStart(file, call), call.End(), replacement}},
		description: "an eager plain Option body",
	})
}

func containsOptionYield(n *ast.Node) bool {
	found := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if ast.IsYieldExpression(node) {
			found = true
			return true
		}
		return node.ForEachChild(visit)
	}
	visit(n)
	return found
}
