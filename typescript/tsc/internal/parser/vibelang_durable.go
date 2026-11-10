package parser

import (
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Durable declarations (VIP-55): a task is one recorded step, and a workflow
// is a plan over tasks.
//
//	task FetchIssues {
//	  static readonly retryPolicy = { initialMs: 1000, factor: 2, maxMs: 4000, maxAttempts: 3 }
//	  effect call(repo: string): Issues!string { … }
//	}
//	workflow Triage {
//	  effect call(repo: string) { return try LabelIssues(try FetchIssues(repo)) }
//	}
//
// parse as the constants the runtime's declaration helpers build:
//
//	const FetchIssues = $task<(repo: string) => Issues!string>()("FetchIssues", { retryPolicy: { … } },
//	  { payload: { repo: Schema.String }, success: Issues, error: Schema.String }, effect function call(repo: string) { … })
//	const Triage = $workflow("Triage", {}, { payload: { repo: Schema.String } }, effect function call(repo: string) { … })
//
// A task's written signature, its parameters and its A!E annotation, is its
// durable boundary, not its body's type (VIP-55): the parser moves it into the
// type argument, so the body's service requirements stay inferred and become
// the requirements of the task's layer. A task whose call has no body declares
// a step whose implementation arrives as a layer: the last argument is left
// out. The third argument holds the boundary's schemas (durableSchemas). A workflow's call keeps its own annotation, which may be left out.
//
// Each static readonly member is one option, passed through under its own
// name. The checker reports a declaration that is not one effect call and
// static readonly members (EK5501) at the members the parser drops.

// VibeSyntaxTask and VibeSyntaxWorkflow are the Names of the
// VibeSyntaxDeclaration recorded for a task or workflow declaration: Head runs
// from the word through the name, Open and Close are the braces.
const (
	VibeSyntaxTask     = "task"
	VibeSyntaxWorkflow = "workflow"
)

// DurableCallDiagnosticCode is EK5501: a task or workflow that is not one
// effect call method and static readonly members.
const DurableCallDiagnosticCode int32 = 5501

// DurableCallDiagnosticText is EK5501's message; %s is task or workflow.
const DurableCallDiagnosticText = "A %s holds one `effect call(…)` method and `static readonly` options, nothing else."

// DurableTaskSignatureDiagnosticText is EK5501's message for a task call whose
// boundary is not written out.
const DurableTaskSignatureDiagnosticText = "A task's `effect call` writes a type for each parameter and its `A!E` return type: they are its durable boundary."

// parseDurableDeclaration parses task Name { … } or workflow Name { … } at
// the current token, task or workflow.
func (p *Parser) parseDurableDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList, workflow bool) *ast.Node {
	word := p.scanner.TokenRange()
	kind := VibeSyntaxTask
	intrinsic := "$task"
	if workflow {
		kind, intrinsic = VibeSyntaxWorkflow, "$workflow"
	}
	p.nextToken() // task or workflow
	name := p.parseBindingIdentifier()
	if p.token == ast.KindLessThanToken {
		start := p.nodePos()
		p.parseTypeParameters()
		p.durableError(core.NewTextRange(scanner.SkipTrivia(p.sourceText, start), p.nodePos()), kind)
	}
	form := VibeSyntax{Kind: VibeSyntaxDeclaration, Name: kind, Head: core.NewTextRange(word.Pos(), name.End())}
	var members []*ast.Node
	body := name.Loc
	if p.token == ast.KindOpenBraceToken {
		form.Open = p.tokenRange()
		open := p.nodePos()
		p.nextToken()
		list := p.parseList(PCClassMembers, (*Parser).parseClassElement)
		members = list.Nodes
		if p.token == ast.KindCloseBraceToken {
			form.Close = p.tokenRange()
		}
		p.parseExpected(ast.KindCloseBraceToken)
		body = core.NewTextRange(open, p.nodePos())
	} else {
		p.parseExpected(ast.KindOpenBraceToken)
	}
	form.Range = core.NewTextRange(scanner.SkipTrivia(p.sourceText, pos), p.nodePos())
	p.recordVibeSyntax(form)

	var call *ast.Node
	var options []*ast.Node
	for _, member := range members {
		switch {
		case member.Kind == ast.KindSemicolonClassElement:
			// A ; between members, as in a class body.
		case ast.IsMethodDeclaration(member) && member.Name() != nil && member.Name().Kind == ast.KindIdentifier && member.Name().Text() == "call" &&
			!ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) && call == nil && member.Flags&ast.NodeFlagsVibeLangEffect != 0 &&
			member.AsMethodDeclaration().AsteriskToken == nil && member.AsMethodDeclaration().PostfixToken == nil:
			call = member
		case ast.IsPropertyDeclaration(member) && ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) &&
			ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) && member.Initializer() != nil &&
			member.Name() != nil && (member.Name().Kind == ast.KindIdentifier || member.Name().Kind == ast.KindStringLiteral):
			options = append(options, p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, member.Name(), nil /*postfixToken*/, nil /*typeNode*/, member.Initializer()), member.Loc))
		default:
			p.durableError(core.NewTextRange(scanner.SkipTrivia(p.sourceText, member.Pos()), member.End()), kind)
		}
	}
	if call == nil && len(members) > 0 || call == nil && form.Open.Len() > 0 {
		p.durableError(core.NewTextRange(scanner.SkipTrivia(p.sourceText, word.Pos()), name.End()), kind)
	}

	inside := body
	if form.Open.Len() > 0 && form.Close.Len() > 0 {
		inside = core.NewTextRange(form.Open.End(), form.Close.Pos())
	}
	object := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(inside, options), len(options) > 0 /*multiLine*/), body)
	tag := p.vibelangSynthesized(p.factory.NewStringLiteral(name.Text(), ast.TokenFlagsNone), name.Loc)
	arguments := []*ast.Node{tag, object}

	callee := p.vibelangIntrinsic(intrinsic, word)
	var expression *ast.Node
	if call != nil {
		method := call.AsMethodDeclaration()
		var parameters *ast.NodeList = method.Parameters
		returnType := method.Type
		var implementationType *ast.Node
		arguments = append(arguments, p.durableSchemas(parameters, returnType, call.Name().Loc))
		if !workflow {
			if !p.durableSignatureWritten(call) {
				p.vibelangServiceError(core.NewTextRange(scanner.SkipTrivia(p.sourceText, call.Pos()), call.Name().End()), DurableCallDiagnosticCode, DurableTaskSignatureDiagnosticText)
			}
			if returnType != nil {
				signature := p.vibelangSpanning(p.factory.NewFunctionTypeNode(nil /*typeParameters*/, p.durableCloneParameters(parameters), p.addDeepCloneReparse(returnType)), returnType.Loc)
				signature.Flags |= ast.NodeFlagsReparsed
				typeArguments := p.newNodeList(returnType.Loc, []*ast.Node{signature})
				callee = p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, typeArguments, p.newNodeList(word, nil), ast.NodeFlagsNone), word)
			} else {
				callee = p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil, p.newNodeList(word, nil), ast.NodeFlagsNone), word)
			}
		}
		if workflow && method.Body == nil {
			p.durableError(core.NewTextRange(scanner.SkipTrivia(p.sourceText, call.Pos()), call.End()), kind)
		}
		if method.Body != nil {
			if workflow {
				implementationType = returnType
				// A workflow's body is a plan, not an Effect it runs: the
				// workflows it calls need the engine, which runs them as
				// steps. Its written A!E leaves R out, so R is not checked.
				if _, _, requirements := durableEffectSlots(returnType); requirements != nil && requirements.Kind == ast.KindNeverKeyword && requirements.Flags&ast.NodeFlagsReparsed != 0 {
					arguments := returnType.AsTypeReferenceNode().TypeArguments.Nodes
					arguments[2] = p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindAnyKeyword), requirements.Loc)
					arguments[2].Parent = returnType
				}
				// return W.to(…) ends a round: the body may also give a
				// Handoff, which the workflow's success type leaves out.
				if success, _, requirements := durableEffectSlots(returnType); requirements != nil {
					arguments := returnType.AsTypeReferenceNode().TypeArguments.Nodes
					handoff := p.vibelangSynthesized(p.factory.NewTypeReferenceNode(p.vibelangIntrinsic("$Handoff", success.Loc), nil), success.Loc)
					union := p.vibelangSpanning(p.factory.NewUnionTypeNode(p.newNodeList(success.Loc, []*ast.Node{success, handoff})), success.Loc)
					grouped := p.vibelangSpanning(p.factory.NewParenthesizedTypeNode(union), success.Loc)
					grouped.Flags |= ast.NodeFlagsReparsed
					arguments[0] = grouped
					grouped.Parent = returnType
				}
			}
			if workflow {
				p.durableSelfHandoffs(method.Body, name.Text(), parameters)
			}
			fn := p.factory.NewFunctionExpression(nil /*modifiers*/, nil /*asteriskToken*/, call.Name(), method.TypeParameters, parameters, implementationType, nil /*fullSignature*/, method.Body)
			p.vibelangSpanning(fn, call.Loc)
			fn.Flags |= ast.NodeFlagsVibeLangEffect
			arguments = append(arguments, fn)
			if workflow {
				tasks, others := p.durableReached(method.Body, name.Text(), parameters, call.Name().Loc)
				arguments = append(arguments, tasks, others)
			}
		}
	} else {
		arguments = append(arguments, p.durableSchemas(p.newNodeList(name.Loc, nil), nil, name.Loc))
		if !workflow {
			callee = p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil, p.newNodeList(word, nil), ast.NodeFlagsNone), word)
		}
	}
	if !workflow {
		if p.vibelangDurableTasks == nil {
			p.vibelangDurableTasks = map[string]bool{}
		}
		p.vibelangDurableTasks[name.Text()] = true
	}
	span := core.NewTextRange(name.Pos(), p.nodePos())
	expression = p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, p.newNodeList(span, arguments), ast.NodeFlagsNone), span)
	declaration := p.vibelangSpanning(p.factory.NewVariableDeclaration(name, nil /*exclamationToken*/, nil /*typeNode*/, expression), span)
	list := p.vibelangSpanning(p.factory.NewVariableDeclarationList(p.newNodeList(span, []*ast.Node{declaration}), ast.NodeFlagsConst), span)
	statement := p.factory.NewVariableStatement(modifiers, list)
	p.finishNode(statement, pos)
	p.withJSDoc(statement, jsdoc)
	return statement
}

// durableSignatureWritten reports whether a task's call writes a type for
// every parameter and its return type.
func (p *Parser) durableSignatureWritten(call *ast.Node) bool {
	method := call.AsMethodDeclaration()
	if method.Type == nil {
		return false
	}
	for _, parameter := range method.Parameters.Nodes {
		if parameter.Type() == nil || parameter.Name() == nil || !ast.IsIdentifier(parameter.Name()) || parameter.AsParameterDeclaration().DotDotDotToken != nil {
			return false
		}
	}
	// The R slot is never written: the body's services belong to the
	// task's implementation (VIP-55).
	if _, _, requirements := durableEffectSlots(method.Type); requirements != nil && requirements.Flags&ast.NodeFlagsReparsed == 0 && requirements.Kind != ast.KindNeverKeyword {
		return false
	}
	return true
}

// durableEffectSlots returns the success, error and requirement types of an
// Effect type, A!E!R or Effect.Effect<A, E, R>, or typeNode alone as the
// success when it is not one.
func durableEffectSlots(typeNode *ast.Node) (success, failure, requirements *ast.Node) {
	if typeNode == nil {
		return nil, nil, nil
	}
	if typeNode.Kind == ast.KindTypeReference {
		reference := typeNode.AsTypeReferenceNode()
		if name := reference.TypeName; name.Kind == ast.KindQualifiedName && name.AsQualifiedName().Right.Text() == "Effect" &&
			ast.IsIdentifier(name.AsQualifiedName().Left) && name.AsQualifiedName().Left.Text() == "Effect" &&
			reference.TypeArguments != nil && len(reference.TypeArguments.Nodes) == 3 {
			arguments := reference.TypeArguments.Nodes
			return arguments[0], arguments[1], arguments[2]
		}
	}
	return typeNode, nil, nil
}

// durableSchemas makes the boundary schemas of a task or workflow from its
// call's parameters and return type (VIP-44, "What the compiler generates"):
//
//	{ payload: { repo: Schema.String }, success: Issues, error: Schema.String }
//
// payload holds a schema for each parameter, keyed by its name; success and
// error come from the A and E of an A!E return type, and are left out with
// it. A type with no schema form maps to the Schema.Unknown the checker
// reports as EK2109, as in a schema declaration.
func (p *Parser) durableSchemas(parameters *ast.NodeList, returnType *ast.Node, anchor core.TextRange) *ast.Node {
	var fields []*ast.Node
	for _, parameter := range parameters.Nodes {
		name := parameter.Name()
		if name == nil || !ast.IsIdentifier(name) {
			continue
		}
		var value *ast.Node
		if parameter.Type() == nil {
			value = p.vibelangUnsupportedSchema(name.Loc)
		} else {
			value = p.durableSchemaOf(parameter.Type())
		}
		key := p.vibelangSynthesized(p.factory.NewIdentifier(name.Text()), name.Loc)
		fields = append(fields, p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, key, nil /*postfixToken*/, nil /*typeNode*/, value), core.NewTextRange(name.Pos(), value.End())))
	}
	payload := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(parameters.Loc, fields), false /*multiLine*/), parameters.Loc)
	properties := []*ast.Node{p.durableSchemaProperty("payload", payload, anchor)}
	if success, failure, _ := durableEffectSlots(returnType); success != nil {
		properties = append(properties, p.durableSchemaProperty("success", p.durableSchemaOf(success), anchor))
		if failure != nil {
			properties = append(properties, p.durableSchemaProperty("error", p.durableSchemaOf(failure), anchor))
		} else {
			properties = append(properties, p.durableSchemaProperty("error", p.vibelangSchemaMember(nil, "Never", anchor), anchor))
		}
	}
	return p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(anchor, properties), false /*multiLine*/), anchor)
}

func (p *Parser) durableSchemaProperty(name string, value *ast.Node, anchor core.TextRange) *ast.Node {
	key := p.vibelangSynthesized(p.factory.NewIdentifier(name), anchor)
	return p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, key, nil /*postfixToken*/, nil /*typeNode*/, value), value.Loc)
}

// durableSchemaOf is vibelangSchemaOf for a boundary type, which may also be
// never or void: a task that cannot fail, or succeeds with nothing.
func (p *Parser) durableSchemaOf(typeNode *ast.Node) *ast.Node {
	switch typeNode.Kind {
	case ast.KindNeverKeyword:
		return p.vibelangSchemaMember(nil, "Never", p.vibelangCalleeAnchor(typeNode.Loc))
	case ast.KindVoidKeyword:
		return p.vibelangSchemaMember(nil, "Void", p.vibelangCalleeAnchor(typeNode.Loc))
	}
	return p.vibelangSchemaOf(typeNode)
}

// durableCloneParameters copies a task call's parameters into its boundary
// signature. The copies are reparsed nodes, so the language service sees only
// the written parameters.
func (p *Parser) durableCloneParameters(parameters *ast.NodeList) *ast.NodeList {
	clones := make([]*ast.Node, len(parameters.Nodes))
	for i, parameter := range parameters.Nodes {
		clones[i] = p.addDeepCloneReparse(parameter)
	}
	return p.newNodeList(parameters.Loc, clones)
}

// durableError reports EK5501 at loc for a task or a workflow (kind).
func (p *Parser) durableError(loc core.TextRange, kind string) {
	p.vibelangServiceError(loc, DurableCallDiagnosticCode, fmt.Sprintf(DurableCallDiagnosticText, kind))
}

// durableSelfHandoffs writes each W.to(…) in workflow W's own body as
// $handoff<[parameter types]>("W", …). The handoff then takes its type from
// W's written parameters, not from W, whose type TypeScript infers from this
// body: W.to(…) there would make W's type depend on itself (TS7022). A
// function or class inside the body that declares its own W keeps it.
func (p *Parser) durableSelfHandoffs(body *ast.Node, name string, parameters *ast.NodeList) {
	if body == nil {
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if (ast.IsFunctionLike(node) || ast.IsClassLike(node)) && node.Name() != nil && node.Name().Text() == name {
			return false
		}
		if ast.IsCallExpression(node) {
			call := node.AsCallExpression()
			callee := call.Expression
			if ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "to" && ast.IsIdentifier(callee.Expression()) && callee.Expression().Text() == name {
				types := make([]*ast.Node, 0, len(parameters.Nodes))
				for _, parameter := range parameters.Nodes {
					if parameter.Type() == nil {
						types = append(types, p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindAnyKeyword), parameter.Loc))
						continue
					}
					types = append(types, p.addDeepCloneReparse(parameter.Type()))
				}
				tuple := p.vibelangSpanning(p.factory.NewTupleTypeNode(p.newNodeList(callee.Loc, types)), callee.Loc)
				tuple.Flags |= ast.NodeFlagsReparsed
				call.Expression = p.vibelangIntrinsic("$handoff", callee.Loc)
				call.TypeArguments = p.newNodeList(callee.Loc, []*ast.Node{tuple})
				tag := p.vibelangSynthesized(p.factory.NewStringLiteral(name, ast.TokenFlagsNone), callee.Expression().Loc)
				call.Arguments = p.newNodeList(call.Arguments.Loc, append([]*ast.Node{tag}, call.Arguments.Nodes...))
				p.overrideParentInImmediateChildren(node)
			}
		}
		node.ForEachChild(visit)
		return false
	}
	body.ForEachChild(visit)
}

// durableReached returns two thunks of the names a workflow's body calls, as
// A(…), A.child(…) or A.to(…), that the body does not declare itself and that
// are not the workflow's own: () => [T, …] for tasks declared earlier in this
// file, whose types give W.layer's requirements, and
// (): ReadonlyArray<unknown> => [B, …] for the rest. The runtime composes
// W.layer from the tasks and workflows among them. The second thunk's
// written return type keeps its names out of W's type, so workflows that
// reach each other do not make their types depend on each other (TS7022).
func (p *Parser) durableReached(body *ast.Node, name string, parameters *ast.NodeList, anchor core.TextRange) (*ast.Node, *ast.Node) {
	declared := map[string]bool{name: true}
	for _, parameter := range parameters.Nodes {
		if parameter.Name() != nil && ast.IsIdentifier(parameter.Name()) {
			declared[parameter.Name().Text()] = true
		}
	}
	var order []string
	var uses = map[string]*ast.Node{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsBindingElement(node) || ast.IsVariableDeclaration(node) || ast.IsParameterDeclaration(node) || ast.IsFunctionDeclaration(node) || ast.IsClassDeclaration(node):
			if node.Name() != nil && ast.IsIdentifier(node.Name()) {
				declared[node.Name().Text()] = true
			}
		case ast.IsCallExpression(node):
			callee := node.AsCallExpression().Expression
			if ast.IsPropertyAccessExpression(callee) && (callee.Name().Text() == "child" || callee.Name().Text() == "to") {
				callee = callee.Expression()
			}
			if ast.IsIdentifier(callee) && callee.Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
				if _, seen := uses[callee.Text()]; !seen {
					uses[callee.Text()] = callee
					order = append(order, callee.Text())
				}
			}
		}
		node.ForEachChild(visit)
		return false
	}
	if body != nil {
		body.ForEachChild(visit)
	}
	var tasks, others []*ast.Node
	for _, used := range order {
		if declared[used] {
			continue
		}
		id := p.vibelangSynthesized(p.factory.NewIdentifier(used), uses[used].Loc)
		if p.vibelangDurableTasks[used] {
			tasks = append(tasks, id)
		} else {
			others = append(others, id)
		}
	}
	taskArray := p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(anchor, tasks), false /*multiLine*/), anchor)
	otherArray := p.vibelangSpanning(p.factory.NewArrayLiteralExpression(p.newNodeList(anchor, others), false /*multiLine*/), anchor)
	otherThunk := p.vibelangProgramArrow(nil, otherArray, anchor)
	unknown := p.vibelangSynthesized(p.factory.NewKeywordTypeNode(ast.KindUnknownKeyword), anchor)
	readonlyArray := p.vibelangSynthesized(p.factory.NewIdentifier("ReadonlyArray"), anchor)
	otherThunk.AsArrowFunction().Type = p.vibelangSynthesized(p.factory.NewTypeReferenceNode(readonlyArray, p.newNodeList(anchor, []*ast.Node{unknown})), anchor)
	p.overrideParentInImmediateChildren(otherThunk)
	return p.vibelangProgramArrow(nil, taskArray, anchor), otherThunk
}
