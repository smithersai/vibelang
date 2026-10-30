package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/transformers"
)

// super, arguments and new.target in generated generators.
//
// A generator that the lowering introduces is a function of its own, and
// JavaScript binds super, arguments and new.target afresh in every function
// that is not an arrow: super is a SyntaxError in a function* expression,
// and arguments and new.target would be the generator's own. An Effect
// method's body runs in such a generator, and so do an Effect arrow's body,
// a producer's body and the regions of try, catch and finally:
//
//	greet(name) {
//	  return Effect.gen({ self: this }, function* greet() {
//	    const b = yield* super.greet(name)   // SyntaxError
//	    return arguments.length              // the generator's: 0
//	  })
//	}
//
// So the function that binds them in the source declares them once at the
// top of its lowered body, and the code that the lowering moved into a
// generator reads those bindings. A class field, whose initializer has no
// body, declares them in an arrow called in the initializer's place:
//
//	greet(name) {
//	  const super_1 = (key) => super[key];
//	  const arguments_1 = arguments;
//	  return Effect.gen({ self: this }, function* greet() {
//	    const b = yield* super_1("greet").call(this, name)
//	    return arguments_1.length
//	  })
//	}
//
// Which function binds a reference follows JavaScript's scopes (bindsFrame),
// and one source function can stand behind several lowered functions. Those
// that run as the source function are its activations. The function that
// its caller calls binds arguments, new.target and, in a method, super. A
// generator that this function forwards its this and arguments to on every
// run, as Effect.fnUntraced(…).apply(this, arguments) does, binds arguments
// afresh on each run (forwarding), but not new.target. Any other generator
// binds none of them. A reference that its own function does not bind reads
// the binding of the innermost activation that does: an Effect arrow in a
// constructor reads the constructor's `const newTarget_1 = new.target`, and
// one in an Effect function sees the arguments object that the body around
// it sees on the same run:
//
//	function count(a) {
//	  return Effect.fnUntraced(function* count(a) {
//	    const arguments_1 = arguments;
//	    const read = Effect.fnUntraced(function* read() { return arguments_1; });
//	    return (yield* read()) === arguments;   // true
//	  }).apply(this, arguments);
//	}
//
// The arrow sees the method's super. A generator that holds a super
// reference also gets the method's this (usesThis counts super), so a call
// keeps its receiver, and JavaScript's order: the method is looked up before
// the arguments are evaluated; a tag, super.tag`…`, is bound to this. An
// assignment, super.name = value, calls a second arrow, (key, value) =>
// super[key] = value, and so does a compound one, super.count += 1. Every
// other target, such as super.count++, super[key] += value or [super.name] =
// pair, becomes superReference_1(key).value, an object whose value accessor
// reads and writes super[key] through those arrows. The key is evaluated
// once, and JavaScript applies the operator itself, in its own order:
// getter, right side, setter, and an update's old or new number.

// frameBinding is a set of the bindings that JavaScript gives every function
// that is not an arrow, so that a generator the lowering introduces binds
// them afresh. this is not one: a generator gets its source function's this
// as its receiver (usesThis).
type frameBinding uint8

const (
	bindsArguments frameBinding = 1 << iota
	bindsNewTarget
	bindsSuper
)

// frameReferences records which source functions bind a super, arguments or
// new.target reference in their scope, which arguments identifiers are
// references, and which lowered generators run as their source function.
type frameReferences struct {
	binders    map[*ast.Node]bool // functions, static blocks and class fields whose super, arguments or new.target their scope refers to
	arguments  map[*ast.Node]bool // identifiers that refer to their function's arguments
	forwarders map[*ast.Node]bool // generators called with their source function's this and arguments on every run (forwarding)
}

// findFrameReferences finds, in file, each super property, arguments and
// new.target reference and the function that binds it: the nearest
// function, class static block or class field whose scope holds it
// (bindsFrame), when that one binds what the reference names
// (frameBindings).
func findFrameReferences(file *ast.SourceFile) frameReferences {
	refs := frameReferences{binders: map[*ast.Node]bool{}, arguments: map[*ast.Node]bool{}, forwarders: map[*ast.Node]bool{}}
	var visit func(node, binder *ast.Node) bool
	visit = func(node, binder *ast.Node) bool {
		var binding frameBinding
		switch {
		case node.Kind == ast.KindSuperKeyword && isSuperProperty(node.Parent):
			binding = bindsSuper
		case ast.IsIdentifier(node) && node.Text() == "arguments" && !ast.IsRightSideOfQualifiedNameOrPropertyAccess(node) && (!ast.IsDeclarationName(node) || ast.IsShorthandPropertyAssignment(node.Parent)):
			binding = bindsArguments
		case isNewTarget(node):
			binding = bindsNewTarget
		}
		if binding != 0 && binder != nil && frameBindings(binder)&binding != 0 {
			refs.binders[binder] = true
			if binding == bindsArguments {
				refs.arguments[node] = true
			}
		}
		return node.ForEachChild(func(child *ast.Node) bool {
			if bindsFrame(node, child) {
				return visit(child, node)
			}
			return visit(child, binder)
		})
	}
	visit(file.AsNode(), nil)
	return refs
}

// bindsFrame reports whether node binds this, arguments, new.target and
// super for child, one of its children, as JavaScript scopes them: a
// function that is not an arrow binds them for its parameters and body, a
// class static block for its body, and a class field for its initializer.
// Everything else is evaluated where node is: an arrow function, a class's
// extends clause and decorators, and a member's computed name.
func bindsFrame(node, child *ast.Node) bool {
	switch {
	case node.Kind == ast.KindArrowFunction:
		return false
	case node.Kind == ast.KindClassStaticBlockDeclaration:
		return true
	case node.Kind == ast.KindPropertyDeclaration:
		return child == node.Initializer()
	case ast.IsFunctionLike(node):
		return child != node.Name() && !ast.IsModifierLike(child)
	}
	return false
}

// frameBindings returns what fn, a node that bindsFrame says binds its
// children's scope, binds there that the lowering can declare: arguments
// and new.target in a function, and super in a method, accessor,
// constructor, class static block or class field. new.target is undefined
// in a static block and a field, as it is in a generator.
func frameBindings(fn *ast.Node) frameBinding {
	switch fn.Kind {
	case ast.KindClassStaticBlockDeclaration, ast.KindPropertyDeclaration:
		return bindsSuper
	case ast.KindMethodDeclaration, ast.KindGetAccessor, ast.KindSetAccessor, ast.KindConstructor:
		return bindsArguments | bindsNewTarget | bindsSuper
	}
	return bindsArguments | bindsNewTarget
}

// isNewTarget reports whether node is new.target.
func isNewTarget(node *ast.Node) bool {
	return ast.IsMetaProperty(node) && node.AsMetaProperty().KeywordToken == ast.KindNewKeyword
}

// opensFrame reports whether node binds arguments, new.target and super
// afresh for its body: a function that is not an arrow, a class static
// block, or a class field for its initializer.
func opensFrame(node *ast.Node) bool {
	return ast.IsFunctionLike(node) && node.Kind != ast.KindArrowFunction || node.Kind == ast.KindClassStaticBlockDeclaration || node.Kind == ast.KindPropertyDeclaration
}

// isSuperProperty reports whether node is super.name or super[key].
func isSuperProperty(node *ast.Node) bool {
	return node != nil && (ast.IsPropertyAccessExpression(node) || ast.IsElementAccessExpression(node)) && node.Expression().Kind == ast.KindSuperKeyword
}

// frameBody returns the body of fn, a function or class static block, or
// nil for a class field.
func frameBody(fn *ast.Node) *ast.Node {
	switch fn.Kind {
	case ast.KindClassStaticBlockDeclaration:
		return fn.AsClassStaticBlockDeclaration().Body
	case ast.KindPropertyDeclaration:
		return nil
	}
	return fn.Body()
}

// forwarding records generator as a generator that a lowered function calls
// with its own this and arguments on every run, as Effect.fnUntraced and
// Effect.fn do, so it runs as its source function, with that function's
// arguments though not its new.target, and returns it. generator is a
// function* expression or the method form, { *name() { … } }.name
// (names.go).
func (tx *lowering) forwarding(generator *ast.Node) *ast.Node {
	fn := generator
	if ast.IsPropertyAccessExpression(fn) || ast.IsElementAccessExpression(fn) {
		fn = fn.Expression().AsObjectLiteralExpression().Properties.Nodes[0]
	}
	tx.frames.forwarders[fn] = true
	return generator
}

// activation is a lowered function that runs as the source function whose
// references hoistFrameReferences rewrites: what it binds as that function
// does, and the bindings it declares, once used, for the references that the
// lowering moved out of it.
type activation struct {
	binds                                                 frameBinding
	super, superSet, superReference, arguments, newTarget *ast.Node
}

// hoistFrameReferences rewrites each super, arguments and new.target
// reference that binder binds and that its lowered form, lowered, holds in a
// function that binds them afresh. Each rewritten reference reads a binding
// that the innermost activation of binder around it that binds the same
// thing declares at the top of its body.
func (tx *lowering) hoistFrameReferences(binder *ast.Node, lowered *ast.Node) *ast.Node {
	if lowered == nil {
		return nil
	}
	ec := tx.EmitContext()
	f := tx.Factory()
	var root *ast.Node            // lowered, or each statement of a plain function's lowered list
	var activations []*activation // binder's activations around the visited node, outermost first
	own := frameBindings(binder)  // what the innermost function around the visited node binds as binder does
	// frameFor returns the innermost activation that binds binding, when the
	// visited node's own function binds it afresh.
	frameFor := func(binding frameBinding) *activation {
		if own&binding != 0 {
			return nil
		}
		for i := len(activations) - 1; i >= 0; i-- {
			if activations[i].binds&binding != 0 {
				return activations[i]
			}
		}
		return nil
	}
	read := func(a *activation, key *ast.Node) *ast.Node {
		if a.super == nil {
			a.super = f.NewUniqueName("super")
		}
		return f.NewCallExpression(a.super, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{key}), ast.NodeFlagsNone)
	}
	write := func(a *activation, key, value *ast.Node) *ast.Node {
		if a.superSet == nil {
			a.superSet = f.NewUniqueName("superSet")
		}
		return f.NewCallExpression(a.superSet, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{key, value}), ast.NodeFlagsNone)
	}
	reference := func(a *activation, key *ast.Node) *ast.Node {
		if a.superReference == nil {
			a.superReference = f.NewUniqueName("superReference")
		}
		if a.super == nil {
			a.super = f.NewUniqueName("super")
		}
		if a.superSet == nil {
			a.superSet = f.NewUniqueName("superSet")
		}
		object := f.NewCallExpression(a.superReference, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{key}), ast.NodeFlagsNone)
		return f.NewPropertyAccessExpression(object, nil /*questionDotToken*/, f.NewIdentifier("value"), ast.NodeFlagsNone)
	}
	visitor := ec.NewNodeVisitor(nil)
	// outside visits what a class or function of the source other than
	// binder evaluates where it is defined: its extends clause, decorators
	// and computed member names. Its members and body bind their own.
	outside := ec.NewNodeVisitor(nil)
	outside.Visit = func(node *ast.Node) *ast.Node {
		switch {
		case ast.IsComputedPropertyName(node), ast.IsDecorator(node), ast.IsHeritageClause(node):
			return visitor.VisitNode(node)
		case ast.IsClassElement(node):
			return outside.VisitEachChild(node)
		}
		return node
	}
	visitor.Visit = func(node *ast.Node) *ast.Node {
		source := ec.ParseNode(node)
		super, arguments, newTarget := frameFor(bindsSuper), frameFor(bindsArguments), frameFor(bindsNewTarget)
		switch {
		case super != nil && isSuperAssignment(node) && !isAssignmentTarget(source):
			binary := node.AsBinaryExpression()
			operator := binary.OperatorToken.Kind
			right := visitor.VisitNode(binary.Right)
			var value *ast.Node
			switch {
			case operator == ast.KindEqualsToken:
				value = write(super, tx.superKey(visitor, binary.Left), right)
			case ast.IsLogicalOrCoalescingAssignmentOperator(operator):
				// super.x ??= v is super_1("x") ?? superSet_1("x", v).
				value = f.NewBinaryExpression(nil /*modifiers*/, read(super, tx.superKey(visitor, binary.Left)), nil /*typeNode*/, f.NewToken(transformers.GetNonAssignmentOperatorForCompoundAssignment(operator)), write(super, tx.superKey(visitor, binary.Left), right))
			default:
				// super.x += v is superSet_1("x", super_1("x") + v).
				current := f.NewBinaryExpression(nil /*modifiers*/, read(super, tx.superKey(visitor, binary.Left)), nil /*typeNode*/, f.NewToken(transformers.GetNonAssignmentOperatorForCompoundAssignment(operator)), right)
				value = write(super, tx.superKey(visitor, binary.Left), current)
			}
			ec.SetOriginal(value, node)
			value.Loc = node.Loc
			return value
		case super != nil && ast.IsCallExpression(node) && isSuperProperty(node.Expression()):
			// super.m(a) is super_1("m").call(this, a): the lookup first, then the arguments.
			method := read(super, tx.superKey(visitor, node.Expression()))
			callee := f.NewPropertyAccessExpression(method, node.QuestionDotToken(), f.NewIdentifier("call"), ast.NodeFlagsNone)
			arguments := append([]*ast.Node{f.NewThisExpression()}, visitor.VisitNodes(node.ArgumentList()).Nodes...)
			call := f.NewCallExpression(callee, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(arguments), ast.NodeFlagsNone)
			ec.SetOriginal(call, node)
			call.Loc = node.Loc
			return call
		case super != nil && ast.IsTaggedTemplateExpression(node) && isSuperProperty(node.AsTaggedTemplateExpression().Tag):
			// super.tag`…` is super_1("tag").bind(this)`…`: the tag is called with this.
			tagged := node.AsTaggedTemplateExpression()
			tag := f.NewFunctionBindCall(read(super, tx.superKey(visitor, tagged.Tag)), f.NewThisExpression(), nil /*argumentsList*/)
			return f.UpdateTaggedTemplateExpression(tagged, tag, tagged.QuestionDotToken, tagged.TypeArguments, visitor.VisitNode(tagged.Template), node.Flags)
		case super != nil && isSuperProperty(node):
			var value *ast.Node
			if isAssignmentTarget(source) {
				value = reference(super, tx.superKey(visitor, node))
			} else {
				value = read(super, tx.superKey(visitor, node))
			}
			ec.SetOriginal(value, node)
			value.Loc = node.Loc
			return value
		case arguments != nil && ast.IsShorthandPropertyAssignment(node) && tx.frames.arguments[ec.ParseNode(node.Name())]:
			// { arguments } is { arguments: arguments_1 }.
			if arguments.arguments == nil {
				arguments.arguments = f.NewUniqueName("arguments")
			}
			property := f.NewPropertyAssignment(nil /*modifiers*/, f.NewIdentifier("arguments"), nil /*postfixToken*/, nil /*typeNode*/, arguments.arguments)
			ec.SetOriginal(property, node)
			property.Loc = node.Loc
			return property
		case arguments != nil && ast.IsIdentifier(node) && tx.frames.arguments[source]:
			if arguments.arguments == nil {
				arguments.arguments = f.NewUniqueName("arguments")
			}
			return arguments.arguments
		case newTarget != nil && isNewTarget(node):
			if newTarget.newTarget == nil {
				newTarget.newTarget = f.NewUniqueName("newTarget")
			}
			return newTarget.newTarget
		case node.Kind == ast.KindArrowFunction:
			return visitor.VisitEachChild(node)
		case ast.IsClassLike(node) && source != nil:
			return outside.VisitEachChild(node)
		case !opensFrame(node):
			return visitor.VisitEachChild(node)
		case source == binder || node == root:
			var binds frameBinding
			switch {
			case tx.frames.forwarders[node]:
				binds = bindsArguments
			case node.Kind == binder.Kind && len(activations) == 0:
				// The function that binder's caller calls. A plain function
				// declaration's $direct variant and its Effect wrapper are
				// two such functions (plain_lower.go).
				binds = frameBindings(binder)
			}
			if binds != 0 {
				a := &activation{binds: binds}
				saved := own
				activations, own = append(activations, a), binds
				visited := visitor.VisitEachChild(node)
				activations, own = activations[:len(activations)-1], saved
				return tx.declareFrameBindings(visited, a)
			}
		case source != nil && opensFrame(source):
			return outside.VisitEachChild(node) // a function of the source binds its own
		}
		// A generator, or another function, that the lowering introduced.
		saved := own
		own = 0
		visited := visitor.VisitEachChild(node)
		own = saved
		return visited
	}
	if lowered.Kind == ast.KindSyntaxList {
		// A plain function declaration's $direct variant, its Effect
		// wrapper and their helpers (plain_lower.go).
		var statements []*ast.Node
		for _, statement := range lowered.AsSyntaxList().Children {
			root = statement
			statements = append(statements, visitor.VisitNode(statement))
		}
		return f.UpdateSyntaxList(lowered.AsSyntaxList(), statements)
	}
	root = lowered
	return visitor.VisitNode(lowered)
}

// isSuperAssignment reports whether node assigns to a super property in a
// form whose key is evaluated once when it is rewritten: super.name with any
// assignment operator, or super[key] = value.
func isSuperAssignment(node *ast.Node) bool {
	if !ast.IsBinaryExpression(node) {
		return false
	}
	binary := node.AsBinaryExpression()
	if !ast.IsAssignmentOperator(binary.OperatorToken.Kind) || !isSuperProperty(binary.Left) {
		return false
	}
	return binary.OperatorToken.Kind == ast.KindEqualsToken || ast.IsPropertyAccessExpression(binary.Left)
}

// isAssignmentTarget reports whether source, a node of the source file or
// nil, is what an assignment, an update, a destructuring assignment or a
// for-in or for-of head writes to.
func isAssignmentTarget(source *ast.Node) bool {
	return source != nil && source.Parent != nil && ast.IsAssignmentTarget(source)
}

// superKey returns the key that the super property node reads, "name" for
// super.name and the visited key for super[key].
func (tx *lowering) superKey(visitor *ast.NodeVisitor, node *ast.Node) *ast.Node {
	if ast.IsPropertyAccessExpression(node) {
		return tx.Factory().NewStringLiteral(node.Name().Text(), ast.TokenFlagsNone)
	}
	return visitor.VisitNode(node.AsElementAccessExpression().ArgumentExpression)
}

// declareFrameBindings returns fn, a lowered function, static block or
// class field that is the activation a, with `const super_1 = (key) =>
// super[key]`, `const superSet_1 = (key, value) => super[key] = value`,
// `const superReference_1 = (key) => ({ get value() { … }, set value(value)
// { … } })`, `const arguments_1 = arguments` and `const newTarget_1 =
// new.target` at the top of its body, after its directives, for the
// bindings that a's references used. A field's initializer becomes an arrow
// that declares them and returns it, called in its place.
func (tx *lowering) declareFrameBindings(fn *ast.Node, a *activation) *ast.Node {
	body := frameBody(fn)
	if a.super == nil && a.superSet == nil && a.superReference == nil && a.arguments == nil && a.newTarget == nil {
		return fn
	}
	if fn.Kind == ast.KindPropertyDeclaration {
		if fn.Initializer() == nil {
			return fn
		}
	} else if body == nil || !ast.IsBlock(body) {
		return fn
	}
	f := tx.Factory()
	ec := tx.EmitContext()
	var declarations []*ast.Node
	declare := func(name, value *ast.Node) {
		declarations = append(declarations, f.NewVariableStatement(nil /*modifiers*/, f.NewVariableDeclarationList(f.NewNodeList([]*ast.Node{
			f.NewVariableDeclaration(name, nil /*exclamationToken*/, nil /*typeNode*/, value),
		}), ast.NodeFlagsConst)))
	}
	if a.super != nil {
		key := f.NewIdentifier("key")
		parameter := f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, key, nil /*questionToken*/, nil /*type*/, nil /*initializer*/)
		read := f.NewElementAccessExpression(f.NewKeywordExpression(ast.KindSuperKeyword), nil /*questionDotToken*/, f.NewIdentifier("key"), ast.NodeFlagsNone)
		declare(a.super, f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList([]*ast.Node{parameter}), nil /*type*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), read))
	}
	if a.superSet != nil {
		key := f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, f.NewIdentifier("key"), nil /*questionToken*/, nil /*type*/, nil /*initializer*/)
		value := f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, f.NewIdentifier("value"), nil /*questionToken*/, nil /*type*/, nil /*initializer*/)
		target := f.NewElementAccessExpression(f.NewKeywordExpression(ast.KindSuperKeyword), nil /*questionDotToken*/, f.NewIdentifier("key"), ast.NodeFlagsNone)
		assign := f.NewBinaryExpression(nil /*modifiers*/, target, nil /*typeNode*/, f.NewToken(ast.KindEqualsToken), f.NewIdentifier("value"))
		declare(a.superSet, f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList([]*ast.Node{key, value}), nil /*type*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), assign))
	}
	if a.superReference != nil {
		// (key) => ({ get value() { return super_1(key); }, set value(value) { superSet_1(key, value); } })
		key := func() *ast.Node { return f.NewIdentifier("key") }
		get := f.NewCallExpression(a.super, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{key()}), ast.NodeFlagsNone)
		getter := f.NewGetAccessorDeclaration(nil /*modifiers*/, f.NewIdentifier("value"), nil /*typeParameters*/, f.NewNodeList(nil), nil /*type*/, nil /*fullSignature*/, f.NewBlock(f.NewNodeList([]*ast.Node{f.NewReturnStatement(get)}), false /*multiLine*/))
		set := f.NewCallExpression(a.superSet, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{key(), f.NewIdentifier("value")}), ast.NodeFlagsNone)
		value := f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, f.NewIdentifier("value"), nil /*questionToken*/, nil /*type*/, nil /*initializer*/)
		setter := f.NewSetAccessorDeclaration(nil /*modifiers*/, f.NewIdentifier("value"), nil /*typeParameters*/, f.NewNodeList([]*ast.Node{value}), nil /*type*/, nil /*fullSignature*/, f.NewBlock(f.NewNodeList([]*ast.Node{f.NewExpressionStatement(set)}), false /*multiLine*/))
		object := f.NewParenthesizedExpression(f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{getter, setter}), false /*multiLine*/))
		parameter := f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, key(), nil /*questionToken*/, nil /*type*/, nil /*initializer*/)
		declare(a.superReference, f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList([]*ast.Node{parameter}), nil /*type*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), object))
	}
	if a.arguments != nil {
		declare(a.arguments, f.NewIdentifier("arguments"))
	}
	if a.newTarget != nil {
		declare(a.newTarget, f.NewMetaProperty(ast.KindNewKeyword, f.NewIdentifier("target")))
	}
	if fn.Kind == ast.KindPropertyDeclaration {
		// field = (() => { const super_1 = …; return initializer; })()
		property := fn.AsPropertyDeclaration()
		block := f.NewBlock(f.NewNodeList(append(declarations, f.NewReturnStatement(property.Initializer))), true /*multiLine*/)
		arrow := f.NewArrowFunction(nil /*modifiers*/, nil /*typeParameters*/, f.NewNodeList(nil), nil /*type*/, nil /*fullSignature*/, f.NewToken(ast.KindEqualsGreaterThanToken), block)
		initializer := f.NewCallExpression(f.NewParenthesizedExpression(arrow), nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList(nil), ast.NodeFlagsNone)
		return f.UpdatePropertyDeclaration(property, fn.Modifiers(), fn.Name(), property.PostfixToken, property.Type, initializer)
	}
	statements := body.Statements()
	directives := 0
	for directives < len(statements) && ast.IsPrologueDirective(statements[directives]) {
		directives++
	}
	all := append(append(append([]*ast.Node{}, statements[:directives]...), declarations...), statements[directives:]...)
	block := f.UpdateBlock(body.AsBlock(), f.NewNodeList(all), body.AsBlock().MultiLine)
	replace := ec.NewNodeVisitor(nil)
	replace.Visit = func(node *ast.Node) *ast.Node {
		if node == body {
			return block
		}
		return node
	}
	return replace.VisitEachChild(fn)
}

// A named function expression's own name.
//
// A function expression's name is bound in its own scope, as arguments is,
// and refers to the function that the caller calls: an Effect function, so
// `self(n - 1)` returns an Effect. A generator that the lowering names after
// it with `function* self` binds the name again, to the generator: the call
// returns an iterator, which Effect rejects, and recursion delegates
// iterators on the JavaScript stack. So when the parameters or body refer to
// the name, the lowering keeps it where the source binds it, on the
// function that the caller calls, and gives the generator the method form,
// which binds nothing: an Effect function expression forwards to it as a
// function declaration does (selfBoundFunction), and a producer keeps its
// plain function's name (visitProducer).

// refersToOwnName reports whether fn is a named function expression whose
// parameters or body may refer to its name. It answers true for a name that
// a nested scope declares, which only costs the forwarding form.
func refersToOwnName(fn *ast.Node) bool {
	if fn.Kind != ast.KindFunctionExpression || fn.Name() == nil {
		return false
	}
	name := fn.Name().Text()
	for _, parameter := range fn.Parameters() {
		if refersTo(parameter, name) {
			return true
		}
	}
	return refersTo(fn.Body(), name)
}

// nameFreeGenerator returns `{ *name(parameters) { body } }.name`, the
// generator for original, which a stack trace shows as name but which binds
// no name in its body.
func (tx *lowering) nameFreeGenerator(original *ast.Node, name string, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	method := f.NewMethodDeclaration(nil /*modifiers*/, f.NewToken(ast.KindAsteriskToken), f.NewIdentifier(name), nil /*postfixToken*/, nil /*typeParameters*/, parameters, nil /*type*/, nil /*fullSignature*/, body)
	tx.EmitContext().SetOriginal(method, original) // the method binds what original binds
	object := f.NewObjectLiteralExpression(f.NewNodeList([]*ast.Node{method}), false /*multiLine*/)
	generator := f.NewPropertyAccessExpression(object, nil /*questionDotToken*/, f.NewIdentifier(name), ast.NodeFlagsNone)
	tx.EmitContext().SetOriginal(generator, original)
	return generator
}

// selfBoundFunction lowers fn, a named Effect function expression that
// refers to its own name, with its lowered parameters and body, as
// visitEffectFunctionDeclaration lowers a declaration: the function
// expression keeps the name and forwards its this and arguments to the
// generator on every call.
//
//	const recursive = function self(arg_1) {
//	  return Effect.fnUntraced({ *self(n) { … yield* self(n - 1) … } }.self).apply(this, arguments);
//	};
func (tx *lowering) selfBoundFunction(fn *ast.Node, parameters *ast.NodeList, body *ast.Node) *ast.Node {
	f := tx.Factory()
	generator := tx.forwarding(tx.nameFreeGenerator(fn, fn.Name().Text(), parameters, body))
	lowered := tx.wrapGenerator("fnUntraced", fn, tx.generatedFunctions(generator))
	apply := f.NewPropertyAccessExpression(lowered, nil /*questionDotToken*/, f.NewIdentifier("apply"), ast.NodeFlagsNone)
	call := f.NewCallExpression(apply, nil /*questionDotToken*/, nil /*typeArguments*/, f.NewNodeList([]*ast.Node{f.NewThisExpression(), f.NewIdentifier("arguments")}), ast.NodeFlagsNone)
	// Placeholder parameters keep the function's length, as a declaration's do.
	var placeholders []*ast.Node
	for _, parameter := range fn.Parameters() {
		if ast.IsIdentifier(parameter.Name()) && parameter.Name().Text() == "this" {
			continue
		}
		if parameter.Initializer() != nil || parameter.AsParameterDeclaration().DotDotDotToken != nil {
			break
		}
		placeholders = append(placeholders, f.NewParameterDeclaration(nil /*modifiers*/, nil /*dotDotDotToken*/, f.NewUniqueName("arg"), nil /*questionToken*/, nil /*type*/, nil /*initializer*/))
	}
	var statements []*ast.Node
	for _, statement := range fn.Body().Statements() {
		if !ast.IsPrologueDirective(statement) {
			break
		}
		statements = append(statements, f.NewExpressionStatement(f.NewStringLiteralFromNode(statement.Expression())))
	}
	statements = append(statements, tx.generated(f.NewReturnStatement(call)))
	expression := f.NewFunctionExpression(nil /*modifiers*/, nil /*asteriskToken*/, fn.Name(), nil /*typeParameters*/, f.NewNodeList(placeholders), nil /*type*/, nil /*fullSignature*/, f.NewBlock(f.NewNodeList(statements), true /*multiLine*/))
	tx.EmitContext().SetOriginal(expression, fn)
	expression.Loc = fn.Loc
	return expression
}
