package vibelangmapper

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// syntaxDiagnostic uses the native EK node range without importing its checker.
func (p *projector) syntaxDiagnostic(node *ast.Node, code int32, message string) {
	r := scanner.GetErrorRangeForNode(p.file, node)
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: r.Pos(), Length: r.Len(), Code: code, Message: message})
}

// inAsyncFunction reports whether node is in the body of an async function,
// whose code is TypeScript (VIP-1).
func inAsyncFunction(node *ast.Node) bool {
	fn := ast.GetContainingFunction(node)
	return fn != nil && ast.GetFunctionFlags(fn)&ast.FunctionFlagsAsync != 0
}

// syntaxToken matches keyword diagnostics such as EK1003 and EK2006.
func (p *projector) syntaxToken(node *ast.Node, code int32, message string) {
	r := scanner.GetRangeOfTokenAtPosition(p.file, node.Pos())
	p.diagnostics = append(p.diagnostics, Diagnostic{Start: r.Pos(), Length: r.Len(), Code: code, Message: message})
}

// checkSyntaxDiagnostics mirrors EK1003 (for await and await using outside an
// async function), EK1010, D15's finally exits
// (EK2006), D1's bodiless service contracts (EK2101), D129's setup order
// (EK2104), and D229's lexical hatch captures (EK4405). Alias/type identity
// and unresolved types remain native. A type argument left out of an Effect
// type means what it means in TypeScript (D308, D309), so Effect<A> is complete.
func (p *projector) checkSyntaxDiagnostics() {
	p.checkThrowExpressionPrecedence()
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if p.isHatchCall(n) {
			p.checkHatchCaptures(n)
			// D232: only the first argument is TypeScript; mapper and inputs are VibeLang.
			for _, arg := range n.Arguments()[min(1, len(n.Arguments())):] {
				visit(arg)
			}
			return false
		}
		if fn := ast.GetContainingFunction(n); fn != nil &&
			!ast.IsFunctionLike(n) && !ast.IsClassLike(n) && n.Kind != ast.KindClassStaticBlockDeclaration &&
			ast.GetFunctionFlags(fn)&ast.FunctionFlagsGenerator != 0 && HasJavaScriptIteratorReturn(fn) {
			// D271 keeps this generator's await syntax as JavaScript. Nested
			// function boundaries continue to own their VibeLang rules.
			n.ForEachChild(visit)
			return false
		}
		switch n.Kind {
		case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
			if ast.GetFunctionFlags(n)&ast.FunctionFlagsGenerator != 0 && HasJavaScriptIteratorReturn(n) {
				p.checkPlainGeneratorThrows(n) // D296 (plain_contract_effects.go)
				break                          // D271 permits an explicitly JavaScript async generator.
			}
			// An async function means what it means in TypeScript (VIP-1).
		case ast.KindForOfStatement:
			if a := n.AsForInOrOfStatement().AwaitModifier; a != nil && !inAsyncFunction(n) {
				p.syntaxDiagnostic(a, 1003, "for await is not part of VibeLang: a call already waits.")
			}
		case ast.KindVariableDeclarationList:
			flags := n.Flags & ast.NodeFlagsBlockScoped
			if flags == ast.NodeFlagsAwaitUsing && !inAsyncFunction(n) {
				p.syntaxToken(n, 1003, "await using is not part of VibeLang: a call already waits.")
			}
		case ast.KindTryStatement:
			if block := n.AsTryStatement().FinallyBlock; block != nil && syntaxInLowerableBody(n) {
				p.checkFinallyExits(block)
			}
		}
		if isServiceClass(n) {
			p.checkServiceContracts(n)
		}
		if n.Parent == p.file.AsNode() && isLayerDeclaration(n) {
			p.checkLayerSetup(n)
		}
		n.ForEachChild(visit)
		return false
	}
	p.file.AsNode().ForEachChild(visit)
}

// syntaxLowerable follows the native body/async/generator gate (EK2003).
func syntaxLowerable(n *ast.Node) bool {
	switch n.Kind {
	case ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindArrowFunction, ast.KindMethodDeclaration:
	default:
		return false
	}
	flags := ast.GetFunctionFlags(n)
	return n.Body() != nil && flags&ast.FunctionFlagsAsync == 0 && (flags&ast.FunctionFlagsGenerator == 0 || isProducer(n))
}

// syntaxInLowerableBody keeps EK2006 inside the native function boundary.
func syntaxInLowerableBody(n *ast.Node) bool {
	for n.Parent != nil {
		parent := n.Parent
		if ast.IsFunctionLike(parent) || ast.IsClassLike(parent) || parent.Kind == ast.KindClassStaticBlockDeclaration {
			return n == parent.Body() && syntaxLowerable(parent)
		}
		n = parent
	}
	return false
}

// checkServiceContracts reports EK2101 only for absent or primitive
// contracts. An alias may already name an Effect type.
func (p *projector) checkServiceContracts(class *ast.Node) {
	for _, member := range class.Members() {
		if member.Kind != ast.KindMethodDeclaration || ast.IsStatic(member) || member.Name() == nil || !ast.IsIdentifier(member.Name()) {
			continue
		}
		annotation := member.Type()
		incomplete := annotation == nil
		if annotation != nil {
			switch annotation.Kind {
			case ast.KindStringKeyword, ast.KindNumberKeyword, ast.KindBooleanKeyword, ast.KindVoidKeyword, ast.KindNeverKeyword, ast.KindUnknownKeyword, ast.KindAnyKeyword, ast.KindObjectKeyword, ast.KindUndefinedKeyword, ast.KindNullKeyword, ast.KindBigIntKeyword, ast.KindSymbolKeyword:
				incomplete = true
			}
		}
		if incomplete {
			at := annotation
			if at == nil {
				at = member.Name()
			}
			p.syntaxDiagnostic(at, 2101, class.Name().Text()+"."+member.Name().Text()+" has no body to infer from, so its contract must be written as an Effect type.")
		}
	}
}

// checkLayerSetup uses the parser's retained source order to report EK2104.
func (p *projector) checkLayerSetup(n *ast.Node) {
	call := n.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Initializer()
	args := call.Arguments()
	if len(args) != 2 || !ast.IsArrowFunction(args[1]) || args[1].Body() == nil || !ast.IsBlock(args[1].Body()) {
		return
	}
	statements := args[1].Body().Statements()
	if len(statements) == 0 {
		return
	}
	returned := statements[len(statements)-1]
	if returned.Kind != ast.KindReturnStatement || returned.Expression() == nil || !ast.IsObjectLiteralExpression(returned.Expression()) {
		return
	}
	members := returned.Expression().AsObjectLiteralExpression().Properties.Nodes
	if len(members) == 0 {
		return
	}
	for _, setup := range statements[:len(statements)-1] {
		if setup.Pos() > members[0].Pos() {
			p.syntaxDiagnostic(setup, 2104, "This statement follows the layer's members, but a layer's setup statements come first.")
		}
	}
}

// checkFinallyExits mirrors the native region target stack (EK2006, D15).
func (p *projector) checkFinallyExits(block *ast.Node) {
	f := &frame{region: &region{}}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsFunctionLike(n) || ast.IsClassLike(n) || n.Kind == ast.KindClassStaticBlockDeclaration {
			return false
		}
		if n.Kind == ast.KindReturnStatement || ast.IsBreakOrContinueStatement(n) {
			j := jump{kind: n.Kind}
			if n.Kind != ast.KindReturnStatement && n.Label() != nil {
				j.label = n.Label().Text()
			}
			if !f.lands(j) {
				keyword := "return"
				if n.Kind == ast.KindBreakStatement {
					keyword = "break"
				}
				if n.Kind == ast.KindContinueStatement {
					keyword = "continue"
				}
				p.syntaxToken(n, 2006, keyword+" leaves a finally block, which would discard a failure in flight.")
			}
		}
		if isJumpTarget(n) {
			target := target{loop: ast.IsIterationStatement(n, false)}
			if n.Kind == ast.KindLabeledStatement {
				target.label = n.Label().Text()
				target.loop = ast.IsIterationStatement(n.AsLabeledStatement().Statement, true)
			}
			f.targets = append(f.targets, target)
			n.ForEachChild(visit)
			f.targets = f.targets[:len(f.targets)-1]
			return false
		}
		n.ForEachChild(visit)
		return false
	}
	block.ForEachChild(visit)
}

// checkHatchCaptures resolves value references lexically for EK4405 (D229).
// Imports, globals, types, error declarations, and island-local bindings pass.
func (p *projector) checkHatchCaptures(call *ast.Node) {
	if len(call.Arguments()) == 0 {
		return
	}
	island := call.Arguments()[0]
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		// A binding element's property name, `extra` in `const { extra: picked } = item`,
		// names the property it reads, not a binding.
		if ast.IsIdentifier(n) && n.Parent != nil && !(n.Parent.Kind == ast.KindBindingElement && n.Parent.PropertyName() == n) && ((!ast.IsDeclarationName(n) && !ast.IsPartOfTypeNode(n) && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(n)) || n.Parent.Kind == ast.KindShorthandPropertyAssignment) {
			d := p.forms.(*Resolver).binding(n, n.Text())
			if d != nil {
				switch d.Kind {
				case ast.KindVariableDeclaration, ast.KindParameter, ast.KindFunctionDeclaration, ast.KindFunctionExpression, ast.KindClassDeclaration, ast.KindClassExpression, ast.KindEnumDeclaration, ast.KindModuleDeclaration:
					inside := false
					for parent := d; parent != nil; parent = parent.Parent {
						if parent == island {
							inside = true
							break
						}
					}
					if !inside && !isErrorDeclaration(d) && !syntaxTaggedErrorClass(d) {
						p.syntaxDiagnostic(n, 4405, n.Text()+" is declared outside the hatch, and a hatch's TypeScript is self-contained: pass "+n.Text()+" to "+call.Expression().Text()+" as an input.")
					}
				}
			}
		}
		n.ForEachChild(visit)
		return false
	}
	visit(island)
}

// syntaxTaggedErrorClass preserves D229's error-class exception (EK4405).
func syntaxTaggedErrorClass(n *ast.Node) bool {
	if !ast.IsClassLike(n) {
		return false
	}
	h := ast.GetClassExtendsHeritageElement(n)
	if h == nil || !ast.IsCallExpression(h.Expression()) {
		return false
	}
	callee := h.Expression().Expression()
	return ast.IsIdentifier(callee) && callee.Text() == "TaggedError" || ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "TaggedError"
}

// throwExpressionPrecedenceOperand recognizes D186's parser-generated
// (() => { throw operand })() by both its shape and its source keyword.
// A handwritten IIFE starts with '(' instead; do/match IIFEs have other
// keywords. It returns the operand only where an operator applies to more
// than the throw (throwOperandEndsOperator).
func throwExpressionPrecedenceOperand(file *ast.SourceFile, node *ast.Node) *ast.Node {
	if node.Kind != ast.KindCallExpression || node.Parent == nil || node.Pos() < 0 || node.End() > len(file.Text()) {
		return nil
	}
	if !throwOperandEndsOperator(file, node) {
		return nil
	}
	keyword := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
	if file.Text()[keyword.Pos():keyword.End()] != "throw" {
		return nil
	}
	callee := node.Expression()
	if len(node.Arguments()) != 0 || callee.Kind != ast.KindParenthesizedExpression {
		return nil
	}
	arrow := callee.Expression()
	if arrow.Kind != ast.KindArrowFunction || arrow.Body() == nil || arrow.Body().Kind != ast.KindBlock {
		return nil
	}
	statements := arrow.Body().Statements()
	if len(statements) != 1 || statements[0].Kind != ast.KindThrowStatement {
		return nil
	}
	return statements[0].Expression()
}

// throwOperandEndsOperator reports whether text after node, a throw
// expression, belongs to an operator that the throw's unary operand leaves
// out: node, or an expression that node ends, is a binary operator's left
// operand (except comma), a conditional's condition, or the operand of as or
// satisfies. `x ?? throw c ? a : b` is `(x ?? throw c) ? a : b`, so it
// throws only c, as `throw c ? a : b` does. Parentheses end the search, so a
// parenthesized throw or operand stays explicit, and right operands and
// conditional arms stay legal.
func throwOperandEndsOperator(file *ast.SourceFile, node *ast.Node) bool {
	for ; node.Parent != nil; node = node.Parent {
		parent := node.Parent
		switch parent.Kind {
		case ast.KindBinaryExpression:
			binary := parent.AsBinaryExpression()
			if binary.Left == node {
				return binary.OperatorToken.Kind != ast.KindCommaToken
			}
			// node ends the right operand, so it ends parent too.
		case ast.KindConditionalExpression:
			conditional := parent.AsConditionalExpression()
			if conditional.Condition == node {
				return true
			}
			if conditional.WhenFalse != node {
				return false // : closes the first arm
			}
		case ast.KindAsExpression, ast.KindSatisfiesExpression:
			return parent.Expression() == node
		case ast.KindPropertyAccessExpression:
			// D272 normalizes throw x |> f(args)(%) to (throw x).pipe(f(args)).
			// Its generated 'pipe' name is anchored on '|', unlike a written member.
			if parent.Expression() != node || parent.Name().Text() != "pipe" {
				return false
			}
			operator := scanner.GetRangeOfTokenAtPosition(file, parent.Name().Pos())
			return file.Text()[operator.Pos():operator.End()] == "|"
		default:
			return false
		}
	}
	return false
}

// Keep EK1010 in step with the native syntax pass, including inside hatch
// callbacks. This scan precedes the shared plan's two renderings; the other
// syntax checks retain their keyword/contract positions and D148 hatch gate.
func (p *projector) checkThrowExpressionPrecedence() {
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if operand := throwExpressionPrecedenceOperand(p.file, node); operand != nil {
			p.syntaxDiagnostic(node, 1010, "throw takes only "+scanner.GetSourceTextOfNodeFromSourceFile(p.file, operand, false)+" here, so the rest of the expression would not be thrown; write throw (…) to throw the whole expression.")
		}
		return node.ForEachChild(visit)
	}
	p.file.AsNode().ForEachChild(visit)
}
