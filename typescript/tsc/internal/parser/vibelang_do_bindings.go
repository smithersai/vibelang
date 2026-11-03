package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// Flat array binding declarations can be split into statements without
// manufacturing a function boundary. Other binding environments retain their
// existing diagnostic until their own initialization algorithm can be lowered.
func (p *Parser) doArrayBinding(pattern *ast.Node) bool {
	if pattern == nil || pattern.Kind != ast.KindArrayBindingPattern {
		return false
	}
	for _, element := range pattern.AsBindingPattern().Elements.Nodes {
		if element.Kind == ast.KindOmittedExpression {
			continue
		}
		if element.Kind != ast.KindBindingElement || !ast.IsIdentifier(element.Name()) {
			return false
		}
	}
	// Leave already-supported no-jump defaults on the native binding path.
	// This slice removes a generated boundary only when a source jump needs
	// to cross it; ordinary defaults keep their existing contextual typing.
	for _, d := range p.vibelangDoOrder {
		within := false
		for n := d.call.Parent; n != nil; n = n.Parent {
			if n == pattern {
				within = true
				break
			}
			if ast.IsFunctionLike(n) && !isSynthesizedArrow(n) {
				break
			}
		}
		if !within {
			continue
		}
		outward := false
		forEachDoStatement(d.block, func(n *ast.Node) {
			if n.Kind == ast.KindReturnStatement || (n.Kind == ast.KindBreakStatement || n.Kind == ast.KindContinueStatement) && !jumpTargetWithin(n, d.block) {
				outward = true
			}
		})
		if outward {
			return true
		}
	}
	return false
}

func (l *doLowering) arrayBindingStatement(statement *ast.Node, pre *[]*ast.Node) *ast.Node {
	p := l.p
	at := statement.Loc
	parent := statement.Parent
	if l.bindings == nil {
		l.bindings = map[*ast.Node]*ast.Node{}
	}
	state := l.bindings[parent]
	if state == nil {
		state = l.temp("$bindings", at)
		l.bindings[parent] = state
	}
	call := func(method string, args ...*ast.Node) *ast.Node {
		return p.mCall(p.mProperty(l.ref(state, at), method, at), args, at)
	}
	list := statement.AsVariableStatement().DeclarationList
	flags := list.Flags
	var out []*ast.Node
	for _, declaration := range list.AsVariableDeclarationList().Declarations.Nodes {
		if !l.marked[declaration.Name()] || !p.doArrayBinding(declaration.Name()) {
			init := l.expr(declaration.Initializer(), &out)
			declaration.AsVariableDeclaration().Initializer = init
			dl := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(declaration.Loc, []*ast.Node{declaration}), flags), declaration.Loc)
			out = append(out, p.vibelangSpanning(p.factory.NewVariableStatement(statement.Modifiers(), dl), declaration.Loc))
			continue
		}
		source := l.temp("$bindingSource", declaration.Loc)
		init := l.expr(declaration.Initializer(), &out)
		sourceDecl := p.mConst(l.ref(source, at), ast.NodeFlagsConst, init, at)
		sourceVariable := sourceDecl.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
		sourceVariable.AsVariableDeclaration().Type = declaration.Type()
		p.overrideParentInImmediateChildren(sourceVariable)
		out = append(out, sourceDecl)
		typingPattern := l.bindingTypingPattern(declaration, sourceVariable, false)
		type completedDefault struct {
			index           int
			value, fallback *ast.Node
		}
		var completed []completedDefault
		iterator := l.temp("$bindingIterator", at)
		out = append(out, p.mConst(l.ref(iterator, at), ast.NodeFlagsConst, call("open", l.ref(source, at)), at))
		for i, element := range declaration.Name().AsBindingPattern().Elements.Nodes {
			if element.Kind == ast.KindOmittedExpression {
				out = append(out, l.statement(p.mCall(p.mProperty(l.ref(iterator, at), "skip", at), nil, at), at))
				continue
			}
			method := "value"
			hasDefault := ast.KindFalseKeyword
			if element.Initializer() != nil {
				hasDefault = ast.KindTrueKeyword
			}
			args := []*ast.Node{p.mNumber(i, at), p.mKeyword(hasDefault, at)}
			if element.AsBindingElement().DotDotDotToken != nil {
				method = "rest"
				args = nil
			}
			raw := l.temp("$bindingValue", element.Loc)
			read := p.mCall(p.mProperty(l.ref(iterator, at), method, at), args, at)
			if l.bindingReads == nil {
				l.bindingReads = map[*ast.Node]*DoBindingRead{}
			}
			l.bindingReads[read] = &DoBindingRead{Element: typingPattern.Elements()[i], HasDefault: element.Initializer() != nil}
			rawStatement := p.mConst(l.ref(raw, at), ast.NodeFlagsConst, read, at)
			rawDeclaration := rawStatement.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
			out = append(out, rawStatement)
			value := l.ref(raw, at)
			if fallback := element.Initializer(); fallback != nil {
				if !l.marked[fallback] {
					// Retain native default contextual typing and NamedEvaluation
					// for neighboring defaults that need no statement lifting.
					field := p.vibelangSpanning(p.factory.NewBindingElement(nil, p.mIdent("value", at), element.Name(), fallback), element.Loc)
					pattern := p.vibelangSpanning(p.factory.NewBindingPattern(ast.KindObjectBindingPattern, p.newNodeList(element.Loc, []*ast.Node{field})), element.Loc)
					property := p.vibelangSpanning(p.factory.NewPropertyAssignment(nil, p.mIdent("value", at), nil, nil, l.ref(raw, at)), at)
					object := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(at, []*ast.Node{property}), false), at)
					bound := p.mConst(pattern, flags, object, element.Loc)
					if declaration.Type() != nil {
						query := p.vibelangSynthesized(p.factory.NewTypeQueryNode(l.ref(raw, at), nil), at)
						member := p.vibelangSynthesized(p.factory.NewPropertySignatureDeclaration(nil, p.mIdent("value", at), nil, query, nil), at)
						typeNode := p.vibelangSynthesized(p.factory.NewTypeLiteralNode(p.newNodeList(at, []*ast.Node{member})), at)
						variable := bound.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
						variable.AsVariableDeclaration().Type = typeNode
						p.overrideParentInImmediateChildren(variable)
					}
					out = append(out, bound)
					continue
				}
				test := p.mBinary(l.ref(raw, at), ast.KindEqualsEqualsEqualsToken, l.undefined(at), at)
				conditional := p.vibelangSpanning(p.factory.NewConditionalExpression(test, p.vibelangSynthesized(p.factory.NewToken(ast.KindQuestionToken), at), fallback, p.vibelangSynthesized(p.factory.NewToken(ast.KindColonToken), at), l.ref(raw, element.Loc)), element.Loc)
				l.marked[conditional] = true
				if l.bindingDefaultValues == nil {
					l.bindingDefaultValues = map[*ast.Node]*ast.Node{}
				}
				if l.bindingDefaultConditions == nil {
					l.bindingDefaultConditions = map[*ast.Node]*ast.Node{}
				}
				l.bindingDefaultValues[fallback] = nil
				l.bindingDefaultConditions[conditional] = rawDeclaration
				value = l.expr(conditional, &out)
			}
			bound := p.mConst(element.Name(), flags, value, element.Loc)
			if fallback := element.Initializer(); fallback != nil && l.marked[fallback] {
				completed = append(completed, completedDefault{i, value, fallback})
			}
			out = append(out, bound)
		}
		if l.bindingContexts == nil {
			l.bindingContexts = map[*ast.Node]*ast.Node{}
		}
		contextPattern := l.bindingTypingPattern(declaration, sourceVariable, true)
		l.bindingContexts[sourceVariable] = contextPattern
		for _, done := range completed {
			origin := &DoBindingRead{Element: contextPattern.Elements()[done.index], HasDefault: true}
			if declaration.Type() != nil {
				origin.Default = l.bindingDefaultValues[done.fallback]
				origin.Raw = typingPattern.Elements()[done.index]
			}
			l.bindingReads[done.value] = origin
		}
		out = append(out, l.statement(call("close"), at))
	}
	*pre = append(*pre, out[:len(out)-1]...)
	return out[len(out)-1]
}

// Wrap the whole original block, including statements before the binding.
// Moving only its suffix would split lexical cells and change TDZ/closures.
// The finally is active only while a binding has an unfinished iterator.
func (l *doLowering) finishArrayBindings(block *ast.Node) {
	state := l.bindings[block]
	if state == nil {
		return
	}
	delete(l.bindings, block)
	p := l.p
	at := block.Loc
	statements := block.AsBlock().Statements.Nodes
	throwing := l.temp("$bindingThrow", at)
	caught := l.temp("$bindingError", at)
	init := p.mConst(l.ref(state, at), ast.NodeFlagsConst, p.mCall(p.vibelangIntrinsic("$bindingIterators", at), nil, at), at)
	flag := p.mConst(l.ref(throwing, at), ast.NodeFlagsLet, p.mKeyword(ast.KindFalseKeyword, at), at)
	caughtDecl := p.vibelangSpanning(p.factory.NewVariableDeclaration(l.ref(caught, at), nil, nil, nil), at)
	rethrow := p.vibelangSpanning(p.factory.NewThrowStatement(l.ref(caught, at)), at)
	rethrow.Flags |= ast.NodeFlagsVibeLangBindingCleanup
	catchBody := p.mBlock([]*ast.Node{l.statement(l.assign(l.ref(throwing, at), p.mKeyword(ast.KindTrueKeyword, at), at), at), rethrow}, at)
	catch := p.vibelangSpanning(p.factory.NewCatchClause(caughtDecl, catchBody), at)
	finish := p.mCall(p.mProperty(l.ref(state, at), "finish", at), []*ast.Node{l.ref(throwing, at)}, at)
	final := p.mBlock([]*ast.Node{l.statement(finish, at)}, at)
	wrapped := p.vibelangSpanning(p.factory.NewTryStatement(p.mBlock(statements, at), catch, final), at)
	wrapped.Flags |= ast.NodeFlagsVibeLangBindingCleanup
	block.AsBlock().Statements.Nodes = []*ast.Node{init, flag, wrapped}
	p.overrideParentInImmediateChildren(block)
}

// Keep native binding types separate from the runtime's iterator protocol.
// These patterns are checker metadata, never extra reads or declarations.
type DoBindingRead struct {
	Element      *ast.Node
	Default, Raw *ast.Node // a written annotation also constrains the normal default
	HasDefault   bool
}

var doBindingReadsKey = ast.NewSourceFileDataKey[map[*ast.Node]*DoBindingRead]()
var doBindingContextsKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()
var doBindingNormalContextsKey = ast.NewSourceFileDataKey[map[*ast.Node]*ast.Node]()

func VibeLangDoBindingNormalContext(element *ast.Node) *ast.Node {
	if element.Name() == nil || element.Name().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	file := ast.GetSourceFileOfNode(element)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(doBindingNormalContextsKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })[element]
}

func VibeLangDoBindingReads(file *ast.SourceFile) map[*ast.Node]*DoBindingRead {
	return file.GetOrComputeData(doBindingReadsKey, func(*ast.SourceFile) map[*ast.Node]*DoBindingRead { return nil })
}

func VibeLangDoBindingRead(node *ast.Node) *DoBindingRead {
	file := ast.GetSourceFileOfNode(node)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(doBindingReadsKey, func(*ast.SourceFile) map[*ast.Node]*DoBindingRead { return nil })[node]
}
func VibeLangDoBindingContext(declaration *ast.Node) *ast.Node {
	if declaration.Name() == nil || declaration.Name().Flags&ast.NodeFlagsReparsed == 0 {
		return nil
	}
	file := ast.GetSourceFileOfNode(declaration)
	if file == nil {
		return nil
	}
	return file.GetOrComputeData(doBindingContextsKey, func(*ast.SourceFile) map[*ast.Node]*ast.Node { return nil })[declaration]
}

func (l *doLowering) bindingTypingPattern(declaration, source *ast.Node, context bool) *ast.Node {
	p := l.p
	var elements []*ast.Node
	for _, element := range declaration.Name().Elements() {
		if element.Kind == ast.KindOmittedExpression {
			elements = append(elements, p.vibelangSynthesized(p.factory.NewOmittedExpression(), element.Loc))
			continue
		}
		var initializer, originalParent *ast.Node
		if context && element.Initializer() != nil {
			initializer = element.Initializer()
			if value := l.bindingDefaultValues[initializer]; value != nil {
				initializer = value
			}
			originalParent = initializer.Parent
		}
		var rest *ast.Node
		if element.AsBindingElement().DotDotDotToken != nil {
			rest = p.mToken(ast.KindDotDotDotToken, element.Loc)
		}
		copy := p.vibelangSpanning(p.factory.NewBindingElement(rest, nil, p.mIdent(element.Name().Text(), element.Name().Loc), initializer), element.Loc)
		if initializer != nil && originalParent != nil {
			initializer.Parent = originalParent
		}
		if context && l.bindingDefaultValues[element.Initializer()] != nil {
			if l.bindingNormalContexts == nil {
				l.bindingNormalContexts = map[*ast.Node]*ast.Node{}
			}
			l.bindingNormalContexts[copy] = initializer
		}
		elements = append(elements, copy)
	}
	pattern := p.vibelangSpanning(p.factory.NewBindingPattern(ast.KindArrayBindingPattern, p.newNodeList(declaration.Name().Loc, elements)), declaration.Name().Loc)
	initializer := source.Initializer()
	originalParent := initializer.Parent
	typeNode := source.Type()
	var typeParent *ast.Node
	if typeNode != nil {
		typeParent = typeNode.Parent
	}
	root := p.vibelangSpanning(p.factory.NewVariableDeclaration(pattern, nil, typeNode, initializer), declaration.Loc)
	initializer.Parent = originalParent
	if typeNode != nil {
		typeNode.Parent = typeParent
	}
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(root.Loc, []*ast.Node{root}), declaration.Parent.Flags), root.Loc)
	list.Parent = source.Parent.Parent
	return pattern
}

// The conditional's writes take the native element's contextual type. The
// statement that declares its final binding still decides assignability.
func (l *doLowering) bindingDefaultContextSite(name, raw *ast.Node, at core.TextRange) *ast.Node {
	p := l.p
	ref := l.ref(name, at)
	field := p.vibelangSpanning(p.factory.NewBindingElement(nil, nil, l.temp("$defaultContext", at), ref), at)
	pattern := p.vibelangSpanning(p.factory.NewBindingPattern(ast.KindArrayBindingPattern, p.newNodeList(at, []*ast.Node{field})), at)
	query := p.vibelangSynthesized(p.factory.NewTypeQueryNode(l.ref(raw.Name(), at), nil), at)
	typeNode := p.vibelangSynthesized(p.factory.NewTupleTypeNode(p.newNodeList(at, []*ast.Node{query})), at)
	root := p.vibelangSpanning(p.factory.NewVariableDeclaration(pattern, nil, typeNode, nil), at)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(at, []*ast.Node{root}), ast.NodeFlagsConst), at)
	list.Parent = raw.Parent.Parent
	return ref
}
