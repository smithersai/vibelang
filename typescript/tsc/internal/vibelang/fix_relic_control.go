package vibelang

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-35 is open. This source migration adds no language admission or
// diagnostic; the subsequent retirement adds its rejection separately.
const relicControlLabel = "control service migration"

func relicControlMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string)) proposal {
	p := proposal{file: file}
	var controls, handles, selects, continuations []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsClassDeclaration(n) && declarationWord(n) == "control" {
			controls = append(controls, n)
		}
		if isHandleStatement(n) {
			handles = append(handles, n)
		}
		if ast.IsIdentifier(n) {
			switch n.Text() {
			case "Control", "handle", "resume", "resumeWith", "abandon":
				continuations = append(continuations, n)
			}
		}
		if ast.IsElementAccessExpression(n) {
			continuations = append(continuations, n)
		}
		if fiberHelper(n) == "$select" {
			selects = append(selects, n)
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(controls)+len(handles)+len(selects)+len(continuations) == 0 {
		return p
	}
	reject := func(n *ast.Node, why string) {
		key := relicControlLabel + ":" + file.FileName().AsString() + ":" + expressionText(file, n)
		if refused[key] {
			return
		}
		line, _ := scannerLineOf(file, nodeStart(file, n))
		refuse(FixRefusal{File: file.FileName(), Line: line + 1, Rewrite: relicControlLabel, Error: why}, key)
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	if len(controls) > 0 {
		for _, n := range controls {
			key := relicControlLabel + ":" + file.FileName().AsString() + ":" + expressionText(file, n)
			if refused[key] {
				continue
			}
			r := preserveRewriteComments(file, relicControlRewrite(c, file, n))
			if !r.fixable() {
				why := "No general preserving continuation rewrite exists; retain unsupported source for an explicit service redesign."
				if r != nil && r.why != "" {
					why = r.why
				}
				reject(n, why)
			} else {
				p.fixes = append(p.fixes, fileFix{label: relicControlLabel, key: key, edits: r.edits})
			}
		}
	}
	targets := map[*ast.Symbol]bool{}
	for _, name := range []string{"Control", "handle", "resume", "resumeWith", "abandon"} {
		if symbol := preludeSymbol(c, preludeStateOf(c), file, name); symbol != nil {
			targets[aliasTarget(c, symbol)] = true
		}
	}
	for _, n := range continuations {
		migrated := false
		for _, fix := range p.fixes {
			for _, edit := range fix.edits {
				if edit.start <= nodeStart(file, n) && edit.end >= n.End() {
					migrated = true
				}
			}
		}
		symbol := relicContinuationSymbol(c, n)
		if !migrated && symbol != nil && targets[aliasTarget(c, symbol)] {
			reject(n, "No general preserving continuation-runtime rewrite exists; redesign this use with ordinary services and Effect composition.")
		}
	}
	for _, n := range handles {
		migrated := false
		for _, fix := range p.fixes {
			for _, edit := range fix.edits {
				if edit.start <= nodeStart(file, n) && edit.end >= n.End() {
					migrated = true
				}
			}
		}
		if !migrated {
			reject(n, "No general preserving handler/resume/abandon rewrite exists; redesign this use with ordinary services and Effect composition.")
		}
	}
	for _, n := range selects {
		reject(n, "No general preserving select rewrite exists; choose explicit Effect selection only after proving the intended behavior.")
	}
	return p
}

// The admitted slice is intentionally small: a private, one-operation control with primitive contracts,
// used exactly once by a direct returned operation, answered by a pure tail
// resume. No control type or value can escape, no effectful argument is moved,
// and nothing can observe a continuation or the key's representation.
func relicControlRewrite(c *checker.Checker, file *ast.SourceFile, control *ast.Node) *formRewrite {
	refuse := &formRewrite{why: "No general preserving continuation rewrite exists. Redesign this use with ordinary services and Effect composition; exported Control APIs, non-tail resume, abandon and select require an explicit redesign."}
	refused := func(reason string) *formRewrite { return &formRewrite{why: refuse.why + " " + reason} }
	if declarationWord(control) != "control" {
		return nil
	}
	start := nodeStart(file, control)
	if !strings.HasPrefix(file.Text()[start:], "control") {
		return refused("The declaration must begin with control.")
	}
	if !ast.IsExternalModule(file) || control.Parent != file.AsNode() || ast.HasSyntacticModifier(control, ast.ModifierFlagsExport|ast.ModifierFlagsAmbient) || len(control.TypeParameters()) != 0 || len(control.Members()) != 1 {
		return refused("Only a private module-local declaration with one operation is supported.")
	}
	member := control.Members()[0]
	if !ast.IsMethodDeclaration(member) || ast.IsStatic(member) || member.Body() != nil || member.Name() == nil || !ast.IsIdentifier(member.Name()) || len(member.TypeParameters()) != 0 {
		return refused("The operation must be a non-static method signature.")
	}
	if member.Name().Text() == "__proto__" {
		return refused("The legacy __proto__ operation has object-prototype behavior with no preserving service rewrite.")
	}
	var parameterNames []string
	var parameterTexts []string
	for _, p := range member.Parameters() {
		if !ast.IsIdentifier(p.Name()) || p.Type() == nil || p.Initializer() != nil || p.AsParameterDeclaration().DotDotDotToken != nil || p.QuestionToken() != nil {
			return refused("Parameters must be required identifiers without initializers.")
		}
		parameterNames = append(parameterNames, p.Name().Text())
		parameterTexts = append(parameterTexts, expressionText(file, p))
	}
	sym := c.GetSymbolAtLocation(control.Name())
	if sym == nil {
		return refused("The control binding could not be resolved.")
	}
	var uses []*ast.Node
	directEval := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsCallExpression(n) {
			callee := ast.SkipParentheses(n.Expression())
			if ast.IsIdentifier(callee) && callee.Text() == "eval" {
				directEval = true
			}
		}
		if n != control.Name() && ast.IsIdentifier(n) {
			resolved := c.GetSymbolAtLocation(n)
			if n.Parent != nil && ast.IsShorthandPropertyAssignment(n.Parent) && n.Parent.Name() == n {
				resolved = c.GetShorthandAssignmentValueSymbol(n.Parent)
			}
			if resolved != nil && aliasTarget(c, resolved) == aliasTarget(c, sym) {
				uses = append(uses, n)
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if directEval {
		return refused("Direct eval may observe the control key, so its representation cannot safely change.")
	}
	if len(uses) != 2 {
		return refused("The control must have exactly two references: an operation and its handler.")
	}
	var handle *ast.Node
	for _, use := range uses {
		for n := use.Parent; n != nil; n = n.Parent {
			if isHandleStatement(n) {
				handle = n
				break
			}
		}
	}
	if handle == nil || !inEffectCode(handle) {
		return refused("The handler must occur in Effect code.")
	}
	clauses := handleClauses(handle)
	if len(clauses) != 1 || clauses[0].name != member.Name().Text() || clauses[0].control.Kind != ast.KindIdentifier || c.GetSymbolAtLocation(clauses[0].control) != sym {
		return refused("Exactly one handler clause must name the control operation.")
	}
	body := handle.AsTryStatement().TryBlock.AsBlock().Statements.Nodes
	if len(body) != 1 || !ast.IsReturnStatement(body[0]) || body[0].Expression() == nil {
		return refused("The handled block must return one operation directly.")
	}
	call := relicRunOperand(body[0].Expression())
	if call == nil {
		return refused("The returned operation must be run with try.")
	}
	if !ast.IsCallExpression(call) || !ast.IsPropertyAccessExpression(call.Expression()) || call.Expression().Name().Text() != member.Name().Text() || !ast.IsIdentifier(call.Expression().Expression()) || c.GetSymbolAtLocation(call.Expression().Expression()) != sym || len(call.Arguments()) != len(parameterNames) {
		return refused("The returned call must name the declared operation and match its arity.")
	}
	for _, arg := range call.Arguments() {
		if !relicPure(arg, nil) {
			return refused("Operation arguments must be pure literals.")
		}
	}
	statements := clauses[0].block.AsBlock().Statements.Nodes
	if len(statements) != 2 {
		return refused("The handler must contain only its parameter binding and tail resume.")
	}
	binding := statements[0].AsVariableStatement().DeclarationList.AsVariableDeclarationList().Declarations.Nodes[0].Name().AsBindingPattern().Elements.Nodes
	if len(binding) != len(parameterNames)+1 {
		return refused("The handler binding must match the operation arity.")
	}
	for i, element := range binding[1:] {
		if element.Name() == nil || !ast.IsIdentifier(element.Name()) || element.Name().Text() != parameterNames[i] {
			return refused("The handler parameters must match the declared names.")
		}
		if element.AsBindingElement().DotDotDotToken != nil || element.Initializer() != nil {
			return refused("Handler bindings must be plain names without rest parameters or defaults.")
		}
	}
	tail := statements[1]
	if !ast.IsReturnStatement(tail) || tail.Expression() == nil {
		return refused("The handler must return its resume directly.")
	}
	resume := relicRunOperand(tail.Expression())
	if resume == nil {
		return refused("The tail resume must be run with try; a bare returned Effect has different types.")
	}
	if !ast.IsCallExpression(resume) || !ast.IsIdentifier(resume.Expression()) || resume.Expression().Text() != "resume" || len(resume.Arguments()) != 2 || !isClauseContinuation(resume.Arguments()[0]) || !relicPure(resume.Arguments()[1], parameterNames) {
		return refused("The handler must run the runtime resume with a pure result.")
	}
	runtimeResume := preludeSymbol(c, preludeStateOf(c), file, "resume")
	writtenResume := c.GetSymbolAtLocation(resume.Expression())
	if runtimeResume == nil || writtenResume == nil || aliasTarget(c, writtenResume) != aliasTarget(c, runtimeResume) {
		return refused("The resume binding must resolve to the continuation runtime.")
	}
	// Primitive contracts exclude coercion hooks, object identity and any
	// Control ABI in the public result. Keep the same expressions and order.
	for _, parameter := range member.Parameters() {
		switch strings.TrimSpace(expressionText(file, parameter.Type())) {
		case "number", "string", "boolean":
		default:
			return refused("Only primitive parameter contracts are supported.")
		}
	}
	if member.Type() == nil {
		return refused("An explicit primitive result contract is required.")
	}
	contract := strings.TrimSpace(expressionText(file, member.Type()))
	if contract != "number!!" && contract != "string!!" && contract != "boolean!!" {
		return refused("Only primitive infallible result contracts are supported.")
	}
	var arguments []string
	for _, arg := range call.Arguments() {
		arguments = append(arguments, expressionText(file, arg))
	}
	value := expressionText(file, resume.Arguments()[1])
	name := control.Name().Text()
	impl := "provide " + name + " = { effect " + member.Name().Text() + "(" + strings.Join(parameterTexts, ", ") + ") { return " + value + " } } {\nreturn try (try " + name + ")." + member.Name().Text() + "(" + strings.Join(arguments, ", ") + ")\n}"
	// Preserve comments around the retired optional class keyword, too.
	edits := []sourceEdit{{start, start + len("control"), "service"}}
	// VIP-9 requires a written key when this scope cannot derive one.
	// Reuse the exact key the old control lowered to; do not invent identity
	// or export the formerly private declaration merely to derive a key.
	if !serviceCanDeriveKey(c, control) {
		at := control.ClassLikeData().Members.Pos()
		if at <= 0 || at > len(file.Text()) || file.Text()[at-1] != '{' {
			return refused("The original control key cannot be inserted safely.")
		}
		key, _ := json.Marshal(servicesFor(c).key(control))
		edits = append(edits, sourceEdit{at, at, " static readonly key = " + string(key) + "; "})
	}
	next := scanner.SkipTrivia(file.Text(), start+len("control"))
	nameStart := nodeStart(file, control.Name())
	if next != nameStart {
		if !strings.HasPrefix(file.Text()[next:], "class") || scanner.SkipTrivia(file.Text(), next+len("class")) != nameStart {
			return refused("The optional legacy class keyword could not be located.")
		}
		edits = append(edits, sourceEdit{next, next + len("class"), ""})
	}
	edits = append(edits, sourceEdit{nodeStart(file, handle), handle.End(), impl})
	return &formRewrite{description: "ordinary local service and provide", edits: edits}
}

// Calls run by try are marked directly; only other operands use $try.
// Keep both parser representations so safe call-form migrations are reachable.
func relicRunOperand(n *ast.Node) *ast.Node {
	if n == nil {
		return nil
	}
	marked := n.Flags&ast.NodeFlagsVibeLangTry != 0
	n = ast.SkipParentheses(n)
	if marked || n.Flags&ast.NodeFlagsVibeLangTry != 0 {
		return n
	}
	if isTryCall(n) {
		operand := ast.SkipParentheses(n.Arguments()[0])
		if operand.Flags&ast.NodeFlagsVibeLangTry == 0 {
			return operand
		}
	}
	return nil
}

func relicPure(n *ast.Node, names []string) bool {
	switch n.Kind {
	case ast.KindNumericLiteral, ast.KindStringLiteral, ast.KindNoSubstitutionTemplateLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword:
		return true
	case ast.KindIdentifier:
		for _, name := range names {
			if n.Text() == name {
				return true
			}
		}
	case ast.KindParenthesizedExpression:
		return relicPure(n.Expression(), names)
	case ast.KindBinaryExpression:
		b := n.AsBinaryExpression()
		switch b.OperatorToken.Kind {
		case ast.KindPlusToken, ast.KindMinusToken, ast.KindAsteriskToken:
			return relicPure(b.Left, names) && relicPure(b.Right, names)
		}
	}
	return false
}

// A computed member with a literal key type still has a property identity. Native
// object members with the same spelling have their own symbols.
func relicContinuationSymbol(c *checker.Checker, n *ast.Node) *ast.Symbol {
	if ast.IsIdentifier(n) {
		return c.GetSymbolAtLocation(n)
	}
	if ast.IsElementAccessExpression(n) {
		argument := n.AsElementAccessExpression().ArgumentExpression
		if argument == nil {
			return nil
		}
		key := c.GetTypeAtLocation(argument)
		if key != nil && key.IsStringLiteral() {
			if receiver := c.GetTypeAtLocation(n.Expression()); receiver != nil {
				return c.GetPropertyOfType(receiver, key.AsLiteralType().Value().(string))
			}
		}
	}
	return nil
}
