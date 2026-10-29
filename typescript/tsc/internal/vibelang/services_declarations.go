package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/printer"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// The declaration file of a service or control class (design D45, D501).
// The declaration transform writes the class as it is in source:
//
//	export declare abstract class Users {
//	    abstract find(id: string): Effect.Effect<User, UserNotFound, never>;
//	    static readonly layer: Layer.Layer<Users, never, never>;
//	}
//
// TypeScript code that imports it must see what Effect TypeScript declares
// for class Users extends Context.Service<Users, Shape>()(key) {}, byte for
// byte, so a migrated library keeps its public declarations (D501): a base
// constant typed with Effect's ServiceClass, whose shape is the members
// written in place, and a class that extends it with the static members:
//
//	declare const Users_base: Context.ServiceClass<Users, "app/users#Users", {
//	    find(id: string): Effect.Effect<User, UserNotFound, never>;
//	}>;
//	export declare class Users extends Users_base {
//	    static readonly layer: Layer.Layer<Users, never, never>;
//	}
//	export {};
//
// The key is the one the body writes, static readonly key = "<key>", which is
// not a static member of its own, or the derived one. A service of any shape
// (D281) writes its shape as written. A service with a static default and no
// other static member is Effect's reference, export declare const Flags:
// Context.Reference<Shape>; with other static members, its base is the
// runtime's ReferenceKey<Shape>. A source type Users.Shape is written
// Context.Service.Shape<typeof Users>, and a class that implements a service
// in source implements that.
//
// A control operation keeps one interface for its members and an optional
// brand, and its key's base is the runtime's ServiceKey<Approval>.
//
// A service in a namespace is written the same way inside the namespace's
// body, which is ambient, so nothing in it says declare. A body whose
// members are all exported carries no export modifiers, so the body gains
// them and an empty export, which keeps the base constant private. The base
// constant's name, and a shape interface's, is fresh (hygiene.go):
// Users_base$1 when the source spells Users_base.

func init() { compiler.RegisterDeclarationTransformerHook(serviceDeclarations) }

// serviceEmit is what the declaration transform needs to know about one
// service or control class.
type serviceEmit struct {
	key  string
	kind classKind
}

func serviceDeclarations(resolver printer.EmitResolver, file *ast.SourceFile) func(*ast.SourceFile) *ast.SourceFile {
	r, ok := resolver.(*checker.EmitResolver)
	if !ok || !isVibeLangFile(file) {
		return nil
	}
	emits := map[*ast.Node]*serviceEmit{}
	implemented := map[*ast.Node]bool{} // implements clause elements that name a service
	shapes := map[*ast.Node]bool{}      // type references Name.Shape to a service's shape
	r.WithChecker(func(c *checker.Checker) {
		s := servicesFor(c)
		var collect func(statements []*ast.Node)
		collect = func(statements []*ast.Node) {
			for _, statement := range statements {
				switch kind := classKindOf(statement); kind {
				case serviceClass:
					emits[statement] = &serviceEmit{key: s.key(statement), kind: kind}
				case controlClass:
					emits[statement] = &serviceEmit{key: s.key(statement), kind: kind}
				default:
					if ast.IsClassDeclaration(statement) {
						for _, element := range ast.GetImplementsHeritageClauseElements(statement) {
							if serviceShapeOfIdentifier(c, c.GetTypeFromTypeNode(element)) != nil {
								implemented[element] = true
							}
						}
					}
				}
				if body := namespaceBlock(statement); body != nil {
					collect(body.Statements())
				}
			}
		}
		collect(file.Statements.Nodes)
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsTypeReferenceNode(node) && isServiceShapeName(c, node.AsTypeReferenceNode().TypeName) {
				shapes[node] = true
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	})
	if len(emits) == 0 && len(implemented) == 0 && len(shapes) == 0 {
		return nil
	}
	ec := resolver.EmitContext()
	return func(declarations *ast.SourceFile) *ast.SourceFile {
		e := &serviceEmitter{ec: ec, names: &freshNames{file: file}, emits: emits, implemented: implemented}
		statements, changed := e.statements(declarations.Statements.Nodes, false /*ambient*/)
		if e.private && !core.Some(statements, func(s *ast.Node) bool { return ast.IsExportDeclaration(s) || ast.IsExportAssignment(s) }) {
			// A base constant is not exported, so the file says it is a
			// module whose other declarations are not, as TypeScript does.
			f := ec.Factory.AsNodeFactory()
			statements = append(statements, f.NewExportDeclaration(nil /*modifiers*/, false /*isTypeOnly*/, f.NewNamedExports(f.NewNodeList([]*ast.Node{})), nil /*moduleSpecifier*/, nil /*attributes*/))
		}
		if len(shapes) > 0 {
			rewriter := &shapeReferences{emitter: e, references: shapes}
			rewriter.NewTransformer(rewriter.visit, ec)
			list := ec.Factory.NewNodeList(statements)
			list.Loc = declarations.Statements.Loc
			declarations = rewriter.TransformSourceFile(ec.Factory.UpdateSourceFile(declarations, list, declarations.EndOfFileToken).AsSourceFile())
			statements, changed = declarations.Statements.Nodes, changed || rewriter.changed
		}
		if !changed {
			return declarations
		}
		if len(e.imports) > 0 {
			// transformDeclarations, which runs next, imports Context.
			r.WithChecker(func(c *checker.Checker) {
				state := preludeStateOf(c)
				for _, identifier := range e.imports {
					recordTypeUse(state, file, identifier)
				}
			})
		}
		list := ec.Factory.NewNodeList(statements)
		list.Loc = declarations.Statements.Loc
		return ec.Factory.UpdateSourceFile(declarations, list, declarations.EndOfFileToken).AsSourceFile()
	}
}

// serviceEmitter writes the declarations of the services of one file.
type serviceEmitter struct {
	ec          *printer.EmitContext
	names       *freshNames                // the names that declaration emit adds (hygiene.go)
	emits       map[*ast.Node]*serviceEmit // service and control classes, by source declaration
	implemented map[*ast.Node]bool         // implements clause elements that name a service
	imports     []*ast.Node                // the Context identifiers it wrote
	private     bool                       // it wrote an unexported base constant at the top level
}

// context returns a new identifier Context, effect's module, which
// transformDeclarations imports.
func (e *serviceEmitter) context() *ast.Node {
	identifier := e.ec.Factory.NewIdentifier("Context")
	e.imports = append(e.imports, identifier)
	return identifier
}

// serviceShapeType returns Context.Service.Shape<typeof name>, Effect's name
// for the shape of the service whose key is name, an entity name.
func (e *serviceEmitter) serviceShapeType(name *ast.Node) *ast.Node {
	f := e.ec.Factory
	shape := f.NewQualifiedName(f.NewQualifiedName(e.context(), f.NewIdentifier("Service")), f.NewIdentifier(serviceShapeName))
	return f.NewTypeReferenceNode(shape, f.NewNodeList([]*ast.Node{f.NewTypeQueryNode(name, nil /*typeArguments*/)}))
}

// namespaceBlock returns the body of statement, a namespace declaration,
// through the declarations a dotted name nests, or nil.
func namespaceBlock(statement *ast.Node) *ast.Node {
	for statement != nil && ast.IsModuleDeclaration(statement) {
		body := statement.Body()
		if body != nil && ast.IsModuleBlock(body) {
			return body
		}
		statement = body
	}
	return nil
}

// statements returns statements, those of a declaration file or, when
// ambient, of a namespace's body, with each service and control class
// written as service and control write them, each class that implements a
// service written to implement its shape, in nested namespaces too, and
// whether any changed. In a body without an export declaration every member
// is exported, so when a service is written there, each member gains the
// export modifier it stands for, and an empty export keeps the statements
// that declaration emit adds, such as the base constant, private.
func (e *serviceEmitter) statements(statements []*ast.Node, ambient bool) ([]*ast.Node, bool) {
	allExported := ambient && !core.Some(statements, func(s *ast.Node) bool { return ast.IsExportDeclaration(s) || ast.IsExportAssignment(s) })
	var result []*ast.Node
	private := map[*ast.Node]bool{} // added statements that stay unexported
	changed := false
	for _, statement := range statements {
		class := e.ec.MostOriginal(statement)
		if emit := e.emits[class]; ast.IsClassDeclaration(statement) && emit != nil {
			exported := allExported || ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport)
			var written, hidden []*ast.Node
			if emit.kind == serviceClass {
				written, hidden = e.service(statement, class, emit, ambient, exported)
			} else {
				written, hidden = e.control(statement, emit.key, ambient, exported)
			}
			for _, statement := range hidden {
				private[statement] = true
			}
			e.private = e.private || !ambient && len(hidden) > 0
			result = append(result, written...)
			changed = true
			continue
		}
		switch {
		case ast.IsClassDeclaration(statement) && len(e.implemented) > 0:
			if updated := e.implementShapes(statement); updated != statement {
				statement = updated
				changed = true
			}
		case ast.IsModuleDeclaration(statement):
			if namespace, ok := e.namespace(statement); ok {
				statement = namespace
				changed = true
			}
		}
		result = append(result, statement)
	}
	if len(private) == 0 || !allExported {
		return result, changed
	}
	f := e.ec.Factory.AsNodeFactory()
	for i, statement := range result {
		if private[statement] || !ast.CanHaveModifiers(statement) || ast.IsImportEqualsDeclaration(statement) {
			continue
		}
		if flags := ast.GetCombinedModifierFlags(statement); flags&(ast.ModifierFlagsExport|ast.ModifierFlagsDefault) == 0 {
			modifiers := ast.CreateModifiersFromModifierFlags(flags|ast.ModifierFlagsExport, f.NewModifier)
			result[i] = ast.ReplaceModifiers(f, statement, f.NewModifierList(modifiers))
		}
	}
	empty := f.NewExportDeclaration(nil /*modifiers*/, false /*isTypeOnly*/, f.NewNamedExports(f.NewNodeList([]*ast.Node{})), nil /*moduleSpecifier*/, nil /*attributes*/)
	return append(result, empty), true
}

// namespace returns namespace, a namespace declaration of a declaration
// file, with its body's statements written by statements, and whether any
// changed.
func (e *serviceEmitter) namespace(namespace *ast.Node) (*ast.Node, bool) {
	f := e.ec.Factory
	body := namespace.Body()
	switch {
	case body == nil:
		return namespace, false
	case ast.IsModuleDeclaration(body):
		inner, ok := e.namespace(body)
		if !ok {
			return namespace, false
		}
		body = inner
	case ast.IsModuleBlock(body):
		statements, ok := e.statements(body.Statements(), true /*ambient*/)
		if !ok {
			return namespace, false
		}
		list := f.NewNodeList(statements)
		list.Loc = body.StatementList().Loc
		body = f.UpdateModuleBlock(body.AsModuleBlock(), list)
	default:
		return namespace, false
	}
	declaration := namespace.AsModuleDeclaration()
	return f.UpdateModuleDeclaration(declaration, namespace.Modifiers(), declaration.Keyword, namespace.Name(), declaration.Attributes, body), true
}

// declareModifiers returns declare, which a statement outside an ambient
// namespace body needs, after export when exported.
func declareModifiers(f *printer.NodeFactory, ambient, exported bool) []*ast.Node {
	var modifiers []*ast.Node
	if exported {
		modifiers = append(modifiers, f.NewModifier(ast.KindExportKeyword))
	}
	if !ambient {
		modifiers = append(modifiers, f.NewModifier(ast.KindDeclareKeyword))
	}
	return modifiers
}

// service returns the declarations of a service: declared, the class the
// declaration transform wrote for class, becomes the class Effect TypeScript
// declares for Context.Service<Name, Shape>()(key), a `<Name>_base` constant
// typed Context.ServiceClass<Name, key, Shape> and a class that extends it
// with the static members other than the key (D501), or, for a service with
// a defaultValue, Effect's reference. It also returns the declarations
// among them that stay unexported, the base constant. exported says whether
// the service is exported, and ambient that it is in a namespace's body,
// where nothing says declare.
func (e *serviceEmitter) service(declared, class *ast.Node, emit *serviceEmit, ambient, exported bool) ([]*ast.Node, []*ast.Node) {
	f := e.ec.Factory
	name := declared.Name().Text()
	isDefault := ast.HasSyntacticModifier(declared, ast.ModifierFlagsDefault)
	exported = exported && !isDefault
	instance, statics := splitMembers(f, declared)
	statics = withoutStatic(statics, serviceKeyName)
	shape := writtenShape(declared, class)
	if shape == nil {
		shape = f.NewTypeLiteralNode(f.NewNodeList(instance))
	}

	var result, hidden []*ast.Node
	if hasDefaultValue(class) {
		if others := withoutStatic(statics, "defaultValue"); len(others) == 0 {
			// export declare const Flags: Context.Reference<Shape>
			reference := f.NewTypeReferenceNode(f.NewQualifiedName(e.context(), f.NewIdentifier("Reference")), f.NewNodeList([]*ast.Node{shape}))
			declaration := f.NewVariableDeclaration(f.NewIdentifier(name), nil /*exclamationToken*/, reference, nil /*initializer*/)
			result = append(result, f.NewVariableStatement(f.NewModifierList(declareModifiers(f, ambient, exported)), f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{declaration}), ast.NodeFlagsConst)))
		} else {
			base := keyBase(f, e.names.freshName(name+"_base"), "ReferenceKey", []*ast.Node{shape}, ambient)
			result, hidden = append(result, base, keyClass(f, declared, base, ambient, exported, true /*abstract*/, statics)), append(hidden, base)
		}
	} else {
		// declare const Users_base: Context.ServiceClass<Users, "key", Shape>
		arguments := []*ast.Node{
			f.NewTypeReferenceNode(f.NewIdentifier(name), nil /*typeArguments*/),
			f.NewLiteralTypeNode(f.NewStringLiteral(emit.key, ast.TokenFlagsNone)),
			shape,
		}
		baseType := f.NewTypeReferenceNode(f.NewQualifiedName(e.context(), f.NewIdentifier("ServiceClass")), f.NewNodeList(arguments))
		baseName := e.names.freshName(name + "_base")
		base := f.NewVariableStatement(
			f.NewModifierList(declareModifiers(f, ambient, false /*exported*/)),
			f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{f.NewVariableDeclaration(f.NewIdentifier(baseName), nil /*exclamationToken*/, baseType, nil /*initializer*/)}), ast.NodeFlagsConst),
		)
		result, hidden = append(result, base, keyClass(f, declared, base, ambient, exported, false /*abstract*/, statics)), append(hidden, base)
	}
	if isDefault {
		result = append(result, f.NewExportAssignment(nil /*modifiers*/, false /*isExportEquals*/, nil /*type*/, f.NewIdentifier(name)))
	}
	return result, hidden
}

// withoutStatic returns statics without the property named name.
func withoutStatic(statics []*ast.Node, name string) []*ast.Node {
	var result []*ast.Node
	for _, member := range statics {
		if ast.IsPropertyDeclaration(member) && member.Name() != nil && ast.IsIdentifier(member.Name()) && member.Name().Text() == name {
			continue
		}
		result = append(result, member)
	}
	return result
}

// control returns the declarations of a control operation: an interface for
// its members and the optional brand, a `<Name>_base` constant typed with
// the runtime's ServiceKey, and a class that extends it with the static
// members.
func (e *serviceEmitter) control(declared *ast.Node, key string, ambient, exported bool) ([]*ast.Node, []*ast.Node) {
	f := e.ec.Factory
	name := declared.Name().Text()
	isDefault := ast.HasSyntacticModifier(declared, ast.ModifierFlagsDefault)
	exported = exported && !isDefault
	instance, statics := splitMembers(f, declared)
	instance = append(instance, f.NewPropertySignatureDeclaration(
		f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindReadonlyKeyword)}),
		f.NewStringLiteral(serviceBrandProperty, ast.TokenFlagsNone),
		f.NewToken(ast.KindQuestionToken),
		f.NewLiteralTypeNode(f.NewStringLiteral(key, ast.TokenFlagsNone)),
		nil, /*initializer*/
	))
	shape := f.NewInterfaceDeclaration(exportModifiers(f, exported), f.NewIdentifier(name), nil /*typeParameters*/, nil /*heritageClauses*/, f.NewNodeList(instance))
	keyArguments := []*ast.Node{f.NewTypeReferenceNode(f.NewIdentifier(name), nil /*typeArguments*/)}
	base := keyBase(f, e.names.freshName(name+"_base"), "ServiceKey", keyArguments, ambient)
	result := []*ast.Node{shape, base, keyClass(f, declared, base, ambient, exported, true /*abstract*/, statics)}
	if isDefault {
		result = append(result, f.NewExportAssignment(nil /*modifiers*/, false /*isExportEquals*/, nil /*type*/, f.NewIdentifier(name)))
	}
	return result, []*ast.Node{base}
}

// splitMembers returns the instance members of declared as interface
// members, and its static members as they are.
func splitMembers(f *printer.NodeFactory, declared *ast.Node) (instance, statics []*ast.Node) {
	for _, member := range declared.Members() {
		switch {
		case ast.IsStatic(member):
			statics = append(statics, member)
		case ast.IsMethodDeclaration(member):
			instance = append(instance, f.NewMethodSignatureDeclaration(nil /*modifiers*/, member.Name(), member.PostfixToken(), member.TypeParameterList(), member.ParameterList(), member.Type()))
		case ast.IsPropertyDeclaration(member):
			var modifiers *ast.ModifierList
			if ast.HasSyntacticModifier(member, ast.ModifierFlagsReadonly) {
				modifiers = f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindReadonlyKeyword)})
			}
			instance = append(instance, f.NewPropertySignatureDeclaration(modifiers, member.Name(), member.PostfixToken(), member.Type(), nil /*initializer*/))
		}
	}
	return instance, statics
}

// exportModifiers returns `export` when exported, and no modifiers otherwise.
func exportModifiers(f *printer.NodeFactory, exported bool) *ast.ModifierList {
	if !exported {
		return nil
	}
	return f.NewModifierList([]*ast.Node{f.NewModifier(ast.KindExportKeyword)})
}

// keyBase returns `declare const <base>: import("vibelang-runtime").<keyType><keyArguments>`,
// without declare when ambient.
func keyBase(f *printer.NodeFactory, base, keyType string, keyArguments []*ast.Node, ambient bool) *ast.Node {
	baseType := f.NewImportTypeNode(false /*isTypeOf*/, f.NewLiteralTypeNode(f.NewStringLiteral(runtimeModule, ast.TokenFlagsNone)), nil /*attributes*/, f.NewIdentifier(keyType), f.NewNodeList(keyArguments))
	return f.NewVariableStatement(
		f.NewModifierList(declareModifiers(f, ambient, false /*exported*/)),
		f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{f.NewVariableDeclaration(f.NewIdentifier(base), nil /*exclamationToken*/, baseType, nil /*initializer*/)}), ast.NodeFlagsConst),
	)
}

// keyClass returns the key class: declared, as a class, abstract when
// abstract is set, that extends the constant base declares, with only its
// static members.
func keyClass(f *printer.NodeFactory, declared, base *ast.Node, ambient, exported, abstract bool, statics []*ast.Node) *ast.Node {
	modifiers := declareModifiers(f, ambient, exported)
	if abstract {
		modifiers = append(modifiers, f.NewModifier(ast.KindAbstractKeyword))
	}
	name := base.AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name().Text()
	extends := f.NewHeritageClause(ast.KindExtendsKeyword, f.NewNodeList([]*ast.Node{f.NewExpressionWithTypeArguments(f.NewIdentifier(name), nil /*typeArguments*/)}))
	return f.UpdateClassDeclaration(declared.AsClassDeclaration(), f.NewModifierList(modifiers), declared.Name(), nil /*typeParameters*/, f.NewNodeList([]*ast.Node{extends}), f.NewNodeList(statics))
}

// implementShapes returns class with each element of its implements clause
// that names a service, by the source element it came from, written as the
// service's shape: implements Users becomes implements
// Context.Service.Shape<typeof Users> (D501).
func (e *serviceEmitter) implementShapes(class *ast.Node) *ast.Node {
	f := e.ec.Factory
	clauses := class.ClassLikeData().HeritageClauses
	if clauses == nil {
		return class
	}
	changed := false
	var updated []*ast.Node
	for _, clause := range clauses.Nodes {
		if clause.AsHeritageClause().Token != ast.KindImplementsKeyword {
			updated = append(updated, clause)
			continue
		}
		var elements []*ast.Node
		for _, element := range clause.AsHeritageClause().Types.Nodes {
			if e.implemented[e.ec.MostOriginal(element)] {
				// Declaration emit writes an element as a type reference or as
				// the expression it was in source.
				var name *ast.Node
				switch {
				case ast.IsTypeReferenceNode(element):
					name = element.AsTypeReferenceNode().TypeName
				case ast.IsExpressionWithTypeArguments(element) && ast.IsEntityNameExpression(element.Expression()):
					name = entityNameOf(f, element.Expression())
				}
				if name != nil {
					shape := e.serviceShapeType(name)
					reference := shape.AsTypeReferenceNode()
					element = f.NewExpressionWithTypeArguments(entityExpressionOf(f, reference.TypeName), reference.TypeArguments)
					changed = true
				}
			}
			elements = append(elements, element)
		}
		updated = append(updated, f.NewHeritageClause(ast.KindImplementsKeyword, f.NewNodeList(elements)))
	}
	if !changed {
		return class
	}
	data := class.AsClassDeclaration()
	return f.UpdateClassDeclaration(data, class.Modifiers(), class.Name(), class.TypeParameterList(), f.NewNodeList(updated), class.MemberList())
}

// entityNameOf returns expression, an entity name expression such as a.b,
// as an entity name.
func entityNameOf(f *printer.NodeFactory, expression *ast.Node) *ast.Node {
	if ast.IsPropertyAccessExpression(expression) {
		return f.NewQualifiedName(entityNameOf(f, expression.Expression()), f.NewIdentifier(expression.Name().Text()))
	}
	return f.NewIdentifier(expression.Text())
}

// entityExpressionOf returns name, an entity name, as an expression.
func entityExpressionOf(f *printer.NodeFactory, name *ast.Node) *ast.Node {
	if ast.IsQualifiedName(name) {
		q := name.AsQualifiedName()
		return f.NewPropertyAccessExpression(entityExpressionOf(f, q.Left), nil /*questionDotToken*/, f.NewIdentifier(q.Right.Text()), ast.NodeFlagsNone)
	}
	return f.NewIdentifier(name.Text())
}

// isServiceShapeName reports whether name, the name of a type reference in
// a .vibe file, is Name.Shape for a service key Name, which the checker
// resolves to the service's shape (resolveServiceShapeName).
func isServiceShapeName(c *checker.Checker, name *ast.Node) bool {
	if !ast.IsQualifiedName(name) || name.AsQualifiedName().Right.Text() != serviceShapeName {
		return false
	}
	q := name.AsQualifiedName()
	return resolveServiceShapeName(c, name, q.Left, q.Right, ast.SymbolFlagsType) != nil
}

// shapeReferences writes each type reference Name.Shape to a service's shape
// that the source wrote as Effect's Context.Service.Shape<typeof Name>.
type shapeReferences struct {
	transformers.Transformer
	emitter    *serviceEmitter
	references map[*ast.Node]bool // the source's references to a service's shape
	changed    bool
}

func (tx *shapeReferences) visit(node *ast.Node) *ast.Node {
	node = tx.Visitor().VisitEachChild(node)
	if !ast.IsTypeReferenceNode(node) || !tx.references[tx.EmitContext().MostOriginal(node)] {
		return node
	}
	name := node.AsTypeReferenceNode().TypeName
	if !ast.IsQualifiedName(name) {
		return node
	}
	tx.changed = true
	return tx.emitter.serviceShapeType(name.AsQualifiedName().Left)
}

// mentionsName reports whether node has an identifier whose text is name.
func mentionsName(node *ast.Node, name string) bool {
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		return ast.IsIdentifier(n) && n.Text() == name || n.ForEachChild(visit)
	}
	return visit(node)
}

// slicesMentionName reports whether any of nodes mentions name.
func slicesMentionName(nodes []*ast.Node, name string) bool {
	for _, node := range nodes {
		if mentionsName(node, name) {
			return true
		}
	}
	return false
}

// writtenShape returns the shape of a service of any shape (D281) as the
// declaration transform wrote it, the type argument of declared's extends
// clause $service<Type>, or nil when class declares another service.
func writtenShape(declared, class *ast.Node) *ast.Node {
	if serviceShape(class) == nil {
		return nil
	}
	if extends := ast.GetClassExtendsHeritageElement(declared); extends != nil {
		if arguments := extends.TypeArguments(); len(arguments) == 1 {
			return arguments[0]
		}
	}
	return nil
}
