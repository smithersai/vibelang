package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Services and control operations (design D1, D2, D41, D45, D501).
//
// An abstract class in a .vibe file whose instance members are all abstract
// declares a service, and one that extends Control declares a control
// operation. A service is the class Effect TypeScript writes (D501):
//
//	class Users extends Context.Service<Users, {
//	  find(id: string): Effect<User, UserNotFound, never>
//	}>()("app/users#Users") {}
//
// As a type, Users is the service's identifier, the instance type of
// Effect's class, { readonly [ServiceTypeId]: …; readonly key:
// "app/users#Users"; readonly Service: Shape }: its key's literal type makes
// it nominal, so neither a structural type nor another service is assignable
// to it, and a requirement for Users is discharged only by a provider of
// Users. Users.Shape, Effect's Context.Service.Shape<typeof Users>, the
// members, is the type of an implementation: Layer.succeed(Users, …),
// Effect.provideService, and `implements Users` in a .vibe file check against
// it. As a value, Users is a Context key. In a .vibe function body,
// Users.find(id) calls a member through the key and Users() returns the
// implementation, typed as the shape, as `yield* Users` does. The key is
// derived (D93) unless the body writes static readonly key = "<key>".
//
// A control operation keeps one type for both, its interface, with an
// optional brand that keeps two controls with the same members distinct.

// serviceBrandProperty names the brand of a control operation's interface.
const serviceBrandProperty = "~vibelang/service"

// serviceKeyName names the static member that writes a service's key in its
// body, static readonly key = "<key>" (D501).
const serviceKeyName = "key"

// serviceShapeName names a service's shape as a member type of the service:
// Users.Shape, which declaration files write Context.Service.Shape<typeof
// Users> (D501).
const serviceShapeName = "Shape"

// contextServiceTypeID names the property that every Effect 4 Context key
// has: `readonly [ServiceTypeId]: ServiceTypeId`.
const contextServiceTypeID = "~effect/Context/Service"

type classKind uint8

const (
	ordinaryClass classKind = iota
	serviceClass            // an abstract class that declares a service (D1)
	controlClass            // an abstract class that extends Control (D2)
)

// classKindOf recognizes explicit services and control operations. Abstract
// classes otherwise keep TypeScript semantics (VIP-9).
func classKindOf(class *ast.Node) classKind {
	if class == nil || !ast.IsClassDeclaration(class) || class.TypeParameters() != nil {
		return ordinaryClass
	}
	return shapeKindOf(class)
}

// shapeKindOf is classKindOf without the rule against type parameters: it
// says what class would declare if it had none (EK3005).
func shapeKindOf(class *ast.Node) classKind {
	if class == nil || !ast.IsClassDeclaration(class) || class.Name() == nil ||
		!ast.HasSyntacticModifier(class, ast.ModifierFlagsAbstract) ||
		len(ast.GetImplementsHeritageClauseElements(class)) != 0 ||
		!isVibeLangFile(ast.GetSourceFileOfNode(class)) {
		return ordinaryClass
	}
	if declarationWord(class) == "" && ast.GetClassExtendsHeritageElement(class) == nil {
		return ordinaryClass
	}
	kind := serviceClass
	if serviceShape(class) != nil {
		// service Name: Type (D281): the shape is the type, and an instance
		// member in the body is EK9207.
		return kind
	}
	if extends := ast.GetClassExtendsHeritageElement(class); extends != nil {
		if !isControlReference(extends) {
			return ordinaryClass
		}
		kind = controlClass
	}
	instanceMembers := 0
	for _, member := range class.Members() {
		if ast.IsSemicolonClassElement(member) || ast.IsStatic(member) {
			continue
		}
		if !ast.IsMethodDeclaration(member) && !ast.IsPropertyDeclaration(member) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsAbstract) {
			return ordinaryClass
		}
		instanceMembers++
	}
	if instanceMembers == 0 && declarationWord(class) == "" {
		return ordinaryClass
	}
	return kind
}

// serviceShape returns the shape a service of any shape declares (D281):
// the parser writes service Search: SearchApi as an abstract class whose
// synthesized extends clause is $service<SearchApi>, and this returns the
// type argument, the written SearchApi. It returns nil for any other class.
func serviceShape(class *ast.Node) *ast.Node {
	extends := ast.GetClassExtendsHeritageElement(class)
	if extends == nil || !isServiceShapeFactory(extends.Expression()) {
		return nil
	}
	if arguments := extends.TypeArguments(); len(arguments) == 1 {
		return arguments[0]
	}
	return nil
}

// serviceShapeSelfReference finds a reference to the service key in its
// implementation shape. Resolve names, not types: asking for typeof the key
// while constructing its base type re-enters the same base resolution.
// Follow named shapes too, while preserving local type and value bindings.
func serviceShapeSelfReference(c *checker.Checker, class *ast.Node) *ast.Node {
	shape := serviceShape(class)
	if shape == nil {
		return nil
	}
	seen := map[*ast.Symbol]bool{}
	var found *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node == nil {
			return false
		}
		var name *ast.Node
		meaning := ast.SymbolFlagsType
		switch node.Kind {
		case ast.KindTypeReference:
			name = node.AsTypeReferenceNode().TypeName
		case ast.KindTypeQuery:
			name = node.AsTypeQueryNode().ExprName
			meaning = ast.SymbolFlagsValue
		case ast.KindExpressionWithTypeArguments:
			name = node.Expression()
		}
		for name != nil && ast.IsQualifiedName(name) {
			name = name.AsQualifiedName().Left
		}
		if name != nil && ast.IsIdentifier(name) {
			symbol := c.ResolveName(name.Text(), name, meaning, false)
			if symbol == class.Symbol() {
				found = node
				return true
			}
			if symbol != nil && !seen[symbol] {
				seen[symbol] = true
				for _, declaration := range symbol.Declarations() {
					if ast.IsTypeAliasDeclaration(declaration) && visit(declaration.Type()) ||
						ast.IsInterfaceDeclaration(declaration) && visit(declaration) {
						return true
					}
				}
			}
		}
		return node.ForEachChild(visit)
	}
	visit(shape)
	return found
}

// isServiceShapeFactory reports whether node is the synthesized $service of
// a service of any shape, which names no value the program uses.
func isServiceShapeFactory(node *ast.Node) bool {
	return node != nil && ast.IsIdentifier(node) && node.Text() == parser.ServiceShapeFactory && node.Flags&ast.NodeFlagsReparsed != 0 &&
		node.Parent != nil && ast.IsExpressionWithTypeArguments(node.Parent) && node.Parent.Parent != nil && ast.IsHeritageClause(node.Parent.Parent)
}

// isControlReference reports whether heritage, an extends clause element,
// names the prelude's Control.
func isControlReference(heritage *ast.Node) bool {
	expression := heritage.Expression()
	return ast.IsIdentifier(expression) && expression.Text() == "Control" && heritage.TypeArguments() == nil
}

// writtenKey returns the key that class's body writes, static readonly key =
// "<key>" with a string literal, and the member that writes it, or "" and
// nil (D501). A migrated service keeps its TypeScript original's key so.
func writtenKey(class *ast.Node) (string, *ast.Node) {
	for _, member := range class.Members() {
		if !ast.IsPropertyDeclaration(member) || !ast.IsStatic(member) || !ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) {
			continue
		}
		if name := member.Name(); name != nil && ast.IsIdentifier(name) && name.Text() == serviceKeyName {
			if initializer := member.Initializer(); initializer != nil && ast.IsStringLiteralLike(initializer) {
				return initializer.Text(), member
			}
		}
	}
	return "", nil
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

// services remembers one checker's answers about service classes. A checker
// is used by one goroutine at a time, so it needs no lock of its own.
type services struct {
	checker    *checker.Checker
	modules    map[string]*ast.Symbol // effect's modules by name, nil if the program lacks one
	keys       map[*ast.Node]string
	byKey      map[string][]*ast.Node        // every service and control class in the program, by key
	unprovided map[*checker.Type][]*ast.Node // wire arguments, by a service they need and their wire does not provide
	shapes     map[*ast.Node]*checker.Type   // service classes, by declaration, and their shapes
	shapeNames map[*ast.Node]*ast.Symbol     // service classes and the type alias that Name.Shape resolves to
	keyShapes  map[*ast.Symbol]*ast.Symbol   // other service keys and the type alias that Name.Shape resolves to
	instances  map[*ast.Node]*checker.Type   // service classes and their identifiers' base, Effect's instance type
	owners     map[*checker.Type]string      // the shapes shapeOf built from members, and their services' names
}

type servicesKey struct{}

// servicesFor returns the services that remember c's answers. They live on c,
// so they are freed with c.
func servicesFor(c *checker.Checker) *services {
	return c.ExtensionState(servicesKey{}, func() any {
		return &services{checker: c, modules: map[string]*ast.Symbol{}, keys: map[*ast.Node]string{}, shapes: map[*ast.Node]*checker.Type{}, shapeNames: map[*ast.Node]*ast.Symbol{}, keyShapes: map[*ast.Symbol]*ast.Symbol{}, instances: map[*ast.Node]*checker.Type{}, owners: map[*checker.Type]string{}}
	}).(*services)
}

// effectExport returns the symbol that effect's module (such as "Context")
// exports as name, or nil when the program does not include that module.
func (s *services) effectExport(module, name string) *ast.Symbol {
	symbol, searched := s.modules[module]
	if !searched {
		for _, file := range s.checker.Program().SourceFiles() {
			if isEffectModuleFile(file, module) {
				symbol = file.Symbol
				break
			}
		}
		s.modules[module] = symbol
	}
	if symbol == nil {
		return nil
	}
	for _, export := range s.checker.GetExportsOfModule(symbol) {
		if export.Name() == name {
			return export
		}
	}
	return nil
}

// isEffectModuleFile reports whether file declares the module effect/<name>
// of the effect package.
func isEffectModuleFile(file *ast.SourceFile, name string) bool {
	fileName := file.FileName().AsString()
	return strings.HasSuffix(fileName, "/effect/dist/"+name+".d.ts") || strings.HasSuffix(fileName, "/effect/src/"+name+".ts")
}

// key returns the key of the service that class declares: the key its body
// writes (D501), or else its package name, its module path within the
// package, and its name, as in "@acme/app/src/users#Users". A package without
// a name uses its directory's name, and a file outside every package uses its
// path from the program's common source directory.
func (s *services) key(class *ast.Node) string {
	if key, ok := s.keys[class]; ok {
		return key
	}
	if key, written := writtenKey(class); written != nil {
		s.keys[class] = key
		return key
	}
	file := ast.GetSourceFileOfNode(class)
	fileName := file.FileName()
	program := s.checker.Program()
	module := string(fileName.RemoveExtension(tspath.ExtensionVibe))
	prefix := ""
	if directory := program.GetNearestAncestorDirectoryWithPackageJson(fileName.Directory()); directory != "" {
		prefix = directory.BaseName()
		if info := program.GetPackageJsonInfo(directory.ResolveFile("package.json")); info.Exists() {
			if name, ok := info.Contents.Name.GetValue(); ok && name != "" {
				prefix = name
			}
		}
		module = strings.TrimPrefix(module, directory.AsString()+"/")
	} else if common := program.CommonSourceDirectory(); common != "" {
		module = strings.TrimPrefix(module, common.AsString()+"/")
	}
	key := module + "#" + class.Name().Text()
	if prefix != "" {
		key = prefix + "/" + key
	}
	s.keys[class] = key
	return key
}

// classBases is the checker's class base hook. A service class inherits the
// static side of Context.Service<Self, Shape>, or of Context.Service<never,
// Shape> when a static default makes its key a reference, and its instances
// inherit Effect's instance type, ServiceClass.Shape<key, Shape>, so Self is
// the identifier that Context.Service<Self, Shape>()(key) declares (D501). A
// service of any shape (D281) has the written shape. A control class
// inherits the static side of Context.Service<Self, Self> and the optional
// brand { readonly "~vibelang/service"?: key }, and its own extends clause is
// ignored.
func classBases(c *checker.Checker, class *checker.Type) (*checker.Type, *checker.Type) {
	symbol := class.Symbol()
	if symbol == nil {
		return nil, nil
	}
	declaration := symbol.ValueDeclaration()
	kind := classKindOf(declaration)
	if kind == ordinaryClass {
		return nil, nil
	}
	s := servicesFor(c)
	service := s.effectExport("Context", "Service")
	if service == nil {
		return nil, nil
	}
	if kind == controlClass {
		key := c.NewTypeReference(c.GetDeclaredTypeOfSymbol(service), []*checker.Type{class, class})
		return key, c.NewOptionalReadonlyPropertyType(serviceBrandProperty, c.GetStringLiteralType(s.key(declaration)))
	}
	identifier, shape := class, s.shapeOf(declaration)
	if hasDefaultValue(declaration) {
		identifier = c.GetNeverType()
	}
	key := c.NewTypeReference(c.GetDeclaredTypeOfSymbol(service), []*checker.Type{identifier, shape})
	return key, s.instanceOf(declaration)
}

// instanceOf returns what the identifier of the service that class declares
// inherits: Effect's ServiceClass.Shape<key, Shape>, `{ readonly
// [ServiceTypeId]: …; readonly key: "<key>"; readonly Service: Shape }`, or,
// where the program's effect does not declare it, { readonly key: "<key>" }.
func (s *services) instanceOf(class *ast.Node) *checker.Type {
	if instance, ok := s.instances[class]; ok {
		return instance
	}
	c := s.checker
	key := c.GetStringLiteralType(s.key(class))
	var instance *checker.Type
	if serviceClass := s.effectExport("Context", "ServiceClass"); serviceClass != nil {
		if shape := c.GetMergedSymbol(serviceClass).Exports()[serviceShapeName]; shape != nil && shape.Flags()&ast.SymbolFlagsInterface != 0 {
			instance = c.NewTypeReference(c.GetDeclaredTypeOfSymbol(shape), []*checker.Type{key, s.shapeOf(class)})
		}
	}
	if instance == nil {
		instance = c.NewReadonlyPropertyType(serviceKeyName, key)
	}
	s.instances[class] = instance
	return instance
}

// shapeOf returns the shape of the service that class declares: the written
// type of a service of any shape, or else an object type whose properties
// are class's instance members, which Users.Shape names. It has no alias,
// so it prints as its members, as Effect TypeScript's shape does.
func (s *services) shapeOf(class *ast.Node) *checker.Type {
	if shape, ok := s.shapes[class]; ok {
		return shape
	}
	c := s.checker
	var shape *checker.Type
	if node := serviceShape(class); node != nil {
		if serviceShapeSelfReference(c, class) != nil {
			shape = c.GetErrorType()
		} else {
			shape = c.GetTypeFromTypeNode(node)
		}
	} else {
		symbol := c.GetSymbolOfDeclaration(class)
		members := ast.SymbolTable{}
		for name, member := range symbol.Members() {
			if member.Flags()&(ast.SymbolFlagsProperty|ast.SymbolFlagsMethod|ast.SymbolFlagsAccessor) != 0 {
				members[name] = member
			}
		}
		shape = c.NewObjectType(members)
		s.owners[shape] = class.Name().Text()
	}
	s.shapes[class] = shape
	return shape
}

// shapeName returns the type alias that Name.Shape resolves to for the
// service that class declares.
func (s *services) shapeName(class *ast.Node) *ast.Symbol {
	if alias := s.shapeNames[class]; alias != nil {
		return alias
	}
	alias := s.checker.NewTypeAliasSymbol(serviceShapeName, s.checker.GetSymbolOfDeclaration(class), s.shapeOf(class))
	s.shapeNames[class] = alias
	return alias
}

// keyShapeName returns the type alias that Name.Shape resolves to for symbol,
// a class that TypeScript declares as a Context key, such as a
// Context.Service class: Effect's Context.Service.Shape<typeof Name>, or nil
// when symbol is not a Context key.
func (s *services) keyShapeName(symbol *ast.Symbol) *ast.Symbol {
	if alias, ok := s.keyShapes[symbol]; ok {
		return alias
	}
	var alias *ast.Symbol
	if _, shape := serviceOfKey(s.checker, s.checker.GetApparentType(s.checker.GetTypeOfSymbol(symbol))); shape != nil {
		alias = s.checker.NewTypeAliasSymbol(serviceShapeName, symbol, shape)
	}
	s.keyShapes[symbol] = alias
	return alias
}

// serviceShapeOfIdentifier returns the shape of the service whose identifier
// is t, the declared type of a service class, or nil when t is not a
// service's identifier. A class TypeScript declares is a service when its
// static side is a Context key whose identifier is t, as a Context.Service
// class's is.
func serviceShapeOfIdentifier(c *checker.Checker, t *checker.Type) *checker.Type {
	symbol := t.Symbol()
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsClass == 0 {
		return nil
	}
	if declaration := symbol.ValueDeclaration(); classKindOf(declaration) == serviceClass {
		return servicesFor(c).shapeOf(declaration)
	}
	identifier, shape := serviceOfKey(c, c.GetApparentType(c.GetTypeOfSymbol(symbol)))
	if identifier != t {
		return nil
	}
	return shape
}

// implementedServiceShape is the checker's implemented type hook: in a .vibe
// file, `implements Users` checks the class against Users.Shape, the type of
// an implementation, since no implementation carries the key (D501).
func implementedServiceShape(c *checker.Checker, class *ast.Node, typeNode *ast.Node, t *checker.Type) *checker.Type {
	if !isVibeLangFile(ast.GetSourceFileOfNode(class)) {
		return t
	}
	if shape := serviceShapeOfIdentifier(c, t); shape != nil {
		return shape
	}
	return t
}

// implementedType returns the type that class, a class in a .vibe file, must
// implement for heritage, an element of its implements clause: the service's
// shape for a service key, whose identifier has no members of its own (D501).
func implementedType(c *checker.Checker, class *ast.Node, heritage *ast.Node) *checker.Type {
	return implementedServiceShape(c, class, heritage, c.GetTypeFromTypeNode(heritage))
}

// resolveServiceShapeName is the checker's qualified type name hook: as a
// type, Users.Shape is the shape of the service Users, Effect's
// Context.Service.Shape<typeof Users> (D501), whether a .vibe file declares
// Users or, read from a .vibe file, TypeScript does. A class merged with a
// namespace keeps TypeScript's resolution, so a namespace that declares Shape
// still does.
func resolveServiceShapeName(c *checker.Checker, name *ast.Node, left *ast.Node, right *ast.Node, meaning ast.SymbolFlags) *ast.Symbol {
	if !ast.IsIdentifier(right) || right.Text() != serviceShapeName {
		return nil
	}
	symbol := c.ResolveEntityName(left, ast.SymbolFlagsClass)
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsNamespace != 0 {
		return nil
	}
	s := servicesFor(c)
	declaration := symbol.ValueDeclaration()
	if classKindOf(declaration) == serviceClass {
		return s.shapeName(declaration)
	}
	if file := ast.GetSourceFileOfNode(name); file == nil || !isVibeLangFile(file) || symbol.Flags()&ast.SymbolFlagsClass == 0 {
		return nil
	}
	return s.keyShapeName(symbol)
}

// serviceOfKey returns the identifier and the shape of the service that t,
// a Context key, looks up, or nil and nil when t is not a Context key.
func serviceOfKey(c *checker.Checker, t *checker.Type) (identifier *checker.Type, shape *checker.Type) {
	if t == nil || t.Flags()&checker.TypeFlagsObject == 0 || c.GetPropertyOfType(t, contextServiceTypeID) == nil {
		return nil, nil
	}
	return c.GetTypeOfPropertyOfType(t, "Identifier"), c.GetTypeOfPropertyOfType(t, "Service")
}

// isMemberCallSite reports whether node is the callee of a call
// `S.member(…)` in the body of a .vibe function.
func isMemberCallSite(node *ast.Node) bool {
	if !ast.IsPropertyAccessExpression(node) || ast.IsPrivateIdentifier(node.Name()) {
		return false
	}
	call := node.Parent
	return call != nil && ast.IsCallExpression(call) && call.Expression() == node && call.QuestionDotToken() == nil && inLowerableBody(call)
}

// serviceMember returns the identifier and the shape of the service whose
// member node, at a member call site, calls: receiver is the apparent type
// of S in `S.member(…)`, and it must be a Context key whose service declares
// member. It returns nil and nil otherwise.
func serviceMember(c *checker.Checker, node *ast.Node, receiver *checker.Type) (identifier *checker.Type, shape *checker.Type) {
	identifier, shape = serviceOfKey(c, receiver)
	if shape == nil {
		// FileSystem.readFileString(path): the module's name names its service (D311).
		identifier, shape = moduleServiceMember(c, node, receiver)
	}
	if shape == nil || c.GetPropertyOfType(shape, node.Name().Text()) == nil {
		return nil, nil
	}
	return identifier, shape
}

// memberReceiver is the checker's member receiver hook. In a call
// `S.member(…)` in a .vibe function body, where S is a Context key whose
// service declares member, member is read from the service's shape (design
// D41). A member the service declares therefore wins over the key's own
// members, such as pipe, of, and use.
func memberReceiver(c *checker.Checker, node *ast.Node, receiver *checker.Type) *checker.Type {
	if !isMemberCallSite(node) && !isClauseOperation(node) {
		return receiver
	}
	if _, shape := serviceMember(c, node, receiver); shape != nil {
		return shape
	}
	return receiver
}

// serviceLookup returns the identifier of the service that call looks up,
// or nil when call is not a service member call. A service member call looks
// the service up in the current Context, so the service joins R whatever the
// member returns, and then calls the member.
func serviceLookup(c *checker.Checker, call *ast.Node) *checker.Type {
	if !ast.IsCallExpression(call) {
		return nil
	}
	callee := call.Expression()
	if !isMemberCallSite(callee) {
		return nil
	}
	identifier, _ := serviceMember(c, callee, c.GetApparentType(c.GetTypeAtLocation(callee.Expression())))
	return identifier
}

// isServiceLookup reports whether call is a service member call.
func isServiceLookup(c *checker.Checker, call *ast.Node) bool {
	return serviceLookup(c, call) != nil
}

// isEffectValueCallSite reports whether call has the form `p()` in the body
// of a .vibe function.
func isEffectValueCallSite(call *ast.Node) bool {
	return len(call.Arguments()) == 0 && call.TypeArguments() == nil && call.QuestionDotToken() == nil && inLowerableBody(call)
}

// effectValueCall is the checker's call signatures hook. In a .vibe function
// body, a value whose type is an Effect, called with no arguments, runs:
// Users() gives the service's implementation, typed as its shape (D501), and
// Port() reads a Config (design D24). The call gets the signature () => Effect<A, E, R>.
func effectValueCall(c *checker.Checker, call *ast.Node, callee *checker.Type) []*checker.Signature {
	if !isEffectValueCallSite(call) {
		return nil
	}
	if effect := effectOfValue(c, callee); effect != nil {
		return []*checker.Signature{c.NewCallSignature(effect)}
	}
	// FileSystem(): the module's name names its service (D311).
	if key := moduleServiceKey(c, call.Expression(), callee); key != nil {
		if effect := effectOfValue(c, c.GetTypeOfSymbol(key)); effect != nil {
			return []*checker.Signature{c.NewCallSignature(effect)}
		}
	}
	return nil
}

// isEffectValueCall reports whether call runs its callee, an Effect value.
func isEffectValueCall(c *checker.Checker, call *ast.Node) bool {
	if !isEffectValueCallSite(call) {
		return false
	}
	callee := c.GetApparentType(c.GetTypeAtLocation(call.Expression()))
	if len(c.GetSignaturesOfType(callee, checker.SignatureKindCall)) != 0 {
		return false
	}
	return effectOfValue(c, callee) != nil || effectOfValue(c, serviceKeyTypeAt(c, call.Expression())) != nil
}

// effectOfValue returns Effect<A, E, R> for t, a type whose values are
// Effects, or nil when some value of t is not one. Such a type is a Context
// key or a Config, whose variance the Effect interface declares; an Exit, a
// union of two Effects; or a tagged error instance, whose class declares the
// variance itself.
func effectOfValue(c *checker.Checker, t *checker.Type) *checker.Type {
	if t == nil || !isEffectValueType(c, t) {
		return nil
	}
	effect := effectInterface(c, t)
	if effect == nil {
		if symbol := servicesFor(c).effectExport("Effect", "Effect"); symbol != nil {
			effect = c.GetDeclaredTypeOfSymbol(symbol)
		}
	}
	if effect == nil {
		return nil
	}
	a, e, r := varianceChannel(c, t, "_A"), varianceChannel(c, t, "_E"), varianceChannel(c, t, "_R")
	if a == nil || e == nil || r == nil {
		return nil
	}
	return c.NewTypeReference(effect, []*checker.Type{a, e, r})
}

// isEffectValueType reports whether every value of t is an Effect: t is an
// object type with the ~effect/Effect variance, an intersection with such a
// member (Alchemy's Worker is Effect<Worker> & Named<...>), or a union of these.
func isEffectValueType(c *checker.Checker, t *checker.Type) bool {
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if !isEffectValueType(c, member) {
				return false
			}
		}
		return len(t.Types()) > 0
	}
	if t.Flags()&checker.TypeFlagsIntersection != 0 {
		return slices.ContainsFunc(t.Types(), func(member *checker.Type) bool { return isEffectValueType(c, member) })
	}
	return t.Flags()&checker.TypeFlagsObject != 0 && c.GetPropertyOfType(t, effectTypeID) != nil
}

// varianceChannel reads one channel of t's `~effect/Effect` variance
// property, whether or not t is the Effect interface itself.
func varianceChannel(c *checker.Checker, t *checker.Type, name string) *checker.Type {
	variance := c.GetTypeOfPropertyOfType(t, effectTypeID)
	if variance == nil {
		return nil
	}
	covariant := c.GetTypeOfPropertyOfType(variance, name)
	if covariant == nil {
		return nil
	}
	signatures := c.GetSignaturesOfType(covariant, checker.SignatureKindCall)
	if len(signatures) != 1 {
		return nil
	}
	return c.GetReturnTypeOfSignature(signatures[0])
}
