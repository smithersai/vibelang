package parser

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Schema services (VIP-57).
//
// schema service is to service what schema error is to error: the same
// declaration, with codecs. The service parses exactly as service does, and
// the parser writes its Rpc group before it, one Rpc for each method:
//
//	export schema service Stats {
//	  summarize(values: readonly number[]): Summary!EmptySample
//	  ticks(every?: number): Stream<number>
//	}
//
// is the service Stats and
//
//	export class StatsRpcs extends RpcGroup.make(
//	  Rpc.make("summarize", { payload: { values: Schema.Array(Schema.Number) }, success: Summary, error: EmptySample }),
//	  Rpc.make("ticks", { payload: { every: Schema.optional(Schema.Number) }, success: Schema.Number, stream: true })
//	) {}
//
// A payload is keyed by parameter name, in the order of the parameters. Each
// parameter type, success type and error type maps as a schema field's type
// does (vibelangSchemaOf), so a type with no schema form is the same flagged
// Schema.Unknown, which the checker reports as EK2109. A void success and a
// never error are left out, as Rpc.make's defaults. Effect's RpcClientError
// in an error type is the transport's failure, which no server sends: it is
// left out of the wire schema, and the lowering tells the runtime that the
// member declares it.
//
// The mapping is syntactic, as a schema's is: a return type is an Effect when
// it is written A!E, Effect<A, E> or Effect.Effect<A, E>, and a Stream when
// written Stream<A, E> or Stream.Stream<A, E>. A member the mapping cannot
// read (a property, an accessor, an overload, a generic method, a rest or
// destructured parameter, or another return type) gets no Rpc, and the
// checker reports it as EK5701 (vibelang/schema_services.go).
//
// The group's types are copies of the member's: the service keeps its own
// nodes. RpcGroup and Rpc are intrinsics, effect/rpc's modules whatever the
// file declares.

// SchemaServiceGroupSuffix follows a schema service's name in the name of
// its Rpc group: Stats and StatsRpcs.
const SchemaServiceGroupSuffix = "Rpcs"

// SchemaServiceTransportError names Effect's RpcClientError, the module and
// its class, which a member's error type lists to receive transport failures
// as typed failures.
const SchemaServiceTransportError = "RpcClientError"

// isStartOfVibeLangSchemaService reports whether the current token, schema,
// starts a schema service declaration: schema service Name, with service and
// the name on the same line. A schema named service is still
// schema service { ... }.
func (p *Parser) isStartOfVibeLangSchemaService() bool {
	return p.lookAhead(func(p *Parser) bool {
		p.nextToken() // schema
		if p.token != ast.KindIdentifier || p.scanner.TokenValue() != "service" || p.hasPrecedingLineBreak() {
			return false
		}
		p.nextToken()
		return !p.hasPrecedingLineBreak() && p.isIdentifier()
	})
}

// parseSchemaServiceDeclaration parses a schema service at the current
// token, schema: the service, and its Rpc group on p.reparseList, so the
// statement list holds the group before the service.
func (p *Parser) parseSchemaServiceDeclaration(pos int, jsdoc jsdocScannerInfo, modifiers *ast.ModifierList) *ast.Node {
	schema := p.tokenRange()
	p.nextToken() // schema
	// The second token in schema service is a keyword too.
	if p.scanner.HasUnicodeEscape() || p.scanner.HasExtendedUnicodeEscape() {
		p.parseErrorAtCurrentToken(diagnostics.Keywords_cannot_contain_escape_characters)
	}
	p.vibelangSchemaServiceWord = schema
	service := p.parseServiceDeclaration(pos, jsdoc, modifiers, false /*control*/)
	p.vibelangSchemaServiceWord = core.TextRange{}
	if ast.IsClassDeclaration(service) && service.Name() != nil && ast.IsIdentifier(service.Name()) && service.Name().Text() != "" {
		p.reparseList = append(p.reparseList, p.vibelangRpcGroup(schema, service, modifiers))
	}
	return service
}

// vibelangServiceHead returns the start of a service declaration's head: the
// schema of a schema service, or word, its service.
func (p *Parser) vibelangServiceHead(word core.TextRange) int {
	if schema := p.vibelangSchemaServiceWord; schema.End() > schema.Pos() {
		return schema.Pos()
	}
	return word.Pos()
}

// IsSchemaServiceGroup reports whether node is the Rpc group class the
// parser writes for a schema service: a class that extends a call of the
// intrinsic RpcGroup's make.
func IsSchemaServiceGroup(node *ast.Node) bool {
	return SchemaServiceGroupCall(node) != nil
}

// SchemaServiceGroupCall returns the RpcGroup.make(…) call that node, a
// schema service's Rpc group class, extends, or nil for any other node.
func SchemaServiceGroupCall(node *ast.Node) *ast.Node {
	if node == nil || !ast.IsClassDeclaration(node) {
		return nil
	}
	extends := ast.GetClassExtendsHeritageElement(node)
	if extends == nil {
		return nil
	}
	call := extends.Expression()
	if call == nil || !ast.IsCallExpression(call) || !ast.IsPropertyAccessExpression(call.Expression()) {
		return nil
	}
	object := call.Expression().Expression()
	if !ast.IsIdentifier(object) || object.Text() != "RpcGroup" || object.Flags&ast.NodeFlagsVibeLangIntrinsic == 0 {
		return nil
	}
	return call
}

// vibelangRpcGroup writes the Rpc group class of service, a schema service
// whose schema keyword is at schema, with the service's export modifier.
func (p *Parser) vibelangRpcGroup(schema core.TextRange, service *ast.Node, modifiers *ast.ModifierList) *ast.Node {
	name := service.Name()
	anchor := name.Loc
	var rpcs []*ast.Node
	if ast.GetClassExtendsHeritageElement(service) == nil { // service Name: Type has no members to read
		counts := map[string]int{}
		for _, member := range service.Members() {
			if key, ok := vibelangRpcMemberName(member); ok {
				counts[key]++
			}
		}
		for _, member := range service.Members() {
			if key, ok := vibelangRpcMemberName(member); ok && counts[key] == 1 {
				if rpc := p.vibelangRpc(member, key); rpc != nil {
					rpcs = append(rpcs, rpc)
				}
			}
		}
	}
	span := anchor
	if len(rpcs) != 0 {
		span = core.NewTextRange(rpcs[0].Pos(), rpcs[len(rpcs)-1].End())
	}
	// The callee stands on the blanks before the name, on one line, so the
	// printer keeps RpcGroup.make together (vibelangCalleeAnchor).
	at := p.vibelangCalleeAnchor(anchor)
	group := p.vibelangIntrinsic("RpcGroup", at)
	callee := p.vibelangSynthesized(p.factory.NewPropertyAccessExpression(group, nil /*questionDotToken*/, p.vibelangSynthesized(p.factory.NewIdentifier("make"), at), ast.NodeFlagsNone), at)
	call := p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, p.newNodeList(span, rpcs), ast.NodeFlagsNone), span)
	base := p.vibelangSpanning(p.factory.NewExpressionWithTypeArguments(call, nil /*typeArguments*/), span)
	clause := p.vibelangSpanning(p.factory.NewHeritageClause(ast.KindExtendsKeyword, p.newNodeList(span, []*ast.Node{base})), span)

	var groupModifiers *ast.ModifierList
	if modifiers != nil {
		var copies []*ast.Node
		for _, modifier := range modifiers.Nodes {
			// export default service is rejected where it is written, and a
			// decorator stays on the service for its native grammar error.
			if modifier.Kind == ast.KindExportKeyword {
				copies = append(copies, p.vibelangSynthesized(p.factory.NewModifier(modifier.Kind), schema))
			}
		}
		if len(copies) != 0 {
			groupModifiers = p.newModifierList(schema, copies)
		}
	}
	groupName := p.vibelangSynthesized(p.factory.NewIdentifier(name.Text()+SchemaServiceGroupSuffix), anchor)
	members := p.newNodeList(core.NewTextRange(schema.End(), schema.End()), nil)
	class := p.factory.NewClassDeclaration(groupModifiers, groupName, nil /*typeParameters*/, p.newNodeList(span, []*ast.Node{clause}), members)
	return p.vibelangSynthesized(class, schema)
}

// vibelangRpcMemberName returns the name of member when it is an instance
// method of a service body with a plain name.
func vibelangRpcMemberName(member *ast.Node) (string, bool) {
	if !ast.IsMethodDeclaration(member) || ast.HasSyntacticModifier(member, ast.ModifierFlagsStatic) {
		return "", false
	}
	name := member.Name()
	if name == nil || !ast.IsIdentifier(name) && !ast.IsStringLiteral(name) {
		return "", false
	}
	return name.Text(), true
}

// SchemaServiceReturn reads the return type of a schema service's member as
// the mapping does: its success type, its error type, and whether it is a
// Stream. ok is false for a type that is not written as an Effect or a
// Stream.
func SchemaServiceReturn(typeNode *ast.Node) (success *ast.Node, failure *ast.Node, stream bool, ok bool) {
	for typeNode != nil && typeNode.Kind == ast.KindParenthesizedType {
		typeNode = typeNode.AsParenthesizedTypeNode().Type
	}
	if typeNode == nil || typeNode.Kind != ast.KindTypeReference {
		return nil, nil, false, false
	}
	reference := typeNode.AsTypeReferenceNode()
	module := ""
	switch name := reference.TypeName; {
	case ast.IsIdentifier(name):
		module = name.Text()
	case ast.IsQualifiedName(name) && ast.IsIdentifier(name.AsQualifiedName().Left) && name.AsQualifiedName().Left.Text() == name.AsQualifiedName().Right.Text():
		module = name.AsQualifiedName().Right.Text()
	}
	if module != "Effect" && module != "Stream" || reference.TypeArguments == nil || len(reference.TypeArguments.Nodes) == 0 || len(reference.TypeArguments.Nodes) > 3 {
		return nil, nil, false, false
	}
	arguments := reference.TypeArguments.Nodes
	success = arguments[0]
	if len(arguments) > 1 {
		failure = arguments[1]
	}
	return success, failure, module == "Stream", true
}

// SchemaServiceRequirements returns the written requirements of a schema
// service member's return type, its third channel, or nil.
func SchemaServiceRequirements(typeNode *ast.Node) *ast.Node {
	for typeNode != nil && typeNode.Kind == ast.KindParenthesizedType {
		typeNode = typeNode.AsParenthesizedTypeNode().Type
	}
	if typeNode == nil || typeNode.Kind != ast.KindTypeReference {
		return nil
	}
	if arguments := typeNode.AsTypeReferenceNode().TypeArguments; arguments != nil && len(arguments.Nodes) == 3 {
		return arguments.Nodes[2]
	}
	return nil
}

// IsSchemaServiceTransportError reports whether typeNode, a member of a
// schema service member's error type, is written RpcClientError or
// RpcClientError.RpcClientError.
func IsSchemaServiceTransportError(typeNode *ast.Node) bool {
	for typeNode != nil && typeNode.Kind == ast.KindParenthesizedType {
		typeNode = typeNode.AsParenthesizedTypeNode().Type
	}
	if typeNode == nil || typeNode.Kind != ast.KindTypeReference || typeNode.AsTypeReferenceNode().TypeArguments != nil {
		return false
	}
	switch name := typeNode.AsTypeReferenceNode().TypeName; {
	case ast.IsIdentifier(name):
		return name.Text() == SchemaServiceTransportError
	case ast.IsQualifiedName(name):
		q := name.AsQualifiedName()
		return ast.IsIdentifier(q.Left) && q.Left.Text() == SchemaServiceTransportError && q.Right.Text() == SchemaServiceTransportError
	}
	return false
}

// SchemaServiceDeclaresTransportError reports whether failure, a schema
// service member's error type, lists Effect's RpcClientError.
func SchemaServiceDeclaresTransportError(failure *ast.Node) bool {
	if failure == nil {
		return false
	}
	for _, member := range vibelangSchemaUnionMembers(failure) {
		if IsSchemaServiceTransportError(member) {
			return true
		}
	}
	return false
}

// SchemaServiceParameter reports whether parameter can be a payload field: a
// plain name that is neither a rest parameter nor this.
func SchemaServiceParameter(parameter *ast.Node) bool {
	name := parameter.Name()
	return name != nil && ast.IsIdentifier(name) && name.Text() != "this" && parameter.AsParameterDeclaration().DotDotDotToken == nil
}

// vibelangRpc writes Rpc.make("name", { payload, success, error, stream })
// for member, a method of a schema service named name, or returns nil when
// the mapping cannot read it.
func (p *Parser) vibelangRpc(member *ast.Node, name string) *ast.Node {
	if len(member.TypeParameters()) != 0 || member.Body() != nil || member.Type() == nil {
		return nil
	}
	success, failure, stream, ok := SchemaServiceReturn(member.Type())
	if !ok {
		return nil
	}
	for _, parameter := range member.Parameters() {
		if !SchemaServiceParameter(parameter) {
			return nil
		}
	}
	anchor := member.Name().Loc
	property := func(key string, value *ast.Node) *ast.Node {
		id := p.vibelangSynthesized(p.factory.NewIdentifier(key), anchor)
		return p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, id, nil /*postfixToken*/, nil /*typeNode*/, value), core.NewTextRange(min(anchor.Pos(), value.Pos()), max(anchor.End(), value.End())))
	}

	var fields []*ast.Node
	for _, parameter := range member.Parameters() {
		written := parameter.Name()
		var value *ast.Node
		switch declaration := parameter.AsParameterDeclaration(); {
		case declaration.Type == nil:
			value = p.vibelangUnsupportedSchema(written.Loc)
		case declaration.QuestionToken != nil:
			value = p.vibelangOptionalSchema(p.vibelangTypeCopy(declaration.Type), declaration.QuestionToken.Loc, false /*tuple*/)
		default:
			value = p.vibelangSchemaOf(p.vibelangTypeCopy(declaration.Type))
		}
		key := p.vibelangSchemaPropertyName(p.vibelangSynthesized(p.factory.NewIdentifier(written.Text()), written.Loc))
		fields = append(fields, p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, key, nil /*postfixToken*/, nil /*typeNode*/, value), core.NewTextRange(min(written.Pos(), value.Pos()), max(written.End(), value.End()))))
	}
	payloadSpan := anchor
	if len(fields) != 0 {
		payloadSpan = core.NewTextRange(fields[0].Pos(), fields[len(fields)-1].End())
	}
	options := []*ast.Node{property("payload", p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(payloadSpan, fields), false /*multiLine*/), payloadSpan))}

	if success != nil && success.Kind != ast.KindVoidKeyword {
		options = append(options, property("success", p.vibelangRpcSchema(success)))
	}
	if failure != nil {
		var sent []*ast.Node
		for _, alternative := range vibelangSchemaUnionMembers(failure) {
			if !IsSchemaServiceTransportError(alternative) && alternative.Kind != ast.KindNeverKeyword {
				sent = append(sent, alternative)
			}
		}
		switch len(sent) {
		case 0:
		case 1:
			options = append(options, property("error", p.vibelangRpcSchema(sent[0])))
		default:
			copies := make([]*ast.Node, len(sent))
			for i, alternative := range sent {
				copies[i] = p.vibelangTypeCopy(alternative)
			}
			union := p.vibelangSpanning(p.factory.NewUnionTypeNode(p.newNodeList(failure.Loc, copies)), failure.Loc)
			options = append(options, property("error", p.vibelangSchemaOf(union)))
		}
	}
	if stream {
		// The last option stands on the end of the return type, so the options
		// stay in source order and the list does not seem to end in a comma.
		last := core.NewTextRange(member.Type().End()-1, member.Type().End())
		id := p.vibelangSynthesized(p.factory.NewIdentifier("stream"), last)
		options = append(options, p.vibelangSpanning(p.factory.NewPropertyAssignment(nil /*modifiers*/, id, nil /*postfixToken*/, nil /*typeNode*/, p.vibelangSynthesized(p.factory.NewKeywordExpression(ast.KindTrueKeyword), last)), last))
	}

	span := anchor
	for _, option := range options {
		span = core.NewTextRange(min(span.Pos(), option.Pos()), max(span.End(), option.End()))
	}
	object := p.vibelangSpanning(p.factory.NewObjectLiteralExpression(p.newNodeList(core.NewTextRange(options[0].Pos(), max(options[0].End(), options[len(options)-1].End())), options), false /*multiLine*/), span)
	tag := p.vibelangSynthesized(p.factory.NewStringLiteral(name, ast.TokenFlagsNone), anchor)
	at := p.vibelangCalleeAnchor(anchor)
	rpc := p.vibelangIntrinsic("Rpc", at)
	callee := p.vibelangSynthesized(p.factory.NewPropertyAccessExpression(rpc, nil /*questionDotToken*/, p.vibelangSynthesized(p.factory.NewIdentifier("make"), at), ast.NodeFlagsNone), at)
	return p.vibelangSpanning(p.factory.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, p.newNodeList(span, []*ast.Node{tag, object}), ast.NodeFlagsNone), span)
}

// vibelangRpcSchema returns the schema of typeNode, a success or error type
// of a schema service's member: never is Schema.Never, and any other type
// maps as a field's does.
func (p *Parser) vibelangRpcSchema(typeNode *ast.Node) *ast.Node {
	for typeNode.Kind == ast.KindParenthesizedType {
		typeNode = typeNode.AsParenthesizedTypeNode().Type
	}
	if typeNode.Kind == ast.KindNeverKeyword {
		return p.vibelangSchemaMember(nil, "Never", p.vibelangCalleeAnchor(typeNode.Loc))
	}
	return p.vibelangSchemaOf(p.vibelangTypeCopy(typeNode))
}

// vibelangTypeCopy returns a copy of typeNode at the same positions, for the
// schema the mapping writes from it: vibelangSchemaOf takes the nodes it is
// given into the schema, and the service's member keeps its own.
func (p *Parser) vibelangTypeCopy(typeNode *ast.Node) *ast.Node {
	copied := p.factory.DeepCloneReparse(typeNode)
	// The copy stands for written source: the checker reads a name in it as
	// the schema it names, which a reparsed node is exempt from.
	copied.Flags &^= ast.NodeFlagsReparsed
	return copied
}
