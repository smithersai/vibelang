package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// EK4839 (D472): a choice written with Effect's Match module, which a match
// expression writes (Chapter 3, D211):
//
//	Match.value(status).pipe(                  match (status) {
//	  Match.when("idle", () => "Idle"),          when "idle": "Idle";
//	  Match.tag("Failed", (f) => f.reason),      when { _tag: "Failed" } and let f: f.reason;
//	  Match.orElse(() => "Busy"),                default: "Busy";
//	)                                          }
//
// Match.value(x).pipe(…), pipe(Match.value(x), …), and Match.type<T>().pipe(…),
// which becomes (value: T) => match (value) { … }, end in Match.exhaustive,
// Match.orElse, Match.orElseAbsurd, or Match.tagsExhaustive. Their stages
// become arms: when, whenOr, whenAnd, not, tag, tags, and tagsExhaustive, each
// with an arrow function as its handler; withReturnType gives the type. A
// pattern is a literal, an object of patterns, Match.string and the other
// primitive refinements, Match.null, Match.undefined, Match.defined, or
// Match.instanceOf(C) for a proven ordinary class: each tests what Match's
// predicate tests. A handler's parameter binds with let, and its fields
// with { let field }.
//
// EK4839 (D472, effectscript-75): a Match chain or direct Option.match.
// {0} names the choice, {1} the subject, and {2} the API it uses.
var EK4839 = message(4839, warningCategory, "{0} chooses with {2}; a match expression writes the choice: match ({1}) { when …: …; }.")

func init() {
	registerDiagnostic(EK4839)
	tsFormMessages = append(tsFormMessages, EK4839)
	tsFormRules[EK4839.Code] = &tsFormRule{
		message: EK4839,
		find:    findMatchChains,
	}
}

// A matchChain is a Match chain's parts.
type matchChain struct {
	start   *ast.Node // Match.value(x) or Match.type<T>()
	subject *ast.Node // x, or nil for Match.type
}

// matchChainOf returns the Match chain that call is, or nil.
func matchChainOf(c *checker.Checker, call *ast.Node) *matchChain {
	if !ast.IsCallExpression(call) || inHatch(call) || call.QuestionDotToken() != nil {
		return nil
	}
	var start *ast.Node
	var stages []*ast.Node
	callee := call.Expression()
	switch {
	case ast.IsPropertyAccessExpression(callee) && ast.IsIdentifier(callee.Name()) && callee.Name().Text() == "pipe":
		start, stages = callee.Expression(), call.Arguments()
	case len(call.Arguments()) > 1 && isPipeFunction(c, callee):
		start, stages = call.Arguments()[0], call.Arguments()[1:]
	default:
		return nil
	}
	if !ast.IsCallExpression(start) || len(stages) == 0 {
		return nil
	}
	chain := &matchChain{start: start}
	switch {
	case isEffectFunction(c, start.Expression(), "Match", "value") && len(start.Arguments()) == 1 && start.TypeArguments() == nil:
		chain.subject = start.Arguments()[0]
	case isEffectFunction(c, start.Expression(), "Match", "type") && len(start.Arguments()) == 0 && len(start.TypeArguments()) == 1:
		// A type matcher has no subject yet.
	default:
		return nil
	}
	if _, name := matchStage(c, stages[len(stages)-1]); name == "exhaustive" || name == "orElse" || name == "orElseAbsurd" || name == "tagsExhaustive" {
		return chain
	}
	return nil
}

// isPipeFunction reports whether callee is effect's pipe function.
func isPipeFunction(c *checker.Checker, callee *ast.Node) bool {
	if !ast.IsIdentifier(callee) && !ast.IsPropertyAccessExpression(callee) {
		return false
	}
	module, name := effectMember(c, callee)
	return name == "pipe" && module != ""
}

// matchStage returns a stage's call, or nil for a bare function such as
// Match.exhaustive, and the Match function it names.
func matchStage(c *checker.Checker, stage *ast.Node) (*ast.Node, string) {
	callee := stage
	var call *ast.Node
	if ast.IsCallExpression(stage) {
		call, callee = stage, stage.Expression()
	}
	module, name := effectMember(c, callee)
	if module != "Match" {
		if hint := hoistedMatchHint(c, stage); hint != nil {
			return hint, "withReturnType"
		}
		return nil, ""
	}
	return call, name
}

// findMatchChains reports the match spelling diagnostic.
func findMatchChains(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		// Like a generator body, a generator in the arguments waits for EK1002.
		if optionMatchOf(c, node) && !inGeneratorBody(node) && !holdsEffectGenerator(c, file, node) {
			report(node, nil, "Option.match", shortText(expressionText(file, node.Arguments()[0]), "value"), "Option's match API")
		}
		if chain := matchChainOf(c, node); chain != nil && !inGeneratorBody(node) {
			subject := "value"
			if chain.subject != nil {
				subject = shortText(expressionText(file, chain.subject), "…")
			}
			report(node, nil, shortText(expressionText(file, chain.start), core.IfElse(chain.subject != nil, "Match.value(…)", "Match.type<…>()")), subject, "Effect's Match functions")
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// inGeneratorBody reports whether node is in a function*'s body, which a .vibe
// file reads as a producer's (EK1002 explains an Effect.gen's).
func inGeneratorBody(node *ast.Node) bool {
	for n := node.Parent; n != nil; n = n.Parent {
		if ast.IsFunctionLike(n) && n.BodyData() != nil && n.BodyData().AsteriskToken != nil {
			return true
		}
	}
	return false
}

// A local const initialized by the real Match.withReturnType factory is an
// immutable type hint. Keep its eager read (and its initialization), so TDZ,
// exported uses and reuse by other choices retain their original behavior.
func hoistedMatchHint(c *checker.Checker, stage *ast.Node) *ast.Node {
	if !ast.IsIdentifier(stage) {
		return nil
	}
	symbol := c.GetSymbolAtLocation(stage)
	if symbol == nil {
		return nil
	}
	decl := symbol.ValueDeclaration()
	if decl == nil || !ast.IsVariableDeclaration(decl) || decl.Initializer() == nil || ast.GetSourceFileOfNode(decl) != ast.GetSourceFileOfNode(stage) {
		return nil
	}
	list := decl.Parent
	if list == nil || !ast.IsVariableDeclarationList(list) || list.Flags&ast.NodeFlagsBlockScoped != ast.NodeFlagsConst {
		return nil
	}
	hint := ast.SkipParentheses(decl.Initializer())
	if !ast.IsCallExpression(hint) || hint.QuestionDotToken() != nil || !isEffectFunction(c, hint.Expression(), "Match", "withReturnType") || len(hint.Arguments()) != 0 || len(hint.TypeArguments()) != 1 {
		return nil
	}
	return hint
}
