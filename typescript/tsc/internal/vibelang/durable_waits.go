package vibelang

import (
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Durable waits (VIP-56): Experimental.Durable.sleep, Experimental.Durable.until,
// a signal's wait() (from Experimental.Durable.signal), and Experimental.Human.{
// confirm,ask,select,json}. Each wait is recognized by the declaration its callee
// resolves to — import aliases, const aliases, and const object destructuring keep
// the meaning, while local functions named sleep or wait (even type-annotated with
// typeof Durable.sleep) gain none.
//
// Inside a workflow's effect call, durable waits (and Experimental.Durable.race)
// are admitted under try, try.all, try.race, and try.any; try.race and try.any
// lower to Experimental.Durable.raceSteps so each race is journaled per occurrence
// with arm-discriminated schemas. Fiber waits (Effect.sleep, Clock.sleep,
// Effect.delay, Effect.timeout, etc.) are refused with targeted EK5504 messages.
// Outside a workflow context, durable waits in Effect code are refused with EK5601
// (wait-outside-workflow).

// EK5601: a durable wait called in Effect code outside a workflow body (VIP-56, wait-outside-workflow). {0} is the call.
var (
	EK5601 = message(5601, errorCategory, "{0} is a durable wait, which parks a workflow run and runs only inside a workflow. Move the wait into a workflow's `effect call`, or use `sleep` for a fiber delay.")

	ek5601Timer = EK5601.With("{0} is a durable timer, which parks a workflow run. Use `sleep` in ordinary effect code, or move the wait into a workflow's `effect call`.")
	ek5601Wait  = EK5601.With("{0} is a durable wait, which runs only inside a workflow. Move the wait into a workflow's `effect call`.")
)

func init() {
	registerDiagnostic(EK5601)
	fileChecks = append(fileChecks, checkDurableWaitCalls)
}

type durableWaitKind uint8

const (
	durableWaitNone durableWaitKind = iota
	durableWaitTimer
	durableWaitSignal
	durableWaitHuman
)

type fiberWaitKind uint8

const (
	fiberWaitNone fiberWaitKind = iota
	fiberWaitSleep
	fiberWaitTimeout
)

// symbolDeclaration returns the primary declaration of symbol, or nil.
func symbolDeclaration(symbol *ast.Symbol) *ast.Node {
	if symbol == nil {
		return nil
	}
	if decl := symbol.ValueDeclaration(); decl != nil {
		return decl
	}
	if decls := symbol.Declarations(); len(decls) > 0 {
		return decls[0]
	}
	return nil
}

// experimentalRuntimeModule returns the module name ("Durable", "Human", ...)
// when file is vibelang-runtime's experimental/<Name> declaration or source
// file, and "" otherwise.
func experimentalRuntimeModule(c *checker.Checker, file *ast.SourceFile) string {
	if file == nil || packageNameOf(c, file) != "vibelang-runtime" || !isExperimentalRuntimeFile(c, file) {
		return ""
	}
	base := tspath.GetBaseFileName(string(file.FileName()))
	if dot := strings.IndexByte(base, '.'); dot >= 0 {
		base = base[:dot]
	}
	return base
}

// resolveCalleeSymbol resolves expr to its underlying declaration symbol,
// following import/re-export aliases, const variable aliases
// (`const pause = Experimental.Durable.sleep`), const object destructuring
// (`const { sleep: snooze } = Experimental.Durable` or `const { wait } = paid`),
// and string-literal element accesses (`Experimental.Durable["sleep"]`).
// Stops once it reaches a runtime/declaration-file binding or hits a cycle.
func resolveCalleeSymbol(c *checker.Checker, expr *ast.Node) *ast.Symbol {
	return resolveCalleeSymbolSeen(c, expr, map[*ast.Symbol]bool{})
}

func resolveCalleeSymbolSeen(c *checker.Checker, expr *ast.Node, seen map[*ast.Symbol]bool) *ast.Symbol {
	if expr == nil {
		return nil
	}
	expr = ast.SkipParentheses(expr)
	var sym *ast.Symbol
	switch {
	case ast.IsElementAccessExpression(expr):
		access := expr.AsElementAccessExpression()
		name := ""
		if arg := access.ArgumentExpression; ast.IsStringLiteralLike(arg) {
			name = arg.Text()
		} else if t := c.GetTypeAtLocation(arg); t != nil && t.IsStringLiteral() {
			name, _ = t.AsLiteralType().Value().(string)
		}
		if name == "" {
			return nil
		}
		if recv := c.GetTypeAtLocation(access.Expression); recv != nil {
			sym = c.GetPropertyOfType(c.GetNonNullableType(recv), name)
		}
	default:
		sym = c.GetSymbolAtLocation(expr)
	}
	if sym == nil {
		return nil
	}
	sym = c.SkipAlias(sym)
	if sym == nil || seen[sym] {
		return sym
	}
	seen[sym] = true
	decl := symbolDeclaration(sym)
	if decl == nil {
		return sym
	}
	file := ast.GetSourceFileOfNode(decl)
	if file != nil && (file.IsDeclarationFile || packageNameOf(c, file) == "vibelang-runtime" || packageNameOf(c, file) == "effect") {
		return sym
	}
	// Follow const variable aliases: const pause = Experimental.Durable.sleep.
	if ast.IsVariableDeclaration(decl) && decl.Parent != nil &&
		ast.IsVariableDeclarationList(decl.Parent) && decl.Parent.Flags&ast.NodeFlagsConst != 0 &&
		decl.Initializer() != nil {
		if target := resolveCalleeSymbolSeen(c, decl.Initializer(), seen); target != nil {
			return target
		}
	}
	// Follow const object destructuring: const { sleep: snooze } = Experimental.Durable
	// or const { wait } = paid.
	if ast.IsBindingElement(decl) && decl.Parent != nil && ast.IsObjectBindingPattern(decl.Parent) &&
		decl.AsBindingElement().DotDotDotToken == nil && isConstBindingElement(decl) {
		key := decl.PropertyName()
		if key == nil {
			key = decl.Name()
		}
		if key != nil && (ast.IsIdentifier(key) || ast.IsStringLiteralLike(key)) {
			if objType := c.GetTypeAtLocation(decl.Parent); objType != nil {
				if prop := c.GetPropertyOfType(c.GetNonNullableType(objType), key.Text()); prop != nil {
					prop = c.SkipAlias(prop)
					if prop != nil && !seen[prop] {
						seen[prop] = true
						return prop
					}
				}
			}
		}
	}
	return sym
}

// isConstBindingElement reports whether a BindingElement belongs to a const
// variable declaration.
func isConstBindingElement(decl *ast.Node) bool {
	for n := decl.Parent; n != nil; n = n.Parent {
		if ast.IsVariableDeclaration(n) {
			return n.Parent != nil && ast.IsVariableDeclarationList(n.Parent) && n.Parent.Flags&ast.NodeFlagsConst != 0
		}
		if !ast.IsBindingPattern(n) && !ast.IsBindingElement(n) {
			return false
		}
	}
	return false
}

// isTypeMemberDeclaration reports whether decl is a property or method
// signature inside an interface or object type.
func isTypeMemberDeclaration(decl *ast.Node) bool {
	return decl.Kind == ast.KindPropertySignature || decl.Kind == ast.KindMethodSignature
}

// durableWaitKindOf classifies call when its callee resolves to a VIP-56
// durable wait: Experimental.Durable.sleep, Experimental.Durable.until,
// a signal's wait(), or Experimental.Human.{confirm,ask,select,json}.
func durableWaitKindOf(c *checker.Checker, node *ast.Node) durableWaitKind {
	node = ast.SkipParentheses(node)
	if !ast.IsCallExpression(node) || durableKind(node) != "" {
		return durableWaitNone
	}
	sym := resolveCalleeSymbol(c, node.Expression())
	if sym == nil {
		return durableWaitNone
	}
	for _, decl := range sym.Declarations() {
		mod := experimentalRuntimeModule(c, ast.GetSourceFileOfNode(decl))
		switch mod {
		case "Durable":
			switch sym.Name() {
			case "sleep", "until":
				if !isTypeMemberDeclaration(decl) {
					return durableWaitTimer
				}
			case "wait":
				if decl.Parent != nil && ast.IsInterfaceDeclaration(decl.Parent) &&
					decl.Parent.Name() != nil && decl.Parent.Name().Text() == "Signal" {
					return durableWaitSignal
				}
			}
		case "Human":
			switch sym.Name() {
			case "confirm", "ask", "select", "json":
				if !isTypeMemberDeclaration(decl) {
					return durableWaitHuman
				}
			}
		}
	}
	return durableWaitNone
}

// isDurableWaitCall reports whether node is a call to a recognized VIP-56
// durable wait.
func isDurableWaitCall(c *checker.Checker, node *ast.Node) bool {
	return durableWaitKindOf(c, node) != durableWaitNone
}

// isDurableRaceCall reports whether node is a call to Experimental.Durable.race.
func isDurableRaceCall(c *checker.Checker, node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	if !ast.IsCallExpression(node) || durableKind(node) != "" {
		return false
	}
	sym := resolveCalleeSymbol(c, node.Expression())
	if sym == nil || sym.Name() != "race" {
		return false
	}
	for _, decl := range sym.Declarations() {
		if experimentalRuntimeModule(c, ast.GetSourceFileOfNode(decl)) == "Durable" && !isTypeMemberDeclaration(decl) {
			return true
		}
	}
	return false
}

// fiberWaitKindOf reports whether node is a fiber wait or timeout (Effect.sleep,
// Clock.sleep, Effect.delay, Effect.timeout, etc.), including through aliases
// and pipes, so workflow bodies give the targeted VIP-56 diagnostic naming
// Experimental.Durable.sleep or try.race with it.
func fiberWaitKindOf(c *checker.Checker, node *ast.Node) fiberWaitKind {
	if node == nil {
		return fiberWaitNone
	}
	node = ast.SkipParentheses(node)
	if isPipe(node) {
		binary := node.AsBinaryExpression()
		if kind := fiberWaitKindOf(c, binary.Right); kind != fiberWaitNone {
			return kind
		}
		return fiberWaitKindOf(c, binary.Left)
	}
	if !ast.IsCallExpression(node) || durableKind(node) != "" {
		return fiberWaitNone
	}
	callee := ast.SkipParentheses(node.Expression())
	// Handle step.pipe(Effect.timeout(...), ...) and pipe(step, Effect.timeout(...)).
	if ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "pipe" {
		for _, arg := range node.Arguments() {
			if kind := fiberWaitKindOf(c, arg); kind != fiberWaitNone {
				return kind
			}
		}
		return fiberWaitKindOf(c, callee.Expression())
	}
	sym := resolveCalleeSymbol(c, callee)
	if sym == nil {
		return fiberWaitNone
	}
	for _, decl := range sym.Declarations() {
		file := ast.GetSourceFileOfNode(decl)
		if file == nil {
			continue
		}
		if isEffectModuleFile(c, file, "Function") && sym.Name() == "pipe" {
			for _, arg := range node.Arguments() {
				if kind := fiberWaitKindOf(c, arg); kind != fiberWaitNone {
					return kind
				}
			}
			return fiberWaitNone
		}
		if isEffectModuleFile(c, file, "Effect") || (packageNameOf(c, file) == "vibelang-runtime" && !isExperimentalRuntimeFile(c, file)) {
			switch sym.Name() {
			case "sleep", "delay", "delayWith":
				return fiberWaitSleep
			case "timeout", "timeoutOption", "timeoutOrElse", "timeoutFail", "timeoutFailCause":
				return fiberWaitTimeout
			}
		}
		if isEffectModuleFile(c, file, "Clock") && sym.Name() == "sleep" {
			return fiberWaitSleep
		}
	}
	return fiberWaitNone
}

// isEffectWorkflowType reports whether t is effect/workflow's Workflow type.
func isEffectWorkflowType(c *checker.Checker, t *checker.Type) bool {
	if t == nil {
		return false
	}
	prop := c.GetPropertyOfType(c.GetNonNullableType(t), "~effect/workflow/Workflow")
	if prop == nil {
		return false
	}
	for _, decl := range prop.Declarations() {
		if packageNameOf(c, ast.GetSourceFileOfNode(decl)) == "effect" {
			return true
		}
	}
	return false
}

// isEffectWorkflowHandler reports whether fn is the handler callback passed to
// an Effect/Durable workflow's toLayer (e.g. W.toLayer(effect (...) => { ... })).
func isEffectWorkflowHandler(c *checker.Checker, fn *ast.Node) bool {
	if fn == nil {
		return false
	}
	candidate := fn
	// Allow W.toLayer((payload) => effect { ... }) where effect { ... } is the
	// handler's direct return expression.
	if isEffectBlock(candidate) {
		parent := candidate.Parent
		for parent != nil && ast.IsParenthesizedExpression(parent) {
			parent = parent.Parent
		}
		if parent != nil && ast.IsReturnStatement(parent) && parent.Parent != nil && ast.IsBlock(parent.Parent) {
			parent = parent.Parent.Parent
		}
		if parent != nil && ast.IsFunctionLike(parent) {
			candidate = parent
		}
	}
	node := candidate
	for node.Parent != nil && ast.IsParenthesizedExpression(node.Parent) {
		node = node.Parent
	}
	call := node.Parent
	if call == nil || !ast.IsCallExpression(call) {
		return false
	}
	argMatch := false
	for _, arg := range call.Arguments() {
		if arg == node {
			argMatch = true
			break
		}
	}
	if !argMatch {
		return false
	}
	callee := ast.SkipParentheses(call.Expression())
	if ast.IsPropertyAccessExpression(callee) && callee.Name().Text() == "toLayer" &&
		isEffectWorkflowType(c, c.GetTypeAtLocation(callee.Expression())) {
		return true
	}
	if sym := resolveCalleeSymbol(c, callee); sym != nil && sym.Name() == "toLayer" {
		for _, decl := range sym.Declarations() {
			file := ast.GetSourceFileOfNode(decl)
			if file != nil && packageNameOf(c, file) == "effect" && strings.Contains(file.FileName().AsString(), "/workflow/Workflow.") {
				return true
			}
		}
	}
	return false
}

// isWorkflowContext reports whether fn is a workflow body: either a VibeLang
// `workflow` declaration's `effect call` or an Effect `Workflow.toLayer`
// handler callback.
func isWorkflowContext(c *checker.Checker, fn *ast.Node) bool {
	return fn != nil && (isWorkflowBody(fn) || isEffectWorkflowHandler(c, fn))
}

// checkDurableWaitCalls reports EK5601 (wait-outside-workflow) when a durable
// wait (Experimental.Durable.sleep, Experimental.Durable.until, a signal's
// wait(), or Experimental.Human.{confirm,ask,select,json}) is called in Effect
// code outside a workflow body. Plain non-Effect code holding a wait as a
// value is allowed.
func checkDurableWaitCalls(c *checker.Checker, file *ast.SourceFile) {
	if !isVibeLangFile(file) || !builtinsOn(c, file) { // EK3013 gates them (experimental_gate.go)
		return
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration {
			return false
		}
		if ast.IsCallExpression(node) && inEffectCode(node) {
			if kind := durableWaitKindOf(c, node); kind != durableWaitNone {
				if owner := effectCodeOwner(node); !isWorkflowContext(c, owner) {
					msg := ek5601Wait
					if kind == durableWaitTimer {
						msg = ek5601Timer
					}
					report(c, node.Expression(), msg, entityText(node.Expression()))
				}
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}
