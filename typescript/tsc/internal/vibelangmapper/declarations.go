package vibelangmapper

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Declarations and contracts (rule 2). Each VibeLang declaration projects to
// the TypeScript the fork's declaration files print for it, so a hover and
// a .d.ts read the same in both.

// isErrorDeclaration reports whether node is an error declaration, which
// the parser reads as a class whose base it writes (D126, D278, D279).
func isErrorDeclaration(node *ast.Node) bool {
	return errorClassFormOf(node) != errorClassNone
}

// extendsElement returns the single extends element of class, or nil.
func extendsElement(class *ast.Node) *ast.Node {
	clauses := class.AsClassDeclaration().HeritageClauses
	if clauses == nil || len(clauses.Nodes) != 1 || clauses.Nodes[0].AsHeritageClause().Token != ast.KindExtendsKeyword {
		return nil
	}
	types := clauses.Nodes[0].AsHeritageClause().Types
	if types == nil || len(types.Nodes) != 1 {
		return nil
	}
	return types.Nodes[0]
}

// errorDeclaration lowers `error Name { fields }` to the class it
// abbreviates, `class Name extends TaggedError("Name")<{ fields }> {}`, with
// the runtime's TaggedError (D3). The fields are readonly unless written
// mutable (D134), as the parser reads them.
func (p *projector) errorDeclaration(node *ast.Node) {
	if errorClassFormOf(node) != errorClassRoot || hasClassFeatures(node) {
		p.errorClassDeclaration(node) // errors.go
		return
	}
	class := node.AsClassDeclaration()
	name := class.Name()
	keywordStart, ok := p.keywordBefore(name, "error")
	if !ok {
		p.unprojected(node)
		return
	}
	p.plan.replace(keywordStart, name.Pos(), "class")
	head := name.End()
	if class.TypeParameters != nil {
		p.visitList(class.TypeParameters.Nodes, env{})
		closing := scanner.SkipTrivia(p.text, class.TypeParameters.End())
		if closing >= len(p.text) || p.text[closing] != '>' {
			p.unprojected(node)
			return
		}
		head = closing + 1
	}
	tag := strconv.Quote(name.Text())
	fields := extendsElement(node).TypeArguments()[0]
	if fields.Flags&ast.NodeFlagsReparsed == 0 {
		for _, member := range fields.Members() {
			if member.Name() != nil && member.Name().Text() == "_tag" && member.Type() != nil {
				// A family's base declares its tag type (D304).
				tag += " as " + p.text[p.tokenStart(member.Type()):member.Type().End()]
			}
		}
	}
	base := "extends " + p.names.prelude("TaggedError") + "(" + tag + ")<"
	open := p.errorBodyOpen(node, head)
	if open < 0 {
		// error Timeout: no fields were written.
		p.plan.insert(head, " "+base+"{}> {}")
		return
	}
	// The braces of the body are the braces of the fields' type literal.
	p.plan.insert(open-1, base)
	if fields.Flags&ast.NodeFlagsReparsed == 0 {
		p.visit(fields, env{})
	}
	p.plan.insert(node.End(), "> {}")
}

// keywordBefore returns the start of word when it is the token right
// before name, as the declaration keyword of `error Name` or `layer Name`.
// A name's leading trivia starts right after the keyword.
func (p *projector) keywordBefore(name *ast.Node, word string) (int, bool) {
	end := name.Pos()
	start := end - len(word)
	return start, start >= 0 && p.text[start:end] == word
}

// isServiceClass reports whether node declares a service or a control (D1,
// D2, D128): a class, abstract, with no type parameters, no implements
// clause, and either no extends clause or `extends Control`, whose instance
// members, at least one, are all abstract methods or properties. The
// service and control keywords parse to such a class; so does a D1 abstract
// class written out. This is the fork's classKindOf, read from syntax.
func isServiceClass(node *ast.Node) bool {
	if node.Kind != ast.KindClassDeclaration || node.Name() == nil || node.TypeParameters() != nil ||
		!ast.HasSyntacticModifier(node, ast.ModifierFlagsAbstract) || len(ast.GetImplementsHeritageClauseElements(node)) != 0 {
		return false
	}
	if !isServiceKeywordClass(node) && ast.GetClassExtendsHeritageElement(node) == nil {
		return false
	}
	if extends := ast.GetClassExtendsHeritageElement(node); extends != nil {
		expression := extends.Expression()
		if !ast.IsIdentifier(expression) || expression.Text() != "Control" || extends.TypeArguments() != nil {
			return false
		}
	}
	instance := 0
	for _, member := range node.Members() {
		if ast.IsSemicolonClassElement(member) || ast.IsStatic(member) {
			continue
		}
		if !ast.IsMethodDeclaration(member) && !ast.IsPropertyDeclaration(member) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsAbstract) {
			return false
		}
		instance++
	}
	return instance > 0 || isServiceKeywordClass(node)
}

// serviceDeclaration lowers a service, a control, or a D1 abstract class to
// what the fork's declaration file prints for it (D45, D40 for a service
// with a static default, whose base is $reference):
//
//	service Users { find(id: string): User!NotFound }
//	interface Users { find(id: string): Effect.Effect<User, NotFound, never>; readonly "~vibelang/service"?: "app/main#Users" }
//	abstract class Users extends $service<Users>("app/main#Users") {}
//
// The interface is the service's shape, branded with its key so that two
// services with the same members stay distinct requirements; the class is
// its Context key. Instance members move to the interface without abstract;
// static members stay in the class. A control's `extends Control` goes, as
// the fork ignores it: a control's key is a service key too.
func (p *projector) serviceDeclaration(node *ast.Node) {
	class := node.AsClassDeclaration()
	name := class.Name()
	key := p.serviceKey(node)

	// The head: everything from the declaration keyword to the name becomes
	// `interface`, keeping written modifiers other than abstract.
	// A written abstract modifier is part of the replaced head; it comes
	// after export and declare.
	headStart := p.tokenStart(node)
	var kept []string
	if modifiers := node.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if modifier.Flags&ast.NodeFlagsReparsed != 0 || modifier.Kind == ast.KindAbstractKeyword {
				continue
			}
			headStart = modifier.End()
			kept = append(kept, scanner.TokenToString(modifier.Kind))
		}
	}
	keywordStart := scanner.SkipTrivia(p.text, headStart)
	p.plan.replace(keywordStart, name.Pos(), "interface")
	// `extends Control` written out goes; the control keyword's is synthesized.
	if clauses := class.HeritageClauses; clauses != nil && len(clauses.Nodes) > 0 && clauses.Nodes[0].Flags&ast.NodeFlagsReparsed == 0 {
		p.plan.replace(name.End(), clauses.End(), "")
	}
	members := node.Members()
	var static []*ast.Node
	var lastInstance *ast.Node
	for _, member := range members {
		if ast.IsStatic(member) {
			static = append(static, member)
			continue
		}
		if ast.IsSemicolonClassElement(member) {
			continue
		}
		if len(static) > 0 {
			// An instance member after a static one would need a second
			// interface; keep the file well-formed and say so.
			p.unprojected(member)
			return
		}
		p.abstractMember(member)
		lastInstance = member
	}
	closing := node.End() - 1
	if closing < 0 || p.text[closing] != '}' {
		p.unprojected(node)
		return
	}
	separator := "; "
	if lastInstance == nil || strings.ContainsAny(p.text[lastInstance.End()-1:lastInstance.End()], ";,") {
		separator = " "
	}
	brand := separator + `readonly "~vibelang/service"?: ` + strconv.Quote(key) + " }"
	base := "service"
	if hasDefaultValue(node) {
		base = "reference"
	}
	classHead := " " + strings.Join(append(kept, "abstract class "+name.Text()+" extends "), " ")
	at := closing
	if lastInstance != nil {
		at = lastInstance.End()
	} else if len(static) > 0 {
		at = p.tokenStart(static[0])
	}
	p.plan.insert(at, brand+classHead)
	// The key: $service<X>(key), or for a static default $reference, whose
	// executable form passes () => X.default.
	p.plan.markFields(editServiceBase, partWhole, at, at, base, key, name.Text())
	p.plan.insert(at, " {")
	if len(static) == 0 {
		p.plan.replace(at, closing, "")
	}
	for _, member := range static {
		p.visit(member, env{})
	}
	if isControlClass(node) {
		// A control registers its operations with the kernel (D2): the
		// executable rendering writes $control(X, operations, arities).
		fields := []string{name.Text()}
		for _, member := range members {
			if ast.IsStatic(member) || !ast.IsMethodDeclaration(member) || member.Name() == nil {
				continue
			}
			arity := strconv.Itoa(len(member.Parameters()))
			for _, parameter := range member.Parameters() {
				if parameter.AsParameterDeclaration().DotDotDotToken != nil {
					arity = "-1"
				}
			}
			fields = append(fields, member.Name().Text(), arity)
		}
		p.plan.markFields(editControl, partWhole, node.End(), node.End(), fields...)
	}
}

// isControlClass reports whether class, a service class, declares a
// control: it extends Control, written or written as the control keyword.
func isControlClass(class *ast.Node) bool {
	extends := ast.GetClassExtendsHeritageElement(class)
	return extends != nil && ast.IsIdentifier(extends.Expression()) && extends.Expression().Text() == "Control"
}

// isServiceKeywordClass reports whether node is a service or control
// keyword whose class is no service: one without instance members, which
// the fork reads as an ordinary abstract class.
func isServiceKeywordClass(node *ast.Node) bool {
	if node.Kind != ast.KindClassDeclaration || node.Name() == nil || node.Modifiers() == nil {
		return false
	}
	for _, modifier := range node.Modifiers().Nodes {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			return true
		}
	}
	return false
}

// serviceKeywordClass lowers `service Name { }` that declares no service to
// `abstract class Name { }`, and `control Name { }` to one that extends the
// prelude's Control.
func (p *projector) serviceKeywordClass(node *ast.Node) {
	name := node.Name()
	headStart := p.tokenStart(node)
	for _, modifier := range node.Modifiers().Nodes {
		if modifier.Flags&ast.NodeFlagsReparsed == 0 {
			headStart = modifier.End()
		}
	}
	p.plan.replace(scanner.SkipTrivia(p.text, headStart), name.Pos(), "abstract class")
	if clauses := node.AsClassDeclaration().HeritageClauses; clauses != nil && len(clauses.Nodes) > 0 && clauses.Nodes[0].Flags&ast.NodeFlagsReparsed != 0 {
		p.plan.insert(name.End(), " extends "+p.names.prelude("Control"))
	}
	p.visitList(node.Members(), env{})
}

// hasDefaultValue reports whether class declares `static readonly defaultValue`,
// which makes its key a Context.Reference that needs no provider (D40).
func hasDefaultValue(class *ast.Node) bool {
	for _, member := range class.Members() {
		if ast.IsPropertyDeclaration(member) && ast.IsStatic(member) && ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) {
			if name := member.Name(); name != nil && ast.IsIdentifier(name) && name.Text() == "defaultValue" {
				return true
			}
		}
	}
	return false
}

// abstractMember lowers an abstract member of a service to its interface
// member: abstract goes, and a property the parser made readonly gets a
// written readonly.
func (p *projector) abstractMember(member *ast.Node) {
	if modifiers := member.Modifiers(); modifiers != nil {
		readonly := false
		for _, modifier := range modifiers.Nodes {
			switch {
			case modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0:
				readonly = true
			case modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed == 0:
				p.plan.replace(p.tokenStart(modifier), scanner.SkipTrivia(p.text, modifier.End()), "")
			}
		}
		if readonly {
			p.plan.insert(p.tokenStart(member.Name()), "readonly ")
		}
	}
	member.ForEachChild(func(child *ast.Node) bool {
		if !ast.IsModifier(child) {
			p.visit(child, env{})
		}
		return false
	})
}

// isLayerDeclaration reports whether node is a `layer Name: Service { ... }`
// declaration, which the parser reads as a const whose initializer is a
// synthesized Layer.succeed or Layer.effect call.
func isLayerDeclaration(node *ast.Node) bool {
	if node.Kind != ast.KindVariableStatement {
		return false
	}
	declarations := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes
	if len(declarations) != 1 {
		return false
	}
	call := declarations[0].Initializer()
	if call == nil || call.Kind != ast.KindCallExpression || len(call.Arguments()) != 2 {
		return false
	}
	callee := call.Expression()
	return callee.Kind == ast.KindPropertyAccessExpression && callee.Flags&ast.NodeFlagsReparsed != 0 &&
		callee.Expression().Kind == ast.KindIdentifier && callee.Expression().Text() == "Layer"
}

// layerDeclaration lowers a layer declaration to the layer it abbreviates:
//
//	layer UsersLive: Users { const d = Directory(); find(id) { ... }; readonly region = "eu" }
//	const UsersLive = Layer.effect(Users, $gen(function* () { const d = ...; return { find(id) { ... }, region: "eu" } }))
//
// Without statements it is Layer.succeed(Users, { ... }). Methods are Effect
// functions, because every member of a service is an Effect contract (D92,
// D128); the service's shape types their parameters.
func (p *projector) layerDeclaration(node *ast.Node) {
	declaration := node.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0]
	name := declaration.Name()
	call := declaration.Initializer()
	method := call.Expression().Name().Text()
	service, implementation := call.Arguments()[0], call.Arguments()[1]
	keywordStart, ok := p.keywordBefore(name, "layer")
	if !ok {
		p.unprojected(node)
		return
	}
	brace := scanner.SkipTrivia(p.text, service.End())
	closing := node.End() - 1
	if brace >= len(p.text) || p.text[brace] != '{' || closing <= brace || p.text[closing] != '}' {
		p.unprojected(node)
		return
	}
	layer := p.names.prelude("Layer")
	p.plan.replace(keywordStart, name.Pos(), "const")
	p.plan.replace(name.End(), p.tokenStart(service), " = "+layer+"."+method+"(")
	p.visit(service, env{})
	object := implementation
	inner := env{}
	if method == "effect" {
		p.plan.replace(service.End(), brace, ", ")
		p.plan.mark(editProgram, partOpen, brace, brace, "")
		block := implementation.Body()
		statements := block.Statements()
		returned := statements[len(statements)-1]
		inner = newEffectEnv()
		p.visitList(statements[:len(statements)-1], inner)
		object = returned.Expression()
	} else {
		p.plan.replace(service.End(), brace, ", ")
	}
	members := object.AsObjectLiteralExpression().Properties.Nodes
	if method == "effect" && len(members) > 0 {
		p.plan.insert(p.tokenStart(members[0]), "return { ")
	}
	for i, member := range members {
		last := i == len(members)-1
		end := p.layerMember(member, inner)
		separator := ","
		if last {
			separator = ""
			if method == "effect" {
				separator = " }"
			}
		}
		if end < member.End() {
			// A value member's own semicolon becomes the separator.
			p.plan.replace(end, member.End(), separator)
		} else {
			p.plan.insert(end, separator)
		}
	}
	if method == "effect" {
		if len(members) == 0 {
			p.plan.insert(closing, "return {} ")
		}
		p.plan.mark(editProgram, partClose, closing+1, closing+1, "")
		p.plan.insert(closing+1, ")")
	} else {
		p.plan.insert(closing+1, ")")
	}
}

// layerMember lowers one member of a layer's implementation and returns
// where its separator goes: after a method's body, or after a value's
// initializer, before any semicolon the member was written with.
func (p *projector) layerMember(member *ast.Node, e env) int {
	switch member.Kind {
	case ast.KindMethodDeclaration:
		if member.AsMethodDeclaration().AsteriskToken != nil || member.Body() == nil {
			p.unprojected(member)
			return member.End()
		}
		p.functionLike(member, member.Body())
		return member.End()
	case ast.KindPropertyAssignment:
		// readonly region = "eu"   region: "eu"
		start := p.tokenStart(member)
		name := member.Name()
		initializer := member.Initializer()
		if p.text[start:min(start+len("readonly"), len(p.text))] == "readonly" {
			p.plan.replace(start, p.tokenStart(name), "")
		}
		equals := scanner.SkipTrivia(p.text, name.End())
		if equals < len(p.text) && p.text[equals] == '=' {
			p.plan.replace(name.End(), equals+1, ":")
		}
		p.visit(initializer, e)
		return initializer.End()
	}
	p.visit(member, e)
	return member.End()
}

// readonlyMember lowers a property or index signature of an interface or an
// object type. In a .vibe file such a member is readonly unless written
// mutable (D134): the parser gives it a synthesized readonly modifier, which
// becomes written text, and consumes mutable, whose text goes.
func (p *projector) readonlyMember(member *ast.Node, e env) {
	start := p.tokenStart(member)
	readonly := false
	if modifiers := member.Modifiers(); modifiers != nil {
		for _, modifier := range modifiers.Nodes {
			if modifier.Kind == ast.KindReadonlyKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
				readonly = true
			}
		}
	}
	if readonly {
		p.plan.insert(start, "readonly ")
	} else if strings.HasPrefix(p.text[start:], "mutable") {
		next := scanner.SkipTrivia(p.text, start+len("mutable"))
		if next > start+len("mutable") && (member.Name() == nil || next <= p.tokenStart(member.Name())) {
			p.plan.replace(start, next, "")
		}
	}
	member.ForEachChild(func(child *ast.Node) bool {
		if !ast.IsModifier(child) {
			p.visit(child, e)
		}
		return false
	})
}

// isEffectType reports whether node is an Effect type written in the !
// form, which the parser reads as a reference to a synthesized
// Effect.Effect with three type arguments.
func isEffectType(node *ast.Node) bool {
	if node == nil || node.Kind != ast.KindTypeReference || node.Flags&ast.NodeFlagsReparsed != 0 {
		return false
	}
	name := node.AsTypeReferenceNode().TypeName
	return name.Kind == ast.KindQualifiedName && name.Flags&ast.NodeFlagsReparsed != 0 && len(node.TypeArguments()) == 3
}

// effectType lowers `A!E!R` to `Effect.Effect<A, E, R>`. Each ! becomes a
// comma, an empty or omitted slot becomes never, and an explicitly written
// infer channel becomes $Infer. With
// slotsOnly it writes only the three slots, for $contract's type arguments;
// a written Effect<A> or Effect<A, E> gets never for each slot it leaves out,
// as TypeScript's defaults give it (D308, D309).
func (p *projector) effectType(node *ast.Node, slotsOnly bool) {
	if slotsOnly && !isEffectType(node) {
		// Written Effect<A, E, R> contracts share D57's channel inference
		// with bang contracts; only their outer reference is discarded.
		slots := node.TypeArguments()
		p.plan.replace(p.tokenStart(node), p.tokenStart(slots[0]), "")
		for _, slot := range slots {
			if slot.Kind == ast.KindInferType {
				p.plan.replace(p.tokenStart(slot), slot.End(), helperRef("$Infer"))
			} else {
				p.visit(slot, env{})
			}
		}
		p.plan.replace(slots[len(slots)-1].End(), node.End(), strings.Repeat(", never", max(0, 3-len(slots))))
		return
	}
	slots := node.TypeArguments()
	result := slots[0]
	if !slotsOnly {
		p.plan.insert(p.tokenStart(result), p.names.prelude("Effect")+".Effect<")
	}
	p.visit(result, env{})
	previous := result
	for _, slot := range slots[1:] {
		bang := scanner.SkipTrivia(p.text, previous.End())
		hasBang := bang < len(p.text) && p.text[bang] == '!'
		synthesized := slot.Flags&ast.NodeFlagsReparsed != 0
		switch {
		case !synthesized && hasBang:
			// A written slot: User!NotFound, or User!infer E.
			p.plan.replace(bang, bang+1, ", ")
			if slot.Kind == ast.KindInferType {
				p.plan.replace(p.tokenStart(slot), slot.End(), helperRef("$Infer"))
			} else {
				p.visit(slot, env{})
			}
		case synthesized && hasBang && slot.Pos() == bang:
			// An empty slot stands on its own !: User!!Db.
			p.plan.replace(bang, bang+1, ", never")
		case synthesized:
			// Omitted dependencies stand on the errors' last character: User!NotFound.
			p.plan.insert(previous.End(), ", never")
		default:
			p.unprojected(slot)
		}
		previous = slot
	}
	if !slotsOnly {
		p.plan.insert(node.End(), ">")
	}
}

// serviceKey mirrors the native compiler literal key override (VIP-9).
func (p *projector) serviceKey(class *ast.Node) string {
	for _, member := range class.Members() {
		if ast.IsPropertyDeclaration(member) && ast.IsStatic(member) && ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) && member.Name() != nil && member.Name().Text() == "key" && member.Initializer() != nil && ast.IsStringLiteralLike(member.Initializer()) {
			return member.Initializer().Text()
		}
	}
	return p.ctx.ModuleKey + "#" + class.Name().Text()
}
