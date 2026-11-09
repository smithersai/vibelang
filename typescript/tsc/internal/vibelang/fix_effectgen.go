package vibelang

import (
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Generator classification used by diagnostics.

// isGeneratorExpression reports whether node is a function* written in place.
func isGeneratorExpression(node *ast.Node) bool {
	return ast.IsFunctionExpression(node) && node.BodyData().AsteriskToken != nil
}

// A generatorCall is an Effect.gen or Effect.fn call, as EK1002's fix reads it.
type generatorCall struct {
	generator   *ast.Node
	isFn        bool        // Effect.fn or Effect.fnUntraced, not Effect.gen
	span        []*ast.Node // Effect.fn("n", options)'s arguments
	stages      []*ast.Node // the stages after an Effect.fn's generator
	module      string      // the text that names Effect at the call
	selfIsThis  bool        // Effect.gen({ self: this }, …)
	returns     string      // the Effect type an Effect.fn.Return<A, E, R> annotation names, or ""
	outerReturn string      // the original final named function contract when requirements remain generic
}

// readGeneratorCall reads call. It returns nil for a call of another API,
// such as Option.gen, and why it cannot be rewritten as the second result.
func readGeneratorCall(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (*generatorCall, string) {
	if !ast.IsCallExpression(call) {
		return nil, ""
	}
	callee := call.Expression()
	arguments := call.Arguments()
	g := &generatorCall{}
	switch {
	case isEffectFunction(c, callee, "Effect", "gen"):
		if call.TypeArguments() != nil || len(arguments) == 0 || len(arguments) > 2 {
			return g, "the call has type arguments or an unusual argument list"
		}
		g.generator = arguments[len(arguments)-1]
		if len(arguments) == 2 {
			if !isSelfThisOption(arguments[0]) {
				return g, "its self option is not { self: this }"
			}
			g.selfIsThis = true
		}
	case isEffectFunction(c, callee, "Effect", "fn", "fnUntraced"):
		if call.TypeArguments() != nil || len(arguments) == 0 {
			return g, "the call has type arguments"
		}
		g.isFn, g.generator, g.stages = true, arguments[0], arguments[1:]
	case ast.IsCallExpression(callee) && isEffectFunction(c, callee.Expression(), "Effect", "fn"):
		if callee.TypeArguments() != nil || call.TypeArguments() != nil || len(arguments) == 0 || len(callee.Arguments()) == 0 {
			return g, "the call has type arguments"
		}
		g.isFn, g.generator, g.stages, g.span = true, arguments[0], arguments[1:], callee.Arguments()
		callee = callee.Expression()
	default:
		return nil, ""
	}
	if ast.IsPropertyAccessExpression(callee) {
		g.module = nodeText(file, callee.Expression())
	} else {
		g.module = "Effect" // Effect's own function, named by a bare global
	}
	generator := g.generator
	if !isGeneratorExpression(generator) || ast.GetFunctionFlags(generator)&ast.FunctionFlagsAsync != 0 || generator.Body() == nil ||
		!g.isFn && (len(generator.Parameters()) > 0 || generator.TypeParameters() != nil) {
		return g, "its generator is not a function* () { … } written in place"
	}
	if generator.Type() != nil {
		// Effect.fn's generator may say what its function's Effect is:
		// function* (): Effect.fn.Return<A, E, R> is effect (): Effect.Effect<A, E, R>.
		if g.isFn {
			if g.returns = fnReturnEffectType(file, generator.Type()); g.returns == "" {
				return g, "its generator has a return type other than Effect.fn.Return"
			}
			// A bare return in an invalid written contract cannot be repaired
			// by moving that same error into a generated cold function.
			result := c.GetTypeFromTypeNode(generator.Type().TypeArguments()[0])
			if !c.IsTypeAssignableTo(c.GetUndefinedType(), result) {
				bare := false
				var visit func(*ast.Node) bool
				visit = func(node *ast.Node) bool {
					if ast.IsFunctionLike(node) {
						return false
					}
					if ast.IsReturnStatement(node) && node.AsReturnStatement().Expression == nil {
						bare = true
						return true
					}
					return node.ForEachChild(visit)
				}
				generator.Body().ForEachChild(visit)
				if bare {
					return g, "a bare return does not satisfy its written success type"
				}
			}
		} else {
			// A generator alias or Effect.fn.Return also contextualizes gen's
			// success expressions. Retain the checked call's complete Effect
			// contract beside the converted body, including aliases and generics.
			returned := c.GetTypeAtLocation(call)
			if !isEffectType(c, returned) {
				return g, "its annotated generator does not resolve to an Effect"
			}
			g.returns = c.TypeToStringEx(returned, generator, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
		}
	}
	// withSpan excludes ParentSpan from requirements. For an open generic
	// requirement that changes the public contract of Effect.fn, which retains
	// its original R. Keep the checked final result outside every stage; an
	// inner body annotation would accidentally apply a stage's output to its input.
	if g.isFn && g.span != nil {
		if signature := singleCallSignature(c, c.GetTypeAtLocation(call)); signature != nil {
			returned := c.GetReturnTypeOfSignature(signature)
			if isEffectType(c, returned) && effectFnOpenRequirement(c, channelType(c, returned, "_R"), map[*checker.Type]bool{}) {
				g.outerReturn = c.TypeToStringEx(returned, generator, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
			}
		}
	}
	// Effect.fn can also receive its result contract from the declaration
	// that holds it. Keep that contextual return type beside the body,
	// including when withSpan introduces a generic call around the program.
	if g.isFn && g.span != nil && g.returns == "" && len(g.stages) == 0 {
		if contextual := c.GetContextualType(call, checker.ContextFlagsNone); contextual != nil {
			if signatures := c.GetSignaturesOfType(contextual, checker.SignatureKindCall); len(signatures) == 1 {
				// Generic callbacks such as Option.match infer their return type
				// from this still-unfixed generator. Its instantiated any channels
				// are not a source contract and must not become an annotation.
				decl := signatures[0].Declaration()
				if decl == nil || decl.Type() == nil || !isEffectType(c, c.GetTypeFromTypeNode(decl.Type())) {
					return g, ""
				}
				if returned := c.GetReturnTypeOfSignature(signatures[0]); isEffectType(c, returned) {
					g.returns = contextualFnContract(c, generator, returned, c.GetTypeAtLocation(call))
				}
			}
		}
	}
	return g, ""
}

// contextualFnContract writes the contract of an Effect.fn whose result type
// comes from its context: the Effect type of the checked call, which
// TypeScript infers with that context. The context types the body's return
// expressions there (a literal such as schemaVersion: 1 stays 1), and under
// the generated withSpan call it would not. The context itself is not the
// contract: one that also feeds inference, such as satisfies or a generic
// parameter, would widen the inferred and declared type.
func contextualFnContract(c *checker.Checker, generator *ast.Node, contextual *checker.Type, checked *checker.Type) string {
	if signature := singleCallSignature(c, checked); signature != nil {
		if actual := c.GetReturnTypeOfSignature(signature); isEffectType(c, actual) {
			contextual = actual
		}
	}
	return c.TypeToStringEx(contextual, generator, checker.TypeFormatFlagsNoTruncation|checker.TypeFormatFlagsUseFullyQualifiedType, nil)
}

// effectFnOpenRequirement finds a generic requirement even inside a union,
// intersection, indexed access, conditional type or generic service wrapper.
func effectFnOpenRequirement(c *checker.Checker, t *checker.Type, seen map[*checker.Type]bool) bool {
	if t == nil || seen[t] {
		return false
	}
	seen[t] = true
	if t.Flags()&(checker.TypeFlagsTypeParameter|checker.TypeFlagsIndexedAccess|checker.TypeFlagsConditional) != 0 {
		return true
	}
	if t.Flags()&(checker.TypeFlagsUnion|checker.TypeFlagsIntersection) != 0 {
		for _, member := range t.Types() {
			if effectFnOpenRequirement(c, member, seen) {
				return true
			}
		}
	}
	if t.Flags()&checker.TypeFlagsObject != 0 && t.ObjectFlags()&checker.ObjectFlagsReference != 0 {
		for _, argument := range c.GetTypeArguments(t) {
			if effectFnOpenRequirement(c, argument, seen) {
				return true
			}
		}
	}
	return false
}

// fnReturnEffectType returns the Effect type that t, a written
// Ns.fn.Return<A, E, R>, names, Ns.Effect<A, E, R>, or "" for another type.
func fnReturnEffectType(file *ast.SourceFile, t *ast.Node) string {
	if !ast.IsTypeReferenceNode(t) || t.TypeArguments() == nil || len(t.TypeArguments()) == 0 || len(t.TypeArguments()) > 3 {
		return ""
	}
	name := t.AsTypeReferenceNode().TypeName
	if !ast.IsQualifiedName(name) || name.AsQualifiedName().Right.Text() != "Return" {
		return ""
	}
	fn := name.AsQualifiedName().Left
	if !ast.IsQualifiedName(fn) || fn.AsQualifiedName().Right.Text() != "fn" || !ast.IsIdentifier(fn.AsQualifiedName().Left) {
		return ""
	}
	var arguments []string
	for _, argument := range t.TypeArguments() {
		arguments = append(arguments, nodeText(file, argument))
	}
	return fn.AsQualifiedName().Left.Text() + ".Effect<" + strings.Join(arguments, ", ") + ">"
}

// isSelfThisOption reports whether node is Effect.gen's options object
// { self: this }.
func isSelfThisOption(node *ast.Node) bool {
	if !ast.IsObjectLiteralExpression(node) {
		return false
	}
	properties := node.AsObjectLiteralExpression().Properties.Nodes
	if len(properties) != 1 || !ast.IsPropertyAssignment(properties[0]) {
		return false
	}
	name := properties[0].Name()
	return ast.IsIdentifier(name) && name.Text() == "self" && properties[0].Initializer().Kind == ast.KindThisKeyword
}

// effectGenScan is what a generator's body holds that its rewrite depends on.
type effectGenScan struct {
	yields    []*ast.Node // the body's yield* expressions, outermost first
	pipes     []*ast.Node // the .pipe calls of an Effect in it, which the rewrite writes as pipes
	throws    []*ast.Node // the throw statements of its own code
	held      []*ast.Node // const initializers that build a program
	discarded []*ast.Node // expressions whose cold result the original statement discards
	throwing  []*ast.Node // the calls in its own code whose throws would join E
	usesThis  bool        // the body reads this, its own or through an arrow
	why       string      // the first construct whose rewrite would mean something else
}

// heldProgram returns the initializer of node, a variable declaration, when
// it builds a program that a later statement runs: a call or a pipe of an
// Effect, with no yield* in it, in a declaration with no type.
func heldProgram(c *checker.Checker, node *ast.Node) *ast.Node {
	initializer := node.Initializer()
	if initializer == nil || node.Type() != nil {
		return nil
	}
	inner := ast.SkipParentheses(initializer)
	if !isPipe(inner) && !(isPipeCall(inner) && isEffectPipeline(c, inner)) && !(isInvocation(inner) && callReturnsEffect(c, inner)) {
		return nil
	}
	var holdsYield func(n *ast.Node) bool
	holdsYield = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		return ast.IsYieldExpression(n) || n.ForEachChild(holdsYield)
	}
	if holdsYield(inner) {
		return nil
	}
	return initializer
}

// markPipeCalls adds to operands each call of node's pipeline, |> or .pipe,
// which the pipeline holds or which stands in a stage that it applies.
func markPipeCalls(node *ast.Node, operands map[*ast.Node]bool) {
	for node = ast.SkipParentheses(node); ; {
		switch {
		case isPipe(node):
			operands[ast.SkipParentheses(node.AsBinaryExpression().Right)] = true
			node = ast.SkipParentheses(node.AsBinaryExpression().Left)
		case isPipeCall(node):
			for _, stage := range node.Arguments() {
				operands[ast.SkipParentheses(stage)] = true
			}
			node = ast.SkipParentheses(node.Expression().Expression())
		default:
			operands[node] = true
			return
		}
		operands[node] = true
	}
}

// scanEffectGenBody reads generator's body for its rewrite.
func scanEffectGenBody(c *checker.Checker, a *analyzer, file *ast.SourceFile, generator *ast.Node) *effectGenScan {
	s := &effectGenScan{}
	name := ""
	if generator.Name() != nil {
		name = generator.Name().Text()
	}
	operands := map[*ast.Node]bool{} // the calls that yield* runs or a program holds
	effectCode := 0                  // depth of effect functions and blocks, an earlier fix's, which run with try
	var throwing *ast.Node           // the wrapped call this visit stands inside
	var visit func(node *ast.Node, own, lexical bool, callback *ast.Node) bool
	visit = func(node *ast.Node, own, lexical bool, callback *ast.Node) bool {
		if s.why != "" {
			return true
		}
		switch {
		case isFunctionBoundary(node):
			if ast.IsFunctionLike(node) && node.BodyData() != nil && node.BodyData().AsteriskToken != nil {
				s.why = "it holds another function*; its Effect.gen is fixed first, when it can be"
				return true
			}
			arrow := ast.IsArrowFunction(node)
			inner := callback
			if ast.IsFunctionLike(node) {
				inner = node
			}
			if node.Flags&ast.NodeFlagsVibeLangEffect != 0 {
				effectCode++
				defer func() { effectCode-- }()
			}
			return node.ForEachChild(func(child *ast.Node) bool { return visit(child, false, lexical && arrow, inner) })
		case node.Kind == ast.KindThisKeyword:
			if lexical {
				s.usesThis = true
			}
		case node.Kind == ast.KindSuperKeyword:
			if lexical {
				s.why = "the generator reads super"
			}
		case ast.IsMetaProperty(node) && node.AsMetaProperty().KeywordToken == ast.KindNewKeyword:
			if lexical {
				s.why = "the generator reads new.target"
			}
		case ast.IsIdentifier(node) && node.Text() == "arguments" && lexical && readsBinding(node):
			s.why = "the generator reads its own arguments"
		case ast.IsIdentifier(node) && name != "" && node.Text() == name && node != generator.Name() && readsBinding(node) && !generatorKeepsName(c, generator):
			s.why = "the generator refers to itself by its name, " + name
		case ast.IsYieldExpression(node):
			if node.AsYieldExpression().AsteriskToken == nil || node.Expression() == nil {
				s.why = "it yields a value with yield, not yield*"
				return true
			}
			if !own {
				s.why = "a yield* stands outside the generator's own code"
				return true
			}
			s.yields = append(s.yields, node)
			operand := ast.SkipParentheses(node.Expression())
			if isInvocation(operand) {
				operands[operand] = true
			}
			if isPipe(operand) || isPipeCall(operand) && isEffectPipeline(c, operand) {
				markPipeCalls(operand, operands)
			}
		case ast.IsThrowStatement(node):
			if own {
				s.throws = append(s.throws, node)
			}
		case ast.IsTryStatement(node):
			if own {
				s.why = "a try statement in a generator catches JavaScript exceptions, which in VibeLang it would not, and catches expected failures"
			}
		case ast.IsVariableDeclarationList(node) && node.Flags&ast.NodeFlagsUsing != 0:
			s.why = "a using declaration in a generator disposes as JavaScript does, which in VibeLang would hold a scope"
		case ast.IsExpressionStatement(node) && effectCode == 0:
			expression := node.Expression()
			if !isDiscardingForm(expression) && isEffectType(c, c.GetTypeAtLocation(expression)) {
				s.discarded = append(s.discarded, expression)
			}
		case ast.IsVariableDeclaration(node) && own:
			if held := heldProgram(c, node); held != nil {
				s.held = append(s.held, held)
				inner := ast.SkipParentheses(held)
				operands[inner] = true
				if isPipeCall(inner) {
					s.pipes = append(s.pipes, inner)
				}
				markPipeCalls(inner, operands)
			}
		case isPipe(node) || isPipeCall(node) && isEffectPipeline(c, node):
			if isPipeCall(node) {
				s.pipes = append(s.pipes, node)
			}
			markPipeCalls(node, operands)
		case ast.IsNewExpression(node) && own && effectCode == 0 && throwing == nil && needsGeneratorDefectBridge(c, node):
			if holdsYield(node) {
				s.why = "a throwing constructor has a yield* in its operands"
				return true
			}
			if foreignInvocationHasDirectEval(node) {
				s.why = "a throwing constructor has direct eval in its operands"
				return true
			}
			s.throwing = append(s.throwing, node)
			throwing = node
			defer func() { throwing = nil }()
		case isInvocation(node) && !operands[node] && effectCode == 0:
			if why := effectGenCallMeaning(c, a, file, node, own, callback); why != "" {
				s.why = why
				return true
			}
			if own && throwing == nil && isInvocation(node) && needsGeneratorDefectBridge(c, node) {
				if holdsYield(node) {
					s.why = shortText(expressionText(file, node), "a call") + " can throw, and a yield* stands in its arguments, where the function that keeps its exception a defect could not run it"
					return true
				}
				s.throwing = append(s.throwing, node)
				throwing = node
				defer func() { throwing = nil }()
			}
		case isInvocation(node) && operands[node] && effectCode == 0 && own && throwing == nil && !isPipeCall(node) && needsGeneratorDefectBridge(c, node):
			// A pipe's stage or receiver that a call builds, as
			// effect.pipe(instances.provide(session)), runs where the pipe
			// stands, and the generator meets its exception as a defect. What
			// the call means follows from the pipe, so the case above passes
			// over it, but a foreign call there needs the bridge all the same
			// (opencode's server handlers: EK0403 in the rewrite).
			if holdsYield(node) {
				s.why = shortText(expressionText(file, node), "a call") + " can throw, and a yield* stands in its arguments, where the function that keeps its exception a defect could not run it"
				return true
			}
			s.throwing = append(s.throwing, node)
			throwing = node
			defer func() { throwing = nil }()
		}
		return node.ForEachChild(func(child *ast.Node) bool { return visit(child, own, lexical, callback) })
	}
	generator.Body().ForEachChild(func(child *ast.Node) bool { return visit(child, true, true, nil) })
	return s
}

// readsBinding reports whether an identifier reads a binding: an expression
// that is not the member name of input.arguments, or the name of the shorthand
// { arguments }, which reads the binding it names.
func readsBinding(node *ast.Node) bool {
	if ast.IsShorthandPropertyAssignment(node.Parent) && node.Parent.Name() == node {
		return true
	}
	return ast.IsExpressionNode(node) && !ast.IsRightSideOfPropertyAccess(node)
}

// A native generator observes synchronous call exceptions as defects. The
// migrated Effect body needs the same bridge for unknown contracts as for
// named failures. Proven never contracts and effectful factories need none.
func needsGeneratorDefectBridge(c *checker.Checker, call *ast.Node) bool {
	if ast.IsSuperCall(call) || ast.IsImportCall(call) {
		return false
	}
	t := callTrust(c, call)
	if t.promise || returnsEffectful(c, call) {
		return false
	}
	switch t.kind {
	case trustForeign, trustUnknown:
		return true
	case trustBuiltin:
		return len(t.failures) > 0 || t.unknown
	case trustTagged:
		return !t.value && (len(t.failures) > 0 || t.unknown || t.unreachable != "")
	default:
		return false
	}
}

// holdsYield reports whether a yield runs in node's own code.
func holdsYield(node *ast.Node) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		found = found || ast.IsYieldExpression(n)
		return found || n.ForEachChild(visit)
	}
	node.ForEachChild(visit)
	return found
}

// generatorKeepsName reports whether generator's rewrite keeps its name: an
// Effect.fn's keeps it, as effect function name.
func generatorKeepsName(c *checker.Checker, generator *ast.Node) bool {
	parent := generator.Parent
	return parent != nil && ast.IsCallExpression(parent) && len(parent.Arguments()) > 0 && parent.Arguments()[0] == generator && !isEffectFunction(c, parent.Expression(), "Effect", "gen")
}

// effectGenCallMeaning returns why call, which no yield* runs, would mean
// something else in the rewrite, or "". In the generator's own code a call
// that builds a program builds it; in VibeLang it would run. In a callback,
// such as forEach's, a call that builds the program the callback returns keeps
// its meaning: the callback becomes an Effect function that runs it.
func effectGenCallMeaning(c *checker.Checker, a *analyzer, file *ast.SourceFile, call *ast.Node, own bool, callback *ast.Node) string {
	if !a.performs(call) {
		return ""
	}
	label := shortText(expressionText(file, call), "a call")
	if own {
		return label + " builds a program that no yield* runs, and in VibeLang it would run where it stands"
	}
	outer := call
	for ast.IsParenthesizedExpression(outer.Parent) {
		outer = outer.Parent
	}
	if callback != nil && (outer.Parent == callback && callback.Body() == outer || ast.IsReturnStatement(outer.Parent) && ast.GetContainingFunction(outer.Parent) == callback) {
		return ""
	}
	return "in a callback, " + label + " builds a program that the callback does not return, and in VibeLang it would run where it stands"
}

// holdsEffectValue reports whether t, or a member of its union, is an Effect value.
func holdsEffectValue(c *checker.Checker, t *checker.Type) bool {
	return slices.ContainsFunc(t.Distributed(), func(member *checker.Type) bool { return isEffectValueType(c, member) })
}

// isYieldableError reports whether t is an error instance that is also an
// Effect that fails with itself, as Data.TaggedError's are.
func isYieldableError(c *checker.Checker, t *checker.Type) bool {
	effect := effectOfValue(c, t)
	if effect == nil || c.GetPropertyOfType(t, "message") == nil || c.GetPropertyOfType(t, "stack") == nil {
		return false
	}
	success := successType(c, effect)
	return success != nil && success.Flags()&checker.TypeFlagsNever != 0
}

// failsAsError reports whether t is an error that yield* fails with: an
// Effect error instance (isYieldableError), or, while the checker has not
// resolved its Effect channels yet, a class that extends effect's
// YieldableError.
func failsAsError(c *checker.Checker, t *checker.Type) bool {
	return isYieldableError(c, t) || extendsYieldableError(c, t, 0)
}

// yieldsEffect reports whether t is an Effect.Yieldable that is no Effect:
// a value whose asEffect() gives the Effect yield* runs, as alchemy's Output
// does. try x of one runs it as try x.asEffect().
func yieldsEffect(c *checker.Checker, t *checker.Type) bool {
	property := c.GetPropertyOfType(t, "asEffect")
	if property == nil {
		return false
	}
	for _, signature := range c.GetSignaturesOfType(c.GetTypeOfSymbol(property), checker.SignatureKindCall) {
		if len(signature.Parameters()) == 0 && isEffectType(c, c.GetReturnTypeOfSignature(signature)) {
			return true
		}
	}
	return false
}

// hasComment reports whether text, source between tokens, holds a comment.
func hasComment(text string) bool {
	return strings.Contains(text, "//") || strings.Contains(text, "/*")
}

// effectFnTypeHasImport reads type syntax rather than matching string literals
// that happen to contain the word import.
func effectFnTypeHasImport(text string) bool {
	if !strings.Contains(text, "import") {
		return false
	}
	file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/parameter.ts", PathKey: "/parameter.ts"}, "type Parameter = "+text, core.ScriptKindTS)
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		return ast.IsImportTypeNode(node) || node.ForEachChild(visit)
	}
	return visit(file.AsNode())
}
