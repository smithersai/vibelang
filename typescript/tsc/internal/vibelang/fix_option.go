package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

// EK4840 (D473): an Option pipeline, which method syntax on Option values
// writes (D152):
//
//	pipe(nickname, Option.map(trim), Option.getOrElse(() => "anon"))
//	nickname.map(trim).getOrElse(() => "anon")
//
//	pipe(element.getAttribute("id"), Option.fromNullishOr, Option.map(Number))
//	Option.fromNullishOr(element.getAttribute("id")).map(Number)
//
// pipe(x, stages…) and x.pipe(stages…) whose every stage is a function of
// effect's Option module become one expression, stage by stage: a stage
// applied to an Option, whose type the Option module declares, is a method
// call through the function's data-first overload, x.map(f) for Option.map(f)
// and x.getOrNull() for Option.getOrNull; a stage applied to any other value
// is the data-first call, Option.f(x, args) or Option.f(x). The quick fix
// keeps the program's meaning: Effect's duals give the curried and the
// data-first call one implementation; each stage's arguments are functions,
// names, literals, or properties of names, which evaluating after the stage
// before them runs, rather than before, cannot tell apart; each stage has the
// overload its call needs; and the pipeline's comments are inside its stages.

// EK4840 (D473): an Option pipeline. {0} names it, {1} the chain.
var EK4840 = message(4840, warningCategory, "{0} pipes a value through Option's functions; method syntax writes it: {1}.")

func init() {
	registry[EK4840.Code] = EK4840
	tsFormMessages = append(tsFormMessages, EK4840)
	tsFormFixCodes = append(tsFormFixCodes, EK4840.Code)
	tsFormRules[EK4840.Code] = &tsFormRule{
		message:   EK4840,
		find:      findOptionPipes,
		plan:      optionPipeRewrite,
		diagnosed: ast.IsCallExpression,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4840.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// optionPipeOf returns the subject and the stages of call when it is an
// Option pipeline: pipe(x, …), or x.pipe(…) with x an Option, whose every
// stage names a function of effect's Option module.
func optionPipeOf(c *checker.Checker, call *ast.Node) (*ast.Node, []*ast.Node) {
	if !ast.IsCallExpression(call) || inHatch(call) || call.QuestionDotToken() != nil || call.TypeArguments() != nil {
		return nil, nil
	}
	var subject *ast.Node
	var stages []*ast.Node
	callee := call.Expression()
	switch {
	case ast.IsPropertyAccessExpression(callee) && ast.IsIdentifier(callee.Name()) && callee.Name().Text() == "pipe" && len(call.Arguments()) > 0:
		subject, stages = callee.Expression(), call.Arguments()
		if !isOptionType(c, c.GetTypeAtLocation(subject)) {
			return nil, nil
		}
	case len(call.Arguments()) > 1 && isPipeFunction(c, callee):
		subject, stages = call.Arguments()[0], call.Arguments()[1:]
	default:
		return nil, nil
	}
	if ast.IsSpreadElement(subject) {
		return nil, nil
	}
	for _, stage := range stages {
		if ast.IsSpreadElement(stage) || optionStageName(c, stage) == "" {
			return nil, nil
		}
	}
	return subject, stages
}

// optionStageCallee returns the function a stage names: Option.f, or the
// callee of Option.f(…).
func optionStageCallee(stage *ast.Node) *ast.Node {
	if ast.IsCallExpression(stage) {
		return stage.Expression()
	}
	return stage
}

// optionStageName returns the Option function a stage names, or "".
func optionStageName(c *checker.Checker, stage *ast.Node) string {
	if ast.IsCallExpression(stage) && (stage.TypeArguments() != nil || stage.QuestionDotToken() != nil) {
		return ""
	}
	callee := optionStageCallee(stage)
	if !ast.IsPropertyAccessExpression(callee) {
		return ""
	}
	if module, name := effectMember(c, callee); module == "Option" {
		return name
	}
	return ""
}

// isOptionType reports whether t is effect's Option: a None, a Some, or
// their union, which the Option module declares, and so takes its methods.
func isOptionType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	members := t.Distributed()
	if len(members) == 0 {
		return false
	}
	for _, member := range members {
		symbol := member.Symbol()
		if symbol == nil || len(symbol.Declarations()) == 0 || effectModuleOfFile(ast.GetSourceFileOfNode(symbol.Declarations()[0])) != "Option" {
			return false
		}
		switch symbol.Name() {
		case "None", "Some", "Option":
		default:
			return false
		}
	}
	return true
}

// findOptionPipes reports EK4840 at each Option pipeline of file.
func findOptionPipes(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if subject, _ := optionPipeOf(c, node); subject != nil && !inGeneratorBody(node) {
			rewrite := optionPipeRewrite(c, file, node)
			chain := "x.map(f).getOrElse(g)"
			if rewrite.fixable() {
				chain = rewrite.description
			}
			report(node, rewrite, shortText(expressionText(file, node), "This pipe"), chain)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// optionPipeRewrite plans EK4840's fix for call.
func optionPipeRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	subject, stages := optionPipeOf(c, call)
	if subject == nil {
		return nil
	}
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why + "."}
	}
	text := file.Text()
	start, end := nodeStart(file, call), call.End()
	if !ast.IsPropertyAccessExpression(call.Expression()) && hasComment(text[start:nodeStart(file, subject)]) {
		return refuse("a comment stands outside the pipe's stages")
	}
	multiline := strings.ContainsAny(text[start:end], "\n")
	// Every factory is an eager pipe argument: cache the subject and all
	// arguments before executing the first stage. A do expression preserves
	// the enclosing activation, including await, throws and lexical bindings.
	cache := false
	for _, stage := range stages {
		if ast.IsCallExpression(stage) {
			for _, arg := range stage.Arguments() {
				if !isInertOperand(arg) || (ast.IsIdentifier(arg) && !stableOptionName(c, arg)) || ast.IsPropertyAccessExpression(arg) || ast.IsObjectLiteralExpression(arg) {
					cache = true
				}
			}
		}
	}
	names := &freshNames{file: file}
	var eager []string
	argIndex := 0
	value := expressionText(file, subject)
	if cache {
		input := names.freshName("$optionInput")
		eager = append(eager, "const "+input+" = "+value+";")
		value = input
	}
	if !cache && needsOperandParentheses(subject) {
		value = "(" + value + ")"
	}
	isOption := isOptionType(c, c.GetTypeAtLocation(subject))
	gap := subject.End()
	for _, stage := range stages {
		if hasComment(text[gap:nodeStart(file, stage)]) {
			return refuse("a comment stands between the pipe's stages")
		}
		gap = stage.End()
		name := optionStageName(c, stage)
		label := shortText(expressionText(file, stage), "Option."+name)
		callee := optionStageCallee(stage)
		var args []string
		if ast.IsCallExpression(stage) {
			for _, arg := range stage.Arguments() {
				argument := expressionText(file, arg)
				if cache {
					if ast.IsSpreadElement(arg) {
						return refuse(label + " spreads its arguments")
					}
					name := names.freshName("$optionArg" + strconv.Itoa(argIndex))
					argIndex++
					annotation := ""
					if ast.IsArrowFunction(arg) || ast.IsFunctionExpression(arg) || ast.IsObjectLiteralExpression(arg) {
						annotation = ": " + c.TypeToString(c.GetTypeAtLocation(arg))
					}
					eager = append(eager, "const "+name+annotation+" = "+argument+";")
					argument = name
				}
				args = append(args, argument)
			}
		}
		if !hasDataFirstOverload(c, callee, len(args)+1, isOption) {
			return refuse(label + " has no data-first overload for the value and its arguments")
		}
		if isOption {
			separator := "."
			if multiline {
				separator = "\n" + lineIndent(text, nodeStart(file, stage)) + "."
			}
			value += separator + name + "(" + strings.Join(args, ", ") + ")"
		} else {
			value = expressionText(file, callee) + "(" + strings.Join(append([]string{value}, args...), ", ") + ")"
		}
		// What the stage gives is the next stage's value.
		isOption = isOptionType(c, stageResultType(c, stage))
	}
	if hasComment(text[gap:end]) {
		return refuse("a comment stands after the pipe's last stage")
	}
	replacement := value
	if cache {
		replacement = "do { " + strings.Join(eager, " ") + " " + value + "; }"
	}
	if ast.IsNewExpression(call.Parent) && call.Parent.Expression() == call {
		replacement = "(" + replacement + ")"
	}
	return withImportRemovals(c, file, &formRewrite{edits: []sourceEdit{{start, end, replacement}}, description: shortText(value, "a chain of Option's methods")})
}

// stageResultType returns what a stage gives: the return type of the
// function the stage is.
func stageResultType(c *checker.Checker, stage *ast.Node) *checker.Type {
	signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(stage), checker.SignatureKindCall)
	if len(signatures) == 0 {
		return nil
	}
	return c.GetReturnTypeOfSignature(signatures[len(signatures)-1])
}

// hasDataFirstOverload reports whether callee, an Option function, has an
// overload that takes the value first and arity arguments in all; for an
// Option value, whose call is a method call, its first parameter is named
// self, as method syntax requires (D152).
func hasDataFirstOverload(c *checker.Checker, callee *ast.Node, arity int, method bool) bool {
	for _, signature := range c.GetSignaturesOfType(c.GetTypeAtLocation(callee), checker.SignatureKindCall) {
		parameters := signature.Parameters()
		if len(parameters) == arity && (!method || parameters[0].Name() == "self") {
			return true
		}
	}
	return false
}

// isInertOperand reports whether evaluating expression has no effect a
// program could tell apart from evaluating it at another time: a function,
// a name, a literal, a property of a name, as Predicate.isString is, or an
// object literal of those.
func isInertOperand(expression *ast.Node) bool {
	expression = ast.SkipParentheses(expression)
	switch expression.Kind {
	case ast.KindArrowFunction, ast.KindFunctionExpression, ast.KindIdentifier, ast.KindThisKeyword,
		ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
		return true
	case ast.KindPropertyAccessExpression:
		return expression.QuestionDotToken() == nil && isInertOperand(expression.Expression())
	case ast.KindObjectLiteralExpression:
		for _, property := range expression.AsObjectLiteralExpression().Properties.Nodes {
			switch {
			case ast.IsPropertyAssignment(property) && !ast.IsComputedPropertyName(property.Name()):
				if !isInertOperand(property.Initializer()) {
					return false
				}
			case ast.IsShorthandPropertyAssignment(property), ast.IsMethodDeclaration(property):
			default:
				return false
			}
		}
		return true
	}
	return false
}

// A const/import binding keeps its reference while earlier stages execute;
// mutable names and properties must be captured with the other eager args.
func stableOptionName(c *checker.Checker, node *ast.Node) bool {
	symbol := c.GetSymbolAtLocation(node)
	if symbol == nil {
		return false
	}
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		return true
	}
	declaration := symbol.ValueDeclaration()
	if declaration == nil || !ast.IsVariableDeclaration(declaration) {
		return false
	}
	list := declaration.Parent
	return list != nil && ast.IsVariableDeclarationList(list) && list.Flags&ast.NodeFlagsBlockScoped == ast.NodeFlagsConst
}
