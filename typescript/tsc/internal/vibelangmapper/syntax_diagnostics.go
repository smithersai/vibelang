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

// syntaxLowerable follows the native body/async/generator gate (EK9203).
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
