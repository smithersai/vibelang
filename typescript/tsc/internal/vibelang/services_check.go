package vibelang

import (
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Checks of service and control classes (design D1, D2): a member without a
// full contract (EK9205), a key that two services share (EK3001), and a
// service used as a base class (EK3002, EK3003, EK3004), declared generic
// (EK3005), or with a static member that shadows a service member (EK9208).

func init() { fileChecks = append(fileChecks, checkServices) }

func checkServices(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch {
		case ast.IsClassDeclaration(node) || ast.IsClassExpression(node):
			checkServiceDeclaration(c, node)
			checkExtendsService(c, node)
		case ast.IsNewExpression(node):
			if service := serviceNamedBy(c, node.Expression()); service != nil {
				report(c, node, EK3003, service.Name().Text())
				cover(c, node) // TS2511: an abstract class cannot be instantiated
			}
		case ast.IsBinaryExpression(node) && node.AsBinaryExpression().OperatorToken.Kind == ast.KindInstanceOfKeyword:
			if service := serviceNamedBy(c, node.AsBinaryExpression().Right); service != nil {
				report(c, node, EK3004, service.Name().Text())
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
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
		if member.Body() != nil || ast.IsPropertyDeclaration(member) && member.Initializer() != nil {
			d := report(c, member.Name(), EK9207, scanner.GetTextOfNode(member.Name()), word)
			note(d, "Implement it in a layer, or make it static to keep it on the class.")
		}
	}
}

// checkShapeDeclarationMembers reports EK9207 for each instance member of a
// service of any shape (D281), service Search: SearchApi { ... }: the shape
// is the written type, so the body holds only static members, such as a
// layer. A member without a body is reported too, since it adds nothing to
// the shape.
func checkShapeDeclarationMembers(c *checker.Checker, class *ast.Node, shape *ast.Node) {
	for _, member := range class.Members() {
		if ast.HasStaticModifier(member) || member.Name() == nil {
			continue
		}
		d := report(c, member.Name(), EK9207.With("{0} is an instance member, but service {1}: {2} takes its members from {2}."), scanner.GetTextOfNode(member.Name()), class.Name().Text(), scanner.GetTextOfNode(shape))
		note(d, "Declare the member in {0}, or make it static to keep it on the class.", scanner.GetTextOfNode(shape))
	}
}

// checkServiceDeclaration reports EK9205, EK3001, EK3005, and EK9208 for
// class, if it declares a service or a control operation.
func checkServiceDeclaration(c *checker.Checker, class *ast.Node) {
	checkDeclarationMembers(c, class)
	kind := shapeKindOf(class)
	if kind == ordinaryClass {
		return
	}
	if reference := serviceShapeSelfReference(c, class); reference != nil {
		d := report(c, serviceShape(class), EK9207.With("A service's shape cannot refer to the service itself."))
		note(d, "Name the implementation's type instead of the service key {0}.", class.Name().Text())
		cover(c, reference)
		return
	}
	for _, member := range class.Members() {
		if ast.IsStatic(member) && member.Name() != nil && member.Name().Text() == "key" {
			if _, written := writtenKey(class); written == nil {
				report(c, member, EK3008)
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
		memberName := member.Name()
		if memberName == nil || !ast.IsIdentifier(memberName) {
			continue
		}
		if ast.IsStatic(member) {
			if instance[memberName.Text()] {
				note(report(c, memberName, EK9208, memberName.Text()), "Rename one: {0}.{1} would call the service member.", name, memberName.Text())
			}
			continue
		}
		if ast.IsMethodDeclaration(member) && serviceShape(class) == nil && !isEffectContract(c, member.Type()) && !isUnresolved(c, member.Type()) {
			at := member.Type()
			if at == nil {
				at = memberName
				cover(c, memberName) // TS7010: an implicit any return type
			}
			d := report(c, at, EK9205, name+"."+memberName.Text())
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
	if service == nil {
		return
	}
	d := report(c, extends.Expression(), EK3002)
	name := "Implementation"
	if class.Name() != nil {
		name = class.Name().Text()
	}
	note(d, "Implement it instead: class {0} implements {1}.Shape { … }", name, service.Name().Text())
	// TypeScript's complaints about inherited abstract members restate this.
	cover(c, extends.Parent)
	if class.Name() != nil {
		cover(c, class.Name())
	}
}

// serviceNamedBy returns the declaration of the service or control class
// that expr names, following imports, or nil.
func serviceNamedBy(c *checker.Checker, expr *ast.Node) *ast.Node {
	if !ast.IsIdentifier(expr) && !ast.IsPropertyAccessExpression(expr) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(expr)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil || classKindOf(symbol.ValueDeclaration()) == ordinaryClass {
		return nil
	}
	return symbol.ValueDeclaration()
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
