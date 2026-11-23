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
// (EK2006), D1's bodiless service contracts (EK9205), D129's setup order
// (EK9209). VIP-6 permits lexical wrapper captures. Alias/type identity
// and unresolved types remain native. A type argument left out of an Effect
// type means what it means in TypeScript (D308, D309), so Effect<A> is complete.
func (p *projector) checkSyntaxDiagnostics() {
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if p.isHatchCall(n) {
			// VIP-6 retires D229: ordinary lexical captures are allowed.
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
			if p.nativeTryInEffectCode(n) {
				start := p.tokenStart(n)
				p.diagnostics = append(p.diagnostics, Diagnostic{Start: start, Length: n.End() - start, Code: CodeEffectTryStatement, Message: effectTryStatementMessage})
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

// CodeEffectTryStatement is the native compiler's EK0503: effect code has no
// try statements, try/finally included (VIP-5).
const CodeEffectTryStatement = 503

const effectTryStatementMessage = "A try statement cannot handle a failure in effect code: a failed try never resumes the body, so its catch and finally blocks would not run. Handle failures with catch or match, and clean up with ensuring or onExit, as in try ensuring(write(x), close())."

// nativeTryInEffectCode reports whether n is a try statement written in the
// body of an effect function, lambda, block or producer. A plain or async
// function's try statement is JavaScript's, with JavaScript's completion
// rules, wherever the function is nested. The arrows the parser writes for
// forms that run where they stand belong to the function around them.
func (p *projector) nativeTryInEffectCode(n *ast.Node) bool {
	if n.Flags&(ast.NodeFlagsVibeLang|ast.NodeFlagsReparsed) != 0 {
		return false
	}
	start := p.tokenStart(n)
	block := n.AsTryStatement().TryBlock
	if !startsWord(p.text[start:], "try") || block == nil || scanner.SkipTrivia(p.text, start+len("try")) != p.tokenStart(block) {
		return false
	}
	for owner := n.Parent; owner != nil; owner = owner.Parent {
		if ast.IsClassLike(owner) || owner.Kind == ast.KindClassStaticBlockDeclaration {
			return false
		}
		if !ast.IsFunctionLike(owner) {
			continue
		}
		if ast.IsArrowFunction(owner) && owner.AsArrowFunction().EqualsGreaterThanToken.Flags&ast.NodeFlagsReparsed != 0 {
			continue
		}
		if p.isPlainHatchFunction(owner) {
			return false
		}
		return owner.Flags&ast.NodeFlagsVibeLangEffect != 0
	}
	return false
}

// checkServiceContracts retains a projection refusal for incomplete legacy
// controls. Ordinary service signatures use native TypeScript checking.
func (p *projector) checkServiceContracts(class *ast.Node) {
	for _, member := range class.Members() {
		if member.Kind != ast.KindMethodDeclaration || ast.IsStatic(member) || member.Name() == nil || !ast.IsIdentifier(member.Name()) {
			continue
		}
		if !isControlClass(class) {
			// VIP-9 uses native noImplicitAny, including when it is disabled.
			// The TypeScript host checks the projected method signature.
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
			p.syntaxDiagnostic(at, CodeUnprojectedForm, class.Name().Text()+"."+member.Name().Text()+" has no body to infer from, so its contract must be written as an Effect type.")
		}
	}
}

// checkLayerSetup uses the parser's retained source order to report EK9209.
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
			p.syntaxDiagnostic(setup, 9209, "This statement follows the layer's members, but a layer's setup statements come first.")
		}
	}
}

// syntaxTaggedErrorClass recognizes the legacy TaggedError class shape.
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
