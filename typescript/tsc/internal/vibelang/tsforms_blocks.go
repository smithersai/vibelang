package vibelang

import (
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
)

// EK4836 (D290): combinators that wrap a program, which VibeLang writes as the
// global withSpan or a provide block around the statements:
//
//	return try Effect.withSpan(load(id), "load")      return try withSpan(load(id), "load")
//	return try Effect.provide(main(), AppLive)        provide AppLive { return try main() }
//
// Effect.withSpan(self, name) is the global withSpan (VIP-6) wherever it
// stands, unless a local withSpan shadows it. A running Effect.provide(self,
// layers) becomes a provide block (VIP-12) where a block can stand: as a
// return, whose return inside the block returns from the function, and as an
// expression statement. A layer array becomes the block's comma list. The
// block evaluates its program after the providers, and after the layers
// build, where the call evaluated it first, so only a program whose
// evaluation does nothing moves (coldProgram). Refused: options arguments,
// the data-last forms inside pipe, a provide that does not run or stands
// where a block cannot, and anything outside a function body.

// Effect.provideService retains its native call: building a Layer would
// change scope and memo-map observations, so VIP-34 forbids that repair.

// withSpanGlobalForm is EK4836 for Effect.withSpan, which the global spells.
var withSpanGlobalForm = EK4836.With("{0} is the global withSpan written through Effect; write {1}.")

// Explicit instantiation can widen the result beyond a provide block's type.
var provideTypeArgumentsForm = EK4836.With("{0} has an explicit type-argument contract; keep the native call.")

var blockOptionalCallForm = EK4836.With("{0} uses optional chaining; keep the native call.")

var blockSpreadCallForm = EK4836.With("{0} uses spread arguments; keep the native call.")

// VIP-12 builds a Layer for Key = value; the native provideService does not.
// VIP-34 permits a quick fix only when it preserves that observable behavior.
var provideServiceNativeForm = EK4836.With("{0} installs a service without building a Layer; keep the native call.")

func init() {
	tsFormRules[EK4836.Code] = &tsFormRule{
		message: EK4836,
		find:    findBlockForms,
	}
}

// blockFormOf returns the combinator call calls in its data-first form, or "".
func blockFormOf(c *checker.Checker, call *ast.Node) string {
	if !ast.IsCallExpression(call) || !inLowerableBody(call) || inHatch(call) {
		return ""
	}
	spread := hasSpreadFormArguments(call)
	name := directEffectFormName(c, call.Expression(), "withSpan", "provide", "provideService")
	if name == "" {
		return ""
	}
	if (ast.IsOptionalChain(call) || spread) && name == "withSpan" {
		return ""
	}
	if call.TypeArguments() != nil && name != "provide" && name != "provideService" {
		return ""
	}
	if spread {
		if name != "withSpan" && directTryFormSite(call) != nil && isEffectType(c, effectOperandType(c, call)) {
			return name
		}
		return ""
	}
	switch {
	case name == "withSpan" && len(call.Arguments()) == 2:
		if ast.IsPropertyAccessExpression(call.Expression()) {
			return name
		}
	case name == "provide" && len(call.Arguments()) == 2, name == "provideService" && len(call.Arguments()) == 3:
		if directTryFormSite(call) != nil {
			return name
		}
	}
	return ""
}

// findBlockForms reports EK4836 at each such call of file that a block form
// writes.
func findBlockForms(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if name := blockFormOf(c, node); name != "" {
			message, example := blockFormDiagnostic(c, file, node, name)
			if message != nil {
				report(node, &formRewrite{message: message}, "Effect."+name, example)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// coldProgram reports whether evaluating node, a program, does nothing: it
// reads a stable binding, or calls an effect function, which builds its Effect
// and runs nothing, with arguments that are cold too.
func coldProgram(c *checker.Checker, file *ast.SourceFile, node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	if ast.IsLiteralExpression(node) || stableBindingRead(c, file, node) {
		return true
	}
	if !ast.IsCallExpression(node) || isTry(node) || ast.IsOptionalChain(node) {
		return false
	}
	signature := c.GetResolvedSignature(node)
	if signature == nil || signature.Declaration() == nil {
		return false
	}
	if !isMarkedEffect(signature.Declaration()) {
		return false
	}
	return !slices.ContainsFunc(node.Arguments(), func(argument *ast.Node) bool { return !coldProgram(c, file, argument) })
}

// stableBindingRead reports whether node reads a binding whose value no
// other argument of its call can change: an import, a const, or a parameter
// or let that the file never assigns. Reading it after the other arguments
// is then unobservable, so the block may run its program.
func stableBindingRead(c *checker.Checker, file *ast.SourceFile, node *ast.Node) bool {
	if !ast.IsIdentifier(node) {
		return false
	}
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		return true // an import binding: only its own module assigns it
	}
	declaration := symbol.ValueDeclaration()
	switch {
	case declaration == nil:
		return false
	case ast.IsVariableDeclaration(declaration):
		if ast.IsVarConstLike(declaration) {
			return true
		}
		if ast.GetCombinedNodeFlags(declaration)&ast.NodeFlagsBlockScoped == 0 {
			return false // var: hoisted, and redeclarable with an initializer
		}
	case declaration.Kind == ast.KindParameter:
	default:
		return false
	}
	assigned := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && ast.IsAssignmentTarget(n) && c.GetSymbolAtLocation(n) == symbol {
			assigned = true
		}
		return assigned || n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return !assigned
}

// blockFormDiagnostic selects the advice for a recognized combinator.
func blockFormDiagnostic(c *checker.Checker, file *ast.SourceFile, call *ast.Node, name string) (*Message, string) {
	message := EK4836
	example := "withSpan(program, name)"
	switch name {
	case "provide":
		example = "provide Layer { … }"
	case "provideService":
		example = "provide Key = value { … }"
	}
	switch {
	case ast.IsElementAccessExpression(call.Expression()):
	case hasSpreadFormArguments(call):
		message = blockSpreadCallForm
	case ast.IsOptionalChain(call):
		message = blockOptionalCallForm
	case name != "withSpan" && call.TypeArguments() != nil:
		message = provideTypeArgumentsForm
	case name == "withSpan":
		if shadowed(call, "withSpan") {
			return nil, ""
		}
		message = withSpanGlobalForm
	case name == "provideService" && directTryFormSite(call) == call:
		args := call.Arguments()
		operand := ast.SkipParentheses(args[0])
		if (ast.IsReturnStatement(call.Parent) || ast.IsExpressionStatement(call.Parent)) &&
			analyzerFor(c).runs(call) && ast.IsEntityNameExpression(args[1]) &&
			isEffectType(c, c.GetTypeAtLocation(operand)) &&
			(isEffectBlock(operand) || coldProgram(c, file, operand)) {
			message = provideServiceNativeForm
		}
	}
	return message, example
}
