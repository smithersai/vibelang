package vibelang

// D382, D394, D433: the migration of keyword operands. Through VibeLang
// 0.0.10 an await element or a fork operand was deferred only when D147
// passed it by name; any other operand was evaluated where the form stood,
// and the operation ran an Effect value, converted a function to its program
// (D7), and waited for a fiber or a Deferred, which it decided at run time
// (D377). Now every operand is a program by syntax whose result is its
// value. This file keeps the old reading as a recorder, with no part in
// typing or emit, and names each operand whose meaning changed: the ordinary
// error, EK4613, EK4609 or EK4610, gets a note, and an operand whose new
// reading still compiles is EK1023. --fix rewrites each to its old meaning.

import (
	"context"
	"slices"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// LegacyForkOperand records a fork operand whose meaning changed: the
// operand D147 did not pass by name, which fork ran as its program.
const LegacyForkOperand LegacyKind = "forkOperand"

// keywordChange is how an operand read through VibeLang 0.0.10, where that
// differs from its program by syntax.
type keywordChange uint8

const (
	keywordUnchanged    keywordChange = iota
	keywordRanFunction                // a function literal, converted to its program and run (D7); now EK4613
	keywordRanValue                   // a value evaluated where the form stood and then run or waited for; now EK4613, EK4609, EK4610, or EK1023
	keywordRanHeldValue               // passed by name, with a program in a result position that D147 ran; now EK4613 or EK1023
	keywordHeldCall                   // an await object's field that held its call (D265), whose operands it evaluated where the operation was built; now EK1023
)

// keywordReading is one operand's old reading.
type keywordReading struct {
	change         keywordChange
	boundary       string // the old evaluation boundary, as the S0 oracle names it
	representation string // what the operation received
}

// legacyKeywordReading returns how operand, an operand of call as written,
// read through VibeLang 0.0.10. It reads the old rules directly: D147's
// by-name test, D265's held field, and the run-time adoption of D377,
// never the program type this slice gives the operand.
func (a *analyzer) legacyKeywordReading(call, operand *ast.Node) keywordReading {
	c := a.checker
	inner := ast.SkipParentheses(operand)
	if ast.NodeIsMissing(inner) {
		return keywordReading{}
	}
	if ast.IsFunctionExpressionOrArrowFunction(inner) && !isForkBlock(inner) {
		if requiredParameterCount(inner) != 0 {
			return keywordReading{} // a type error then and now
		}
		return keywordReading{keywordRanFunction, "function-body", "Effect"}
	}
	if isForkBlock(inner) {
		return keywordReading{}
	}
	await := awaitOperationNames[fiberHelper(call)] != ""
	if field := outerParentheses(inner).Parent; await && field != nil && ast.IsPropertyAssignment(field) && holdsField(c, outerParentheses(inner), field) {
		if isInvocation(inner) && !stableInvocation(inner) {
			return keywordReading{keywordHeldCall, "eager-element", "Effect"}
		}
		return keywordReading{keywordUnchanged, "eager-element", "Effect"}
	}
	if a.pauses(inner) {
		held := false
		byNameResults(inner, func(result *ast.Node) {
			t := a.keywordValueType(inner)
			if result != inner {
				t = c.GetTypeAtLocation(result)
			}
			held = held || t != nil && a.heldByName(result, t)
		})
		if held {
			return keywordReading{keywordRanHeldValue, "deferred-expression", "Effect"}
		}
		return keywordReading{keywordUnchanged, "deferred-expression", "Effect"}
	}
	value := a.keywordValueType(inner)
	switch {
	case value == nil:
		return keywordReading{}
	case value.Flags()&checker.TypeFlagsAny != 0:
		return keywordReading{keywordRanValue, "eager-element", "value"}
	case a.isProgramValueType(value) || effectInterfaceSymbol(c, value) != nil:
		return keywordReading{keywordRanValue, "eager-element", "Effect"}
	case await && (isFiberType(c, value) || isDeferredType(c, value)):
		return keywordReading{keywordRanValue, "eager-element", "awaitable"}
	}
	return keywordReading{} // TypeScript rejected it then: the operation took only programs
}

// stableInvocation reports whether evaluating call's callee and arguments
// observes nothing that running them later could change: each argument is a
// literal, a name, this, or an array or object literal of those, and the
// callee is a name or a member access of names.
func stableInvocation(call *ast.Node) bool {
	if !ast.IsCallExpression(call) || ast.IsOptionalChain(call) {
		return false
	}
	callee := call.Expression()
	for ast.IsPropertyAccessExpression(callee) {
		callee = callee.Expression()
	}
	if !ast.IsIdentifier(callee) && callee.Kind != ast.KindThisKeyword {
		return false
	}
	var stable func(node *ast.Node) bool
	stable = func(node *ast.Node) bool {
		node = ast.SkipParentheses(node)
		switch node.Kind {
		case ast.KindIdentifier, ast.KindThisKeyword, ast.KindStringLiteral, ast.KindNumericLiteral, ast.KindBigIntLiteral,
			ast.KindNoSubstitutionTemplateLiteral, ast.KindTrueKeyword, ast.KindFalseKeyword, ast.KindNullKeyword:
			return true
		case ast.KindArrayLiteralExpression:
			return !slices.ContainsFunc(node.AsArrayLiteralExpression().Elements.Nodes, func(e *ast.Node) bool { return !stable(e) })
		case ast.KindObjectLiteralExpression:
			for _, property := range node.AsObjectLiteralExpression().Properties.Nodes {
				if ast.IsShorthandPropertyAssignment(property) {
					continue
				}
				if !ast.IsPropertyAssignment(property) || ast.IsComputedPropertyName(property.Name()) || !stable(property.Initializer()) {
					return false
				}
			}
			return true
		}
		return false
	}
	return !slices.ContainsFunc(call.Arguments(), func(arg *ast.Node) bool { return !stable(arg) })
}

// legacyKeywordSite is an operand whose meaning changed.
type legacyKeywordSite struct {
	call, operand *ast.Node
	reading       keywordReading
}

// legacyKeywordSites returns the keyword operands of file whose meaning
// changed, in source order.
func (a *analyzer) legacyKeywordSites(file *ast.SourceFile) []legacyKeywordSite {
	var sites []legacyKeywordSite
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindModuleDeclaration || inHatch(node) {
			return false
		}
		if ast.IsCallExpression(node) && (awaitOperationNames[fiberHelper(node)] != "" || len(node.Arguments()) == 1 && a.keywordFork(node.Arguments()[0]) != nil) {
			forEachKeywordOperand(node, func(operand *ast.Node) {
				if reading := a.legacyKeywordReading(node, operand); reading.change != keywordUnchanged {
					sites = append(sites, legacyKeywordSite{node, operand, reading})
				}
			})
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return sites
}

// legacyKeywordNote explains site's old reading under the diagnostic that
// reports it.
func legacyKeywordNote(site legacyKeywordSite) string {
	what := "fork"
	if name := awaitOperationNames[fiberHelper(site.call)]; name != "" {
		what = name
	}
	switch site.reading.change {
	case keywordRanFunction:
		return "Through VibeLang 0.0.10, " + what + " converted this function to its program and ran it. An operand is now a program by syntax, and its result is its value (D322, D394); vibelang --fix keeps the old meaning."
	case keywordRanHeldValue:
		return "Through VibeLang 0.0.10, " + what + " ran the program in a branch of this operand. An operand is now a program by syntax, and its result is its value (D322, D394)."
	case keywordHeldCall:
		return "Through VibeLang 0.0.10, this field held its call, whose operands " + what + " evaluated where the operation was built. An element is now a program by syntax, which evaluates them on the element's own fiber (D377)."
	}
	if site.reading.representation == "awaitable" {
		return "Through VibeLang 0.0.10, " + what + " waited for this element, and interrupted a fiber it held when another element failed or won. An element is now a program by syntax, and its result is its value (D394)."
	}
	return "Through VibeLang 0.0.10, " + what + " ran this value as a program. An operand is now a program by syntax, and its result is its value (D322, D394); vibelang --fix keeps the old meaning."
}

// EK1023's text for a keyword operand. {0} is the operand, {1} the form.
var keywordMigrationMessage = EK1023.With("{0} is now a program by syntax whose result is its value, so {1} no longer means what it meant through VibeLang 0.0.10.")

// reportKeywordMigration adds site's old reading under d, the error
// checkKeywordOperands reported at its operand, or reports EK1023 when d is
// nil: the new reading compiles, and would change the program silently
// (D382).
func reportKeywordMigration(c *checker.Checker, file *ast.SourceFile, site legacyKeywordSite, d *ast.Diagnostic) {
	if d != nil {
		note(d, "{0}", legacyKeywordNote(site))
		return
	}
	start := nodeStart(file, site.operand)
	d = reportAt(c, file, core.NewTextRange(start, site.operand.End()), keywordMigrationMessage, messageText(ast.SkipParentheses(site.operand), "This operand"), keywordWhat(site.call))
	note(d, "{0}", legacyKeywordNote(site))
	if r := keywordMigrationRewrite(c, file, site); r.fixable() {
		note(d, "Write {0} to keep that meaning; vibelang --fix writes it.", r.description)
	} else if r != nil && r.why != "" {
		note(d, "{0}", r.why)
	}
}

// keywordMigrationRewrite plans the rewrite that keeps site's old meaning,
// or says why none is exact.
func keywordMigrationRewrite(c *checker.Checker, file *ast.SourceFile, site legacyKeywordSite) *formRewrite {
	refuse := func(why string) *formRewrite { return &formRewrite{why: why} }
	switch site.reading.change {
	case keywordRanHeldValue:
		return refuse("No rewrite keeps this exactly: call the program in the branch that holds one, p(), so each branch gives a value.")
	case keywordHeldCall:
		return refuse("No rewrite keeps this exactly: bind the call's operands to constants before the operation, then write the call with them.")
	}
	inner := ast.SkipParentheses(site.operand)
	value := analyzerFor(c).keywordValueType(inner)
	if site.reading.representation == "awaitable" && value != nil && isFiberType(c, value) {
		// join f waits as the operation did, but the operation no longer
		// interrupts f when another element fails or wins: f's region does
		// when it ends (D394, D408). Only the author knows whether that
		// difference matters.
		return refuse("join " + messageText(inner, "the fiber") + " waits for it as before, but " + keywordWhat(site.call) + " no longer interrupts it when another element fails or wins; its region interrupts it when the region ends. Write the join, and interrupt the fiber where the old behavior matters.")
	}
	if r := keywordOperandRewrite(c, file, site.call, site.operand); r.fixable() || r != nil && r.why != "" {
		return r
	}
	if value == nil || value.Flags()&checker.TypeFlagsAny != 0 {
		return refuse("Its type is any, so no rewrite can say whether it held a program: give it a type, or call it, p(), where it is one.")
	}
	if effectInterfaceSymbol(c, value) != nil {
		text := expressionText(file, inner)
		if needsParentheses(inner) {
			text = "(" + text + ")"
		}
		return &formRewrite{edits: []sourceEdit{{nodeStart(file, site.operand), site.operand.End(), text + "()"}}, description: shortDescription(text+"()", "")}
	}
	return nil
}

// keywordMigrationFixes proposes, for one --fix round, the rewrites that keep
// each changed keyword operand's old meaning, innermost first.
func keywordMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool, refuse func(FixRefusal, string)) proposal {
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	a := analyzerFor(c)
	var candidates []fileFix
	for _, site := range a.legacyKeywordSites(file) {
		key := "keywordOperand:" + expressionText(file, site.call)
		if refused[key] {
			continue
		}
		code := a.legacyKeywordCode(site)
		r := keywordMigrationRewrite(c, file, site)
		if !r.fixable() {
			line, _ := scannerLineOf(file, scanner.SkipTrivia(file.Text(), site.operand.Pos()))
			why := "this operand needs a rewrite by hand"
			if r != nil && r.why != "" {
				why = r.why
			}
			refuse(FixRefusal{File: file.FileName(), Line: line + 1, Code: code, Error: why}, key)
			continue
		}
		candidates = append(candidates, fileFix{code: code, edits: r.edits, key: key})
	}
	slices.SortStableFunc(candidates, func(x, y fileFix) int { return x.edits[0].end - x.edits[0].start - (y.edits[0].end - y.edits[0].start) })
	p := proposal{file: file}
	var taken []sourceEdit
	for _, candidate := range candidates {
		if !overlapsAny(candidate.edits[0], taken) {
			p.fixes = append(p.fixes, candidate)
			taken = append(taken, candidate.edits...)
		}
	}
	return p
}

// legacyKeywordCode is the code of the diagnostic at site: the ordinary
// error its new reading reports, or EK1023 where that reading compiles.
func (a *analyzer) legacyKeywordCode(site legacyKeywordSite) int32 {
	c := a.checker
	inner := ast.SkipParentheses(site.operand)
	if ast.IsFunctionExpressionOrArrowFunction(inner) {
		return EK4613.Code
	}
	value := a.keywordValueType(inner)
	switch {
	case value == nil:
	case a.isProgramValueType(value):
		return EK4613.Code
	case awaitOperationNames[fiberHelper(site.call)] != "" && isFiberType(c, value):
		return EK4609.Code
	case awaitOperationNames[fiberHelper(site.call)] != "" && isDeferredType(c, value):
		return EK4610.Code
	}
	return EK1023.Code
}
