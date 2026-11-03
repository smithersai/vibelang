package vibelang

import (
	"slices"
	"strings"

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

// VIP-12 builds a Layer for Key = value; the native provideService does not.
// VIP-34 permits a quick fix only when it preserves that observable behavior.
var provideServiceNativeForm = EK4836.With("{0} installs a service without building a Layer; keep the native call.")

const provideServiceScopeNote = "No quick fix: a provide block builds a Layer and changes Scope and Layer.CurrentMemoMap; keep Effect.provideService to preserve its behavior."

func init() {
	tsFormRules[EK4836.Code] = &tsFormRule{
		message:   EK4836,
		find:      findBlockForms,
		plan:      blockFormRewrite,
		diagnosed: ast.IsCallExpression,
	}
}

// blockFormOf returns the combinator call calls in its data-first form, or "".
func blockFormOf(c *checker.Checker, call *ast.Node) string {
	if !ast.IsCallExpression(call) || call.TypeArguments() != nil || !inLowerableBody(call) || inHatch(call) || ast.IsOptionalChain(call) {
		return ""
	}
	for _, argument := range call.Arguments() {
		if ast.IsSpreadElement(argument) {
			return ""
		}
	}
	if !isEffectFunction(c, call.Expression(), "Effect", "withSpan", "provide", "provideService") {
		return ""
	}
	_, name := effectMember(c, call.Expression())
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
			rewrite := blockFormRewrite(c, file, node)
			if rewrite == nil && name != "withSpan" {
				rewrite = &formRewrite{why: directTrySafetyNote}
			}
			if rewrite != nil {
				form := "withSpan(program, name)"
				switch name {
				case "provide":
					form = "provide Layer { … }"
				case "provideService":
					form = "provide Key = value { … }"
				}
				report(node, rewrite, "Effect."+name, form)
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// blockFormRewrite plans EK4836's fix for call.
func blockFormRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	name := blockFormOf(c, call)
	if name == "" {
		return nil
	}
	if name != "withSpan" && directTryFormSite(call) != call {
		return &formRewrite{why: directTryWrapperNote}
	}
	arguments := call.Arguments()
	if name == "withSpan" {
		if shadowed(call, "withSpan") {
			return nil
		}
		callee := call.Expression()
		result := "withSpan" + file.Text()[callee.End():call.End()]
		return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{nodeStart(file, callee), callee.End(), "withSpan"}}, description: shortText(result, "the global withSpan"), message: withSpanGlobalForm})
	}
	operand := ast.SkipParentheses(arguments[0])
	if !isEffectType(c, c.GetTypeAtLocation(operand)) {
		return nil
	}
	program := tryText(arguments[0], expressionText(file, arguments[0]))
	text := file.Text()
	start, end := nodeStart(file, call), call.End()
	indent := lineIndent(text, start)
	var result string
	switch name {
	case "provide", "provideService":
		statement := call.Parent
		returns := ast.IsReturnStatement(statement)
		if !returns && !ast.IsExpressionStatement(statement) {
			return &formRewrite{why: blockPositionNote}
		}
		if !analyzerFor(c).runs(call) {
			return &formRewrite{why: blockPositionNote}
		}
		if !coldProgram(c, file, operand) {
			return &formRewrite{why: eagerProgramNote}
		}
		var providers []string
		if name == "provide" {
			layers := arguments[1]
			elements := []*ast.Node{layers}
			if ast.IsArrayLiteralExpression(layers) {
				elements = layers.Elements()
			}
			if len(elements) == 0 {
				return nil
			}
			for _, element := range elements {
				if ast.IsSpreadElement(element) || ast.IsOmittedExpression(element) {
					return nil
				}
				providers = append(providers, providerText(file, element))
			}
		} else {
			key := arguments[1]
			if !ast.IsEntityNameExpression(key) {
				return nil
			}
			return &formRewrite{message: provideServiceNativeForm, why: provideServiceScopeNote}
		}
		start, end = nodeStart(file, statement), statement.End()
		result = "provide " + strings.Join(providers, ", ") + blockText(program, indent, returns)
	}
	return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{start, end, result}}, description: shortText(result, "the block form")})
}

// blockPositionNote explains why a provide or provideService call that does
// not stand as a statement or a return keeps its call.
const blockPositionNote = "No quick fix: a provide block stands only as a statement or a return; run the call in one, such as a function that returns it."

// eagerProgramNote explains why an eagerly evaluated program expression keeps
// its call.
const eagerProgramNote = "No quick fix: a block would evaluate its program expression after the other arguments; bind it to a const first."

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

// blockText returns a block that runs program, returning its value when
// returns is set: on one line when program is, else on lines of its own at
// indent's next level.
func blockText(program, indent string, returns bool) string {
	statement := program
	if returns {
		statement = "return " + program
	}
	if !strings.ContainsAny(program, "\r\n") && len(statement) < 60 {
		return " { " + statement + " }"
	}
	return " {\n" + indent + "  " + statement + "\n" + indent + "}"
}

// providerText returns node's text as one provider of a provide block, in
// parentheses when a comma or a conditional would split it.
func providerText(file *ast.SourceFile, node *ast.Node) string {
	text := expressionText(file, node)
	if isLowPrecedence(node) {
		return "(" + text + ")"
	}
	return text
}
