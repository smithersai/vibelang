package vibelang

import (
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Checks of service and control classes (design D1, D2): a member without a
// full contract (EK9205), a key that two services share (EK3001), and a
// service used as a base class (EK3002, EK3003, EK3004), declared generic
// (EK3005), or with a static member that shadows a service member (EK9208).

// ek3004Pattern is EK3004 for a class pattern naming a service. {0} is the pattern's expression.
var ek3004Pattern = EK3004.With("A class pattern naming {0} is always false: implementations are plain objects; match their members instead, when { find: let find }.")

func init() { fileChecks = append(fileChecks, checkServices) }

func checkServices(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsClassDeclaration(node) || ast.IsClassExpression(node):
			checkServiceDeclaration(c, node)
			checkExtendsService(c, node)
		case ast.IsNewExpression(node):
			if name, ok := serviceKeyMisuseName(c, node.Expression()); ok {
				report(c, node, EK3003, name)
				cover(c, node) // TS2511: an abstract class cannot be instantiated
			}
		case ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword:
			if name, ok := serviceKeyMisuseName(c, node.AsBinaryExpression().Right); ok {
				report(c, node, EK3004, name)
			}
		case isPatternCall(node, "$is") || isPatternCall(node, "$extract"):
			// A class pattern, when Users: or when Users(…):, tests the subject
			// as instanceof does (chapter 005's static rules table).
			if matcher := node.Arguments()[0]; serviceNamedBy(c, matcher) != nil || serviceKeyOperand(c, c.GetTypeAtLocation(matcher)) {
				report(c, matcher, ek3004Pattern, scanner.GetTextOfNode(matcher))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	markDeclarationImports(c, file)
}

// markDeclarationImports marks the file's own import of a module that only
// its declaration file reads, through that import (D501): a service's base
// writes Context, and a schema error's writes Schema.
func markDeclarationImports(c *checker.Checker, file *ast.SourceFile) {
	service := declaresService(file)
	schemaError := core.Some(file.Statements.Nodes, func(statement *ast.Node) bool {
		form, _ := errorFormOf(statement)
		return form == errorFormSchemaRoot
	})
	for _, statement := range file.Statements.Nodes {
		if name := namespaceImportOfModule(statement); name == "Context" && service || name == "Schema" && schemaError {
			c.MarkSymbolReferenced(statement.ImportClause().AsImportClause().NamedBindings.Symbol())
		}
	}
}

// declarationWord returns "service" or "control" when class was declared with
// that word (D128): the parser gives such a class an abstract modifier that
// is not in the source.
func declarationWord(class *ast.Node) string {
	for _, modifier := range class.ModifierNodes() {
		if modifier.Kind == ast.KindAbstractKeyword && modifier.Flags&ast.NodeFlagsReparsed != 0 {
			if class.ClassLikeData().HeritageClauses != nil && serviceShape(class) == nil {
				return "control"
			}
			return "service"
		}
	}
	return ""
}

// checkDeclarationMembers reports EK9207 for each instance member of a service
// or control declaration that has a body or an initializer: the declaration
// would otherwise be an ordinary abstract class.
func checkDeclarationMembers(c *checker.Checker, class *ast.Node) {
	word := declarationWord(class)
	if word == "" {
		return
	}
	if shape := serviceShape(class); shape != nil {
		checkShapeDeclarationMembers(c, class, shape)
		return
	}
	for _, member := range class.Members() {
		if ast.HasStaticModifier(member) || member.Name() == nil {
			continue
		}
		if serviceContractClassSyntax(member) {
			report(c, member, serviceContractModifierDiagnostic)
			cover(c, member)
			continue
		}
		if member.Body() != nil || ast.IsPropertyDeclaration(member) && member.Initializer() != nil {
			diagnostic := EK9207
			if word == "service" {
				diagnostic = serviceImplementationMemberDiagnostic
			}
			d := report(c, member.Name(), diagnostic, scanner.GetTextOfNode(member.Name()), word)
			if word == "service" {
				cover(c, member)
				note(d, "Implement it in a layer.")
			} else {
				note(d, "Implement it in a layer, or make it static to keep it on the class.")
			}
		}
	}
}

// checkShapeDeclarationMembers admits only the reserved key/defaultValue
// properties of a whole-shape service. Specialized checks retain ownership
// of malformed reserved headers, constructors and index signatures.
func checkShapeDeclarationMembers(c *checker.Checker, class *ast.Node, shape *ast.Node) {
	for _, member := range class.Members() {
		if ast.IsSemicolonClassElement(member) || member.Kind == ast.KindConstructor || member.Kind == ast.KindIndexSignature {
			continue
		}
		if serviceReservedMemberError(member) != nil || checkServiceLiteralKey(c, class, member) {
			continue
		}
		if ast.IsPropertyDeclaration(member) && ast.IsStatic(member) &&
			ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) && member.Name() != nil &&
			ast.IsIdentifier(member.Name()) && member.Name().Text() == "defaultValue" &&
			member.Initializer() != nil && member.PostfixToken() == nil {
			continue
		}
		report(c, member, EK0902.With("A service with a written shape admits only static readonly key and static readonly defaultValue; the annotation supplies the whole shape."))
		cover(c, member)
	}
}

// checkServiceDeclaration reports EK9205, EK3001, EK3005, and EK9208 for
// class, if it declares a service or a control operation.
func checkServiceDeclaration(c *checker.Checker, class *ast.Node) {
	checkDeclarationMembers(c, class)
	kind := shapeKindOf(class)
	if kind == ordinaryClass {
		// A rejected body member can prevent service-shape synthesis. The
		// written key still has its independent VIP-9 member rule.
		if declarationWord(class) == "service" {
			for _, member := range class.Members() {
				checkServiceLiteralKey(c, class, member)
			}
			if class.TypeParameters() != nil {
				note(report(c, class.Name(), EK3005), "Use an interface for the generic type.")
			} else {
				checkServiceOuterTypeParameters(c, class)
			}
		}
		return
	}
	if reference := serviceShapeSelfReference(c, class); reference != nil {
		d := report(c, serviceShape(class), EK9207.With("A service's shape cannot refer to the service itself."))
		note(d, "Name the implementation's type instead of the service key {0}.", class.Name().Text())
		cover(c, reference)
		return
	}
	for _, member := range class.Members() {
		if serviceShape(class) == nil && ast.IsStatic(member) && !serviceStaticMemberRejected(class, member) && member.Name() != nil && ast.IsIdentifier(member.Name()) && member.Name().Text() == "key" {
			if checkServiceLiteralKey(c, class, member) {
				continue
			}
			if _, written := writtenKey(class); written == nil {
				report(c, member, EK0901)
			}
		}
	}
	name := class.Name().Text()
	if class.TypeParameters() != nil {
		note(report(c, class.Name(), EK3005), "Use an interface for the generic type.")
		if extends := ast.GetClassExtendsHeritageElement(class); extends != nil && serviceShape(class) != nil {
			cover(c, extends.Expression()) // TS2507: $service is not a class, as only a service's bases are hooked
		}
		return
	}
	if kind == serviceClass && checkServiceOuterTypeParameters(c, class) {
		return
	}
	s := servicesFor(c)
	if others := s.sharingKey(class); len(others) > 0 {
		d := report(c, class.Name(), EK3001, s.key(class))
		for _, other := range others {
			note(d, "{0} at {1} has the same key. Change one key.", other.Name().Text(), position(other.Name()))
		}
	}
	instance := map[string]bool{}
	for _, member := range class.Members() {
		if !ast.IsStatic(member) && member.Name() != nil && ast.IsIdentifier(member.Name()) {
			instance[member.Name().Text()] = true
		}
	}
	if shape := serviceShape(class); shape != nil {
		// service Search: SearchApi: the service members are SearchApi's.
		if t := c.GetTypeFromTypeNode(shape); t != nil && t.Flags()&checker.TypeFlagsObject != 0 {
			for _, property := range c.GetPropertiesOfType(t) {
				instance[property.Name()] = true
			}
		}
	}
	for _, member := range class.Members() {
		if serviceShape(class) == nil && serviceStaticMemberRejected(class, member) {
			report(c, member, serviceStaticMemberDiagnostic)
			cover(c, member)
			continue
		}
		memberName := member.Name()
		if memberName == nil || !ast.IsIdentifier(memberName) {
			continue
		}
		if ast.IsStatic(member) {
			if serviceShape(class) == nil && instance[memberName.Text()] && !(kind == serviceClass && serviceStaticIdentityMember(member)) {
				note(report(c, memberName, EK9208, memberName.Text()), "Rename one: {0}.{1} would call the service member.", name, memberName.Text())
			}
			continue
		}
		if kind == serviceClass && ast.IsMethodDeclaration(member) && serviceShape(class) == nil && !isServiceConstructSignature(class, member) {
			// A member is typed as in an interface. An omitted type follows
			// TypeScript: TS7010 under noImplicitAny, any otherwise, and
			// VibeLang adds no diagnostic of its own (005, VIP-9 amended).
			continue
		}
		if serviceContractClassSyntax(member) {
			continue // EK0902 already explains the invalid contract syntax.
		}
		if ast.IsMethodDeclaration(member) && serviceShape(class) == nil && (member.Body() == nil || declarationWord(class) != "service") && !isServiceConstructSignature(class, member) && !isEffectContract(c, member.Type()) && !isUnresolved(c, member.Type()) {
			at := member.Type()
			if at == nil {
				at = memberName
				cover(c, memberName) // TS7010: an implicit any return type
			}
			d := report(c, at, EK9205.With("{0} has no body to infer from, so its contract must be written as an Effect type."), name+"."+memberName.Text())
			note(d, "Write {0}; use {1} if it cannot fail and needs nothing.", bangText(writtenSuccess(member.Type()), "Errors", "Dependencies"), bangText(writtenSuccess(member.Type()), "never", "never"))
		}
	}
}

// isEffectContract reports whether typeNode, a return type annotation,
// states a contract: an Effect type, written A!E!R, Effect<A, E, R>, or as an
// alias of one. A type argument left out of Effect<...> means what it means
// in TypeScript, so Effect<A> is a contract that cannot fail and needs
// nothing (D309).
func isEffectContract(c *checker.Checker, typeNode *ast.Node) bool {
	return typeNode != nil && isEffectType(c, c.GetTypeFromTypeNode(typeNode))
}

// isUnresolved reports whether typeNode names a type the checker could not
// resolve, which TypeScript already reports.
func isUnresolved(c *checker.Checker, typeNode *ast.Node) bool {
	return typeNode != nil && c.GetTypeFromTypeNode(typeNode) == c.GetErrorType()
}

// writtenSuccess returns the text of the success type that typeNode, a
// return type annotation that is not a contract, states: the annotation
// itself, or A when there is none.
func writtenSuccess(typeNode *ast.Node) string {
	switch {
	case typeNode == nil:
		return "A"
	case ast.IsTypeReferenceNode(typeNode) && isEffectName(typeNode.AsTypeReferenceNode().TypeName):
		if arguments := typeNode.TypeArguments(); len(arguments) > 0 {
			return scanner.GetTextOfNode(arguments[0])
		}
		return "A"
	}
	return scanner.GetTextOfNode(typeNode)
}

// isEffectName reports whether name, a type reference's name, is Effect or
// a qualified name ending in Effect, such as Effect.Effect.
func isEffectName(name *ast.Node) bool {
	if ast.IsQualifiedName(name) {
		name = name.AsQualifiedName().Right
	}
	return name.Text() == "Effect"
}

// checkExtendsService reports EK3002 for a class that extends a service or a
// control operation: a service is a key, not a base class.
func checkExtendsService(c *checker.Checker, class *ast.Node) {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil {
		return
	}
	service := serviceNamedBy(c, extends.Expression())
	if service == nil && !serviceKeyOperand(c, c.GetTypeAtLocation(extends.Expression())) {
		return
	}
	d := report(c, extends.Expression(), EK3002)
	if service != nil {
		name := "Implementation"
		if class.Name() != nil {
			name = class.Name().Text()
		}
		note(d, "Implement it instead: class {0} implements {1}.Shape { … }", name, service.Name().Text())
	}
	// TypeScript's complaints about inherited abstract members restate this.
	cover(c, extends.Parent)
	if class.Name() != nil {
		cover(c, class.Name())
	}
}

// serviceKeyOperand recognizes key-only alternatives without assigning a
// single declaration identity to a union of distinct keys. Consumers that
// rewrite source continue to require serviceNamedBy's unambiguous identity.
func serviceKeyOperand(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	if t.Flags()&(checker.TypeFlagsTypeParameter|checker.TypeFlagsIndexedAccess) != 0 {
		bound := c.GetBaseConstraintOfType(t)
		if bound == nil || bound == t {
			return false
		}
		return serviceKeyOperand(c, bound)
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		if len(t.Types()) == 0 {
			return false
		}
		for _, part := range t.Types() {
			if !serviceKeyOperand(c, part) {
				return false
			}
		}
		return true
	}
	if symbol := t.Symbol(); symbol != nil && classKindOf(symbol.ValueDeclaration()) != ordinaryClass &&
		t != c.GetTypeOfSymbol(symbol) {
		return false
	}
	return serviceNamedByType(c, t) != nil
}

func serviceKeyMisuseName(c *checker.Checker, expr *ast.Node) (string, bool) {
	if expr == nil {
		return "", false
	}
	if service := serviceNamedBy(c, expr); service != nil {
		return service.Name().Text(), true
	}
	if serviceKeyOperand(c, c.GetTypeAtLocation(expr)) {
		return scanner.GetTextOfNode(expr), true
	}
	return "", false
}

// serviceNamedBy returns the declaration of the service or control class
// that expr denotes, following imports and typed value aliases, or nil.
func serviceNamedBy(c *checker.Checker, expr *ast.Node) *ast.Node {
	if expr == nil {
		return nil
	}
	symbol := c.GetSymbolAtLocation(expr)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol != nil && classKindOf(symbol.ValueDeclaration()) != ordinaryClass {
		return symbol.ValueDeclaration()
	}
	return serviceNamedByType(c, c.GetTypeAtLocation(expr))
}

// An intersection adds constraints to the same constructor value. Retain a
// service's declaration identity through each constituent, as for a typed alias.
func serviceNamedByType(c *checker.Checker, t *checker.Type) *ast.Node {
	if t == nil {
		return nil
	}
	if t.Flags()&(checker.TypeFlagsTypeParameter|checker.TypeFlagsIndexedAccess) != 0 {
		bound := c.GetBaseConstraintOfType(t)
		if bound == nil || bound == t {
			return nil
		}
		if symbol := bound.Symbol(); symbol != nil && classKindOf(symbol.ValueDeclaration()) != ordinaryClass &&
			bound != c.GetTypeOfSymbol(symbol) {
			return nil // the identifier type in R is not the key value
		}
		return serviceNamedByType(c, bound)
	}
	if symbol := t.Symbol(); symbol != nil && classKindOf(symbol.ValueDeclaration()) != ordinaryClass {
		return symbol.ValueDeclaration()
	}
	if t.Flags()&checker.TypeFlagsIntersection != 0 {
		for _, part := range t.Types() {
			if symbol := part.Symbol(); symbol != nil && classKindOf(symbol.ValueDeclaration()) != ordinaryClass &&
				part != c.GetTypeOfSymbol(symbol) {
				// A service identifier in R is not the key's value type.
				// Intersecting it with a callable or constructor does not
				// make that value an alias of the service key.
				continue
			}
			if service := serviceNamedByType(c, part); service != nil {
				return service
			}
		}
	}
	return nil
}

// sharingKey returns the other service and control classes in the program
// whose key is class's key.
func (s *services) sharingKey(class *ast.Node) []*ast.Node {
	if s.byKey == nil {
		s.byKey = map[string][]*ast.Node{}
		for _, file := range s.checker.Program().SourceFiles() {
			if !isVibeLangFile(file) {
				continue
			}
			var visit func(node *ast.Node) bool
			visit = func(node *ast.Node) bool {
				if classKindOf(node) != ordinaryClass {
					key := s.key(node)
					s.byKey[key] = append(s.byKey[key], node)
				}
				return node.ForEachChild(visit)
			}
			file.AsNode().ForEachChild(visit)
		}
	}
	var others []*ast.Node
	for _, other := range s.byKey[s.key(class)] {
		if other != class {
			others = append(others, other)
		}
	}
	return others
}

// position returns node's file name and line as file.vibe:12.
func position(node *ast.Node) string {
	file := ast.GetSourceFileOfNode(node)
	line := scanner.GetECMALineOfPosition(file, scanner.SkipTrivia(file.Text(), node.Pos()))
	return fmt.Sprintf("%s:%d", file.FileName().BaseName(), line+1)
}
