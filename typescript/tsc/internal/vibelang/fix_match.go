package vibelang

import (
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
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
// Match.instanceOf(C): each tests what Match's predicate tests. A handler's
// parameter binds with let, and its fields with { let field }.
//
// The warning has a quick fix when the match keeps the program's meaning
// (Chapter 28): the patterns are the ones above, not a predicate function or
// an array, which Match does not check by length and a match does; a handler
// is an arrow function whose block, if it has one, returns once at its end,
// and that runs no program, since an arm's call runs where the handler's built
// a program; the chain itself is not a running call; and the match's type is
// the chain's, because every arm has that type or the match stands where a
// written type gives it one. Where the match would test a value Match.exhaustive
// rejects, it is one the chain's type does not admit.

// EK4839 (D472): a Match chain. {0} names it, {1} the subject.
var EK4839 = message(4839, warningCategory, "{0} chooses with Effect's Match functions; a match expression writes the choice: match ({1}) { when …: …; }.")

func init() {
	registry[EK4839.Code] = EK4839
	tsFormMessages = append(tsFormMessages, EK4839)
	tsFormFixCodes = append(tsFormFixCodes, EK4839.Code)
	tsFormRules[EK4839.Code] = &tsFormRule{
		message:   EK4839,
		find:      findMatchChains,
		plan:      matchChainRewrite,
		diagnosed: ast.IsCallExpression,
	}
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4839.Code}, GetCodeActions: typeScriptFormFix.GetCodeActions})
}

// A matchChain is a Match chain's parts.
type matchChain struct {
	call     *ast.Node   // the chain: the .pipe(…) or pipe(…) call
	start    *ast.Node   // Match.value(x) or Match.type<T>()
	subject  *ast.Node   // x, or nil for Match.type
	typeArg  *ast.Node   // T of Match.type<T>()
	stages   []*ast.Node // the stages, in order
	finisher string      // the last stage's name
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
	chain := &matchChain{call: call, start: start, stages: stages}
	switch {
	case isEffectFunction(c, start.Expression(), "Match", "value") && len(start.Arguments()) == 1 && start.TypeArguments() == nil:
		chain.subject = start.Arguments()[0]
	case isEffectFunction(c, start.Expression(), "Match", "type") && len(start.Arguments()) == 0 && len(start.TypeArguments()) == 1:
		chain.typeArg = start.TypeArguments()[0]
	default:
		return nil
	}
	if _, name := matchStage(c, stages[len(stages)-1]); name == "exhaustive" || name == "orElse" || name == "orElseAbsurd" || name == "tagsExhaustive" {
		chain.finisher = name
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
		return nil, ""
	}
	return call, name
}

// findMatchChains reports EK4839 at each Match chain of file.
func findMatchChains(c *checker.Checker, file *ast.SourceFile, report func(at *ast.Node, rewrite *formRewrite, args ...any)) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if optionMatchOf(c, node) && !inGeneratorBody(node) {
			report(node, optionMatchRewrite(c, file, node), "Option.match", shortText(expressionText(file, node.Arguments()[0]), "value"))
		}
		if chain := matchChainOf(c, node); chain != nil && !inGeneratorBody(node) {
			subject := "value"
			if chain.subject != nil {
				subject = shortText(expressionText(file, chain.subject), "…")
			}
			report(node, matchChainRewrite(c, file, node), shortText(expressionText(file, chain.start), core.IfElse(chain.subject != nil, "Match.value(…)", "Match.type<…>()")), subject)
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

// A matchArm is one arm of the match a chain becomes.
type matchArm struct {
	stage   *ast.Node // the stage, or tags' field, it comes from, for its comments
	handler *ast.Node // the handler
	pattern string    // "" for default
	body    string
	value   *ast.Node // the expression whose value the arm gives
}

// matchChainRewrite plans EK4839's fix for call.
func matchChainRewrite(c *checker.Checker, file *ast.SourceFile, call *ast.Node) *formRewrite {
	if optionMatchOf(c, call) {
		return optionMatchRewrite(c, file, call)
	}
	chain := matchChainOf(c, call)
	if chain == nil {
		return nil
	}
	refuse := func(why string) *formRewrite {
		return &formRewrite{why: "No quick fix: " + why + "."}
	}
	a := analyzerFor(c)
	if a.runs(call) {
		return refuse("the chain's value is a program that runs where it stands, and a match would give it as data")
	}
	text := file.Text()
	var arms []matchArm
	written := ""    // the type withReturnType writes
	annotations := 0 // handlers with a return type
	annotation := "" // the return type they write, when they all write one
	for i, stage := range chain.stages {
		stageCall, name := matchStage(c, stage)
		label := shortText(expressionText(file, stage), "Match."+name)
		switch name {
		case "withReturnType":
			if i != 0 || stageCall == nil || len(stageCall.TypeArguments()) != 1 {
				return refuse(label + " is not the first stage")
			}
			written = nodeText(file, stageCall.TypeArguments()[0])
		case "exhaustive", "orElseAbsurd":
			if i != len(chain.stages)-1 {
				return refuse(label + " is not the last stage")
			}
		case "when", "whenOr", "whenAnd", "not", "orElse":
			if stageCall == nil || len(stageCall.Arguments()) == 0 || (name == "orElse") != (len(stageCall.Arguments()) == 1) {
				return refuse(label + " has an argument list Match does not take")
			}
			args := stageCall.Arguments()
			handler := args[len(args)-1]
			var patterns []string
			for _, p := range args[:len(args)-1] {
				pattern, ok := matchPattern(c, file, p)
				if !ok {
					return refuse("the pattern " + shortText(expressionText(file, p), "of "+label) + " has no match pattern that tests the same")
				}
				patterns = append(patterns, pattern)
			}
			pattern := ""
			switch name {
			case "when":
				pattern = patterns[0]
			case "whenOr":
				pattern = joinPatterns(patterns, " or ")
			case "whenAnd":
				pattern = joinPatterns(patterns, " and ")
			case "not":
				pattern = "not " + parenthesizedPattern(patterns[0])
			}
			arm, why := matchHandlerArm(c, a, file, handler, pattern, args[0], name == "orElse")
			if why != "" {
				return refuse(why)
			}
			annotations, annotation = handlerAnnotation(file, handler, annotations, annotation)
			arm.stage = stage
			arms = append(arms, arm)
		case "tag":
			if stageCall == nil || len(stageCall.Arguments()) < 2 {
				return refuse(label + " has an argument list Match does not take")
			}
			args := stageCall.Arguments()
			var tags []string
			for _, t := range args[:len(args)-1] {
				if !ast.IsStringLiteral(t) {
					return refuse(label + " names a tag that is not a string literal")
				}
				tags = append(tags, nodeText(file, t))
			}
			handler := args[len(args)-1]
			arm, why := matchHandlerArm(c, a, file, handler, "{ _tag: "+strings.Join(tags, " or ")+" }", nil, false)
			if why != "" {
				return refuse(why)
			}
			annotations, annotation = handlerAnnotation(file, handler, annotations, annotation)
			arm.stage = stage
			arms = append(arms, arm)
		case "tags", "tagsExhaustive":
			if stageCall == nil || len(stageCall.Arguments()) != 1 || !ast.IsObjectLiteralExpression(stageCall.Arguments()[0]) {
				return refuse(label + " takes no object literal of handlers")
			}
			if name == "tagsExhaustive" && i != len(chain.stages)-1 {
				return refuse(label + " is not the last stage")
			}
			for _, property := range stageCall.Arguments()[0].AsObjectLiteralExpression().Properties.Nodes {
				if !ast.IsPropertyAssignment(property) || !(ast.IsIdentifier(property.Name()) || ast.IsStringLiteral(property.Name())) {
					return refuse(label + " has a handler that is not a field with a name")
				}
				tag := property.Name().Text()
				arm, why := matchHandlerArm(c, a, file, property.Initializer(), "{ _tag: "+strconv.Quote(tag)+" }", nil, false)
				if why != "" {
					return refuse(why)
				}
				annotations, annotation = handlerAnnotation(file, property.Initializer(), annotations, annotation)
				arm.stage = property
				arms = append(arms, arm)
			}
		default:
			return refuse(label + " has no match form")
		}
	}
	if len(arms) == 0 {
		return refuse("the chain has no handler")
	}
	// The match's type is its arms': where that is not the chain's, a type
	// written where the match stands must give it one.
	chainType := c.GetTypeAtLocation(call)
	if chain.subject == nil {
		chainType = nil
		if signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(call), checker.SignatureKindCall); len(signatures) == 1 {
			chainType = c.GetReturnTypeOfSignature(signatures[0])
		}
	}
	// typeText is the type the match is given, so that it keeps the chain's:
	// the one withReturnType or every handler writes, or a primitive one.
	typeText := ""
	if !armsHaveType(c, arms, chainType) && (chain.subject == nil || !hasWrittenType(call)) {
		switch {
		case written != "":
			typeText = written
		case annotations == len(arms) && annotation != "":
			typeText = annotation
		case chainType != nil && isPrimitiveType(chainType):
			typeText = c.TypeToString(chainType)
		default:
			return refuse("the match's type would be its arms', not the chain's " + shortText(c.TypeToString(c.GetTypeAtLocation(call)), "type") + "; write the type where it stands")
		}
	}
	// Comments stay with the stage they precede; any other comment in the
	// chain's own text has no place in the match.
	start, end := nodeStart(file, call), call.End()
	firstStage := nodeStart(file, chain.stages[0])
	if hasComment(text[start:chainHeadEnd(file, chain)]) || hasComment(text[chain.stages[len(chain.stages)-1].End():end]) {
		return refuse("a comment stands outside the chain's stages")
	}
	for _, arm := range arms {
		if arm.handler != nil && (hasComment(text[nodeStart(file, arm.stage):nodeStart(file, arm.handler)]) || hasComment(text[arm.handler.End():arm.stage.End()])) {
			return refuse("a comment stands in a stage outside its handler")
		}
	}
	multiline := strings.ContainsAny(text[start:end], "\n")
	var b strings.Builder
	subject := "value"
	if chain.subject != nil {
		subject = expressionText(file, chain.subject)
	} else {
		// The parameter keeps the name the chain's function type gives it,
		// so the declaration it emits is the same.
		subject = ""
		if signatures := c.GetSignaturesOfType(c.GetTypeAtLocation(call), checker.SignatureKindCall); len(signatures) == 1 && len(signatures[0].Parameters()) == 1 {
			if name := signatures[0].Parameters()[0].Name(); scanner.IsIdentifierText(name, core.LanguageVariantStandard) && !containsWord(text[start:end], name) {
				subject = name
			}
		}
		if subject == "" {
			subject = freshMatchName(text[start:end])
		}
		b.WriteString("(" + subject + ": " + matchTypeText(c, file, chain.typeArg) + ")")
		// Match.type's chain is a plain function, and an arrow without a
		// return annotation is an Effect function (D500): the arrow writes
		// the chain's return type, or infer _ where it is not a primitive.
		switch {
		case typeText != "":
			b.WriteString(": " + typeText)
			typeText = ""
		case chainType != nil && isPrimitiveType(chainType):
			b.WriteString(": " + c.TypeToString(chainType))
		default:
			b.WriteString(": infer _")
		}
		b.WriteString(" => ")
	}
	b.WriteString("match (" + subject + ") {")
	// Arms are indented one step from the line the chain starts on, the step
	// its stages take, and a handler's lines move with its arm.
	chainIndent := lineIndent(text, start)
	step := len(lineIndent(text, firstStage)) - len(chainIndent)
	if step <= 0 {
		step = 2
	}
	indent := chainIndent + strings.Repeat(" ", step)
	for _, arm := range arms {
		if multiline {
			arm.body = dedentText(arm.body, len(lineIndent(text, nodeStart(file, arm.stage)))-len(indent))
		}
		comments := stageComments(text[previousStageEnd(file, chain, arm.stage):nodeStart(file, arm.stage)])
		line := "when " + arm.pattern + ": " + arm.body + ";"
		if arm.pattern == "" {
			line = "default: " + arm.body + ";"
		}
		if multiline {
			for _, comment := range comments {
				b.WriteString("\n" + indent + comment)
			}
			b.WriteString("\n" + indent + line)
		} else {
			if len(comments) > 0 {
				return refuse("a comment stands in a one-line chain")
			}
			b.WriteString(" " + line)
		}
	}
	if multiline {
		b.WriteString("\n" + chainIndent + "}")
	} else {
		b.WriteString(" }")
	}
	replacement := b.String()
	edits := []sourceEdit{}
	if typeText != "" {
		if declaration := call.Parent; ast.IsVariableDeclaration(declaration) && declaration.Initializer() == call && declaration.Type() == nil && ast.IsIdentifier(declaration.Name()) {
			edits = append(edits, sourceEdit{declaration.Name().End(), declaration.Name().End(), ": " + typeText})
		} else {
			replacement = "(" + replacement + " as " + typeText + ")"
		}
	}
	if !strings.HasPrefix(replacement, "(") && needsMatchParentheses(call, chain.subject == nil) {
		replacement = "(" + replacement + ")"
	}
	edits = append(edits, sourceEdit{start, end, replacement})
	return withImportRemovals(c, file, &formRewrite{edits: edits, description: "a match expression"})
}

// chainHeadEnd returns where a chain's text before its first stage ends: after
// .pipe( or after pipe(Match.value(x),.
func chainHeadEnd(file *ast.SourceFile, chain *matchChain) int {
	if ast.IsPropertyAccessExpression(chain.call.Expression()) {
		return chain.call.Expression().End() + 1 // after the (
	}
	return chain.start.End()
}

// previousStageEnd returns where the text before stage, a stage or a field of
// tags' object, starts: the end of the stage or field before it, the object's
// {, or the end of the chain's head.
func previousStageEnd(file *ast.SourceFile, chain *matchChain, stage *ast.Node) int {
	if ast.IsPropertyAssignment(stage) {
		properties := stage.Parent.AsObjectLiteralExpression().Properties.Nodes
		for i, p := range properties {
			if p == stage && i > 0 {
				return properties[i-1].End()
			}
		}
		return nodeStart(file, stage.Parent) + 1
	}
	for i, s := range chain.stages {
		if s == stage && i > 0 {
			return chain.stages[i-1].End()
		}
	}
	return chainHeadEnd(file, chain)
}

// stageComments returns the comments in text, the trivia before a stage, one
// per line.
func stageComments(text string) []string {
	var comments []string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(line), ","))
		if strings.HasPrefix(line, "//") || strings.HasPrefix(line, "/*") || strings.HasPrefix(line, "*") {
			comments = append(comments, line)
		}
	}
	return comments
}

// freshMatchName returns a parameter name that text does not use.
func freshMatchName(text string) string {
	for _, name := range []string{"value", "input", "subject", "matched"} {
		if !containsWord(text, name) {
			return name
		}
	}
	return "matched$"
}

// needsMatchParentheses reports whether the expression that replaces call
// must be parenthesized where it stands: anywhere but a whole value, as an
// initializer, a return, an arrow's body, a field, an argument, or an element.
func needsMatchParentheses(call *ast.Node, function bool) bool {
	parent := call.Parent
	switch {
	case ast.IsParenthesizedExpression(parent), ast.IsReturnStatement(parent), ast.IsArrayLiteralExpression(parent),
		ast.IsVariableDeclaration(parent) && parent.Initializer() == call,
		ast.IsPropertyAssignment(parent) && parent.Initializer() == call,
		ast.IsArrowFunction(parent) && parent.Body() == call,
		ast.IsCallExpression(parent) && parent.Expression() != call:
		return false
	case ast.IsExpressionStatement(parent):
		return function
	}
	return true
}

// hasWrittenType reports whether call stands where a written type gives its
// value a type: a return of a function with a return type, an arrow's body
// with one, or the initializer of a variable with one.
func hasWrittenType(call *ast.Node) bool {
	node := call
	for ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	parent := node.Parent
	switch {
	case ast.IsVariableDeclaration(parent) && parent.Initializer() == node:
		return parent.Type() != nil
	case ast.IsArrowFunction(parent) && parent.Body() == node:
		return parent.Type() != nil
	case ast.IsReturnStatement(parent):
		fn := ast.GetContainingFunction(parent)
		return fn != nil && fn.Type() != nil
	}
	return false
}

// armsHaveType reports whether every arm's value has type t.
func armsHaveType(c *checker.Checker, arms []matchArm, t *checker.Type) bool {
	if t == nil {
		return false
	}
	for _, arm := range arms {
		if arm.value == nil || c.GetTypeAtLocation(arm.value) != t {
			return false
		}
	}
	return true
}

// dedentText removes width columns of indentation from each line of text
// after its first, unless a line has less, or text holds a template literal,
// whose lines are its value.
func dedentText(text string, width int) string {
	if width <= 0 || strings.Contains(text, "`") {
		return text
	}
	lines := strings.Split(text, "\n")
	for _, line := range lines[1:] {
		if strings.TrimSpace(line) != "" && len(line)-len(strings.TrimLeft(line, " \t")) < width {
			return text
		}
	}
	for i := 1; i < len(lines); i++ {
		if len(lines[i]) >= width {
			lines[i] = lines[i][width:]
		} else {
			lines[i] = strings.TrimLeft(lines[i], " \t")
		}
	}
	return strings.Join(lines, "\n")
}

// matchTypeText returns the text of Match.type's type argument as the
// declaration of the chain's function writes it: a union of keyword and
// literal types in TypeScript's order, so the declaration is the same, and
// any other type as written.
func matchTypeText(c *checker.Checker, file *ast.SourceFile, typeArg *ast.Node) string {
	if ast.IsUnionTypeNode(typeArg) {
		for _, member := range typeArg.AsUnionTypeNode().Types.Nodes {
			if !ast.IsKeywordTypeNode(member) && !ast.IsLiteralTypeNode(member) {
				return nodeText(file, typeArg)
			}
		}
		return c.TypeToString(c.GetTypeFromTypeNode(typeArg))
	}
	return nodeText(file, typeArg)
}

// handlerAnnotation counts handler's return type, given the count so far and
// the type the counted ones write, "" when they differ.
func handlerAnnotation(file *ast.SourceFile, handler *ast.Node, count int, written string) (int, string) {
	if handler.Type() == nil {
		return count, written
	}
	text := nodeText(file, handler.Type())
	if count > 0 && text != written {
		text = ""
	}
	return count + 1, text
}

// isPrimitiveType reports whether t is string, number, boolean, or bigint, or a
// union of them, null, and undefined, which TypeScript writes by name.
func isPrimitiveType(t *checker.Type) bool {
	for _, member := range t.Distributed() {
		flags := member.Flags()
		if flags&(checker.TypeFlagsString|checker.TypeFlagsNumber|checker.TypeFlagsBigInt|checker.TypeFlagsBooleanLiteral|checker.TypeFlagsNull|checker.TypeFlagsUndefined) == 0 ||
			flags&(checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBigIntLiteral) != 0 {
			return false
		}
	}
	return true
}

// joinPatterns joins patterns with a combinator, parenthesizing each that
// combines others, since and, or and not cannot share a level (EK4705).
func joinPatterns(patterns []string, by string) string {
	var parts []string
	for _, p := range patterns {
		parts = append(parts, parenthesizedPattern(p))
	}
	return strings.Join(parts, by)
}

// parenthesizedPattern parenthesizes a pattern that combines others: one
// with a space outside the braces of an object pattern.
func parenthesizedPattern(p string) string {
	depth := 0
	for _, r := range p {
		switch {
		case r == '{' || r == '(':
			depth++
		case r == '}' || r == ')':
			depth--
		case r == ' ' && depth == 0:
			return "(" + p + ")"
		}
	}
	return p
}

// matchPattern returns the match pattern that tests what Match's predicate
// for pattern tests (internal/matcher.js makePredicate): a literal by ===, an
// object by typeof "object", not null, each key in it and each value's
// pattern. It returns false for a predicate function, an array, which Match
// does not check by length, and any other value.
func matchPattern(c *checker.Checker, file *ast.SourceFile, pattern *ast.Node) (string, bool) {
	pattern = ast.SkipParentheses(pattern)
	switch pattern.Kind {
	case ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
		return nodeText(file, pattern), true
	case ast.KindPrefixUnaryExpression:
		if pattern.AsPrefixUnaryExpression().Operator == ast.KindMinusToken && ast.IsNumericLiteral(pattern.AsPrefixUnaryExpression().Operand) {
			return nodeText(file, pattern), true
		}
		return "", false
	case ast.KindIdentifier:
		if pattern.Text() == "undefined" {
			return "undefined", true
		}
	case ast.KindObjectLiteralExpression:
		var fields []string
		for _, property := range pattern.AsObjectLiteralExpression().Properties.Nodes {
			if !ast.IsPropertyAssignment(property) || !(ast.IsIdentifier(property.Name()) || ast.IsStringLiteral(property.Name())) {
				return "", false
			}
			value, ok := matchPattern(c, file, property.Initializer())
			if !ok {
				return "", false
			}
			fields = append(fields, nodeText(file, property.Name())+": "+value)
		}
		if len(fields) == 0 {
			return "", false
		}
		return "{ " + strings.Join(fields, ", ") + " }", true
	}
	if ast.IsCallExpression(pattern) {
		if module, name := effectMember(c, pattern.Expression()); module == "Match" && name == "instanceOf" && len(pattern.Arguments()) == 1 && ast.IsIdentifier(pattern.Arguments()[0]) {
			return pattern.Arguments()[0].Text(), true
		}
		return "", false
	}
	if module, name := effectMember(c, pattern); module == "Match" {
		switch name {
		case "string", "number", "boolean", "bigint", "symbol":
			return strings.ToUpper(name[:1]) + name[1:], true
		case "null":
			return "null", true
		case "undefined":
			return "undefined", true
		case "defined":
			return "not (null or undefined)", true
		}
		return "", false
	}
	// A constant of a literal type, such as Status.Ready, matches by equality.
	if (ast.IsIdentifier(pattern) || ast.IsPropertyAccessExpression(pattern)) && c.GetTypeAtLocation(pattern).Flags()&(checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBooleanLiteral) != 0 {
		return nodeText(file, pattern), true
	}
	return "", false
}

// matchHandlerArm returns the arm that handler, a Match handler, becomes with
// pattern, or "" for the default arm, or why there is none.
func matchHandlerArm(c *checker.Checker, a *analyzer, file *ast.SourceFile, handler *ast.Node, pattern string, patternNode *ast.Node, isDefault bool) (matchArm, string) {
	label := "the handler " + shortText(expressionText(file, handler), "")
	if !ast.IsArrowFunction(handler) || handler.TypeParameters() != nil || ast.GetFunctionFlags(handler)&ast.FunctionFlagsAsync != 0 {
		return matchArm{}, label + " is not an arrow function"
	}
	parameters := handler.Parameters()
	if len(parameters) > 1 {
		return matchArm{}, label + " takes more than the value"
	}
	binding := ""
	destructure := ""
	if len(parameters) == 1 {
		parameter := parameters[0]
		if parameter.Type() != nil || parameter.Initializer() != nil || parameter.AsParameterDeclaration().DotDotDotToken != nil {
			return matchArm{}, label + "'s parameter has a type, a default, or a rest"
		}
		name := parameter.Name()
		switch {
		case ast.IsIdentifier(name):
			if usesName(handler.Body(), name.Text()) {
				binding = "let " + name.Text()
			}
		case ast.IsObjectBindingPattern(name):
			if isDefault {
				// Destructure only after choosing the fallback: matching an object
				// pattern first would add tests and duplicate observable getter reads.
				capture := (&freshNames{file: file}).freshName("$matchDefault")
				binding = "let " + capture
				destructure = "const " + nodeText(file, name) + " = " + capture + "; "
				break
			}
			var fields []string
			for _, element := range name.AsBindingPattern().Elements.Nodes {
				if element.Initializer() != nil || element.AsBindingElement().DotDotDotToken != nil || !ast.IsIdentifier(element.Name()) {
					return matchArm{}, label + " destructures with a default, a rest, or a nested pattern"
				}
				if property := element.PropertyName(); property != nil {
					fields = append(fields, nodeText(file, property)+": let "+element.Name().Text())
				} else {
					fields = append(fields, "let "+element.Name().Text())
				}
			}
			binding = "{ " + strings.Join(fields, ", ") + " }"
		default:
			return matchArm{}, label + " destructures an array"
		}
	}
	// The handler runs no program: a call that would build one in the
	// handler would run in the arm.
	why := ""
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isFunctionBoundary(node) {
			return false
		}
		if isInvocation(node) && a.performs(node) {
			why = label + " builds a program with " + shortText(expressionText(file, node), "a call") + ", which in a match arm would run"
			return true
		}
		return node.ForEachChild(visit)
	}
	body := handler.Body()
	visit(body)
	if why != "" {
		return matchArm{}, why
	}
	text := ""
	var value *ast.Node
	if ast.IsBlock(body) {
		// A block that returns once, at its end, is a do block whose last
		// statement is that value (D187).
		statements := body.Statements()
		if len(statements) == 0 || !ast.IsReturnStatement(statements[len(statements)-1]) || statements[len(statements)-1].Expression() == nil || returnsBefore(body, statements[len(statements)-1]) {
			return matchArm{}, label + " does not end in its only return"
		}
		last := statements[len(statements)-1]
		value = last.Expression()
		src := file.Text()
		valueText := expressionText(file, value)
		if strings.HasPrefix(valueText, "{") || strings.HasPrefix(valueText, "function") || strings.HasPrefix(valueText, "class") {
			valueText = "(" + valueText + ")"
		}
		if len(statements) > 1 && strings.IndexAny(valueText[:1], "([`+-/") == 0 && !strings.HasSuffix(strings.TrimSpace(nodeText(file, statements[len(statements)-2])), ";") {
			return matchArm{}, label + "'s value would continue the statement before it"
		}
		text = "do " + src[nodeStart(file, body):nodeStart(file, last)] + valueText + src[last.End():body.End()]
	} else {
		value = body
		text = expressionText(file, body)
	}
	if destructure != "" {
		text = "do { " + destructure + "(" + text + "); }"
	}
	if binding != "" {
		switch {
		case pattern == "" && strings.HasPrefix(binding, "{"):
			return matchArm{}, label + " destructures what a default arm, which matches anything, would have to test is an object"
		case pattern == "":
			pattern = binding
		case strings.HasPrefix(binding, "{") && strings.HasPrefix(pattern, "{ ") && strings.HasSuffix(pattern, " }"):
			pattern = strings.TrimSuffix(pattern, " }") + ", " + strings.TrimPrefix(binding, "{ ")
		default:
			pattern = parenthesizedPattern(pattern) + " and " + binding
		}
	}
	_ = patternNode
	_ = isDefault
	return matchArm{handler: handler, pattern: pattern, body: text, value: value}, ""
}

// usesName reports whether node refers to name.
func usesName(node *ast.Node, name string) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) && n.Text() == name {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	if ast.IsIdentifier(node) {
		return node.Text() == name
	}
	node.ForEachChild(visit)
	return found
}

// returnsBefore reports whether block returns anywhere but at last.
func returnsBefore(block, last *ast.Node) bool {
	found := false
	var visit func(n *ast.Node) bool
	visit = func(n *ast.Node) bool {
		if isFunctionBoundary(n) {
			return false
		}
		if ast.IsReturnStatement(n) && n != last {
			found = true
			return true
		}
		return n.ForEachChild(visit)
	}
	block.ForEachChild(visit)
	return found
}
