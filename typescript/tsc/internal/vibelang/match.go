package vibelang

import (
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// Pattern matching (D206-D225). The parser writes `match (x) { when P: v; }`
// and `x is P` as TypeScript the checker narrows (vibelang_match.go in package
// parser). A match without a default arm ends in a call of $noMatch with the
// subject, so the subject's type there is what no arm matched: when the
// subject's type is a finite union and that is not never, the match misses a
// case (EK4701), as Effect's Match.exhaustive does. A pattern form VibeLang
// does not support is a call of $patternError, reported here.

var (
	// EK4701: a match over a finite union with no default arm misses a case. {0} is the subject's type, {1} the cases left.
	EK4701 = message(4701, errorCategory, "This match does not handle every case of {0}: {1} is left.")
	// EK4702: a binding inside an or or not pattern.
	EK4702 = message(4702, errorCategory, "A binding cannot appear inside an or or not pattern yet.")
	// EK4703: an is whose pattern binds names outside an if or while condition.
	EK4703 = message(4703, errorCategory, "Bindings in an is pattern work only in the condition of an if or while statement, joined by &&.")
	// EK4704: a pattern form VibeLang does not support yet. {0} names it.
	EK4704 = message(4704, errorCategory, "{0} patterns are not supported yet.")
	// EK4705: and, or, and not combined at one level without parentheses.
	EK4705 = message(4705, errorCategory, "Patterns joined by and, or, or not cannot share a level; add parentheses.")
)

func init() {
	for _, m := range []*Message{EK4701, EK4702, EK4703, EK4704, EK4705} {
		registry[m.Code] = m
	}
	fileChecks = append(fileChecks, checkPatterns)
}

// patternHelper returns the runtime helper that call, a call the parser wrote
// for a match or is (its callee is synthesized), calls: "$noMatch" or
// "$patternError". It returns "" for any other node.
func patternHelper(call *ast.Node) string {
	if call == nil || !ast.IsCallExpression(call) {
		return ""
	}
	callee := call.Expression()
	if callee.Kind != ast.KindIdentifier || callee.Flags&ast.NodeFlagsReparsed == 0 {
		return ""
	}
	switch name := callee.Text(); name {
	case "$noMatch", "$patternError":
		return name
	}
	return ""
}

func checkPatterns(c *checker.Checker, file *ast.SourceFile) {
	var visit func(node *ast.Node) bool
	visit = func(node *ast.Node) bool {
		switch patternHelper(node) {
		case "$noMatch":
			checkExhaustive(c, file, node)
		case "$patternError":
			reportPatternError(c, file, node)
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// checkExhaustive reports a match whose subject still has cases at the
// $noMatch call that ends its arms. A subject that is a finite union is
// covered when its arms leave nothing of it. Any other subject is open
// (D346, D428): string or number without a literal type, unknown, any,
// object, a type parameter, or a class that is not closed. No literal or
// open class arm covers it, so it needs a default arm, an arm that matches
// every value its type has, such as `when String:` over a string or a closed
// class's arm over an open family's base, or an arm that always matches, as
// a bind-only arm `when let other:` does.
func checkExhaustive(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	if afterIrrefutableArm(call) {
		return
	}
	declared, left := matchRemainder(c, call)
	open := false
	if declared == nil {
		if declared, left = matchSubjectTypes(c, call); declared == nil || hasUnconditionalArm(call) {
			return
		}
		open = true
	}
	// Flow analysis already reported its complexity limit. Its error sentinel
	// is neither evidence of a missing case nor a proof of exhaustiveness.
	if left == c.GetErrorType() || left.Flags()&checker.TypeFlagsNever != 0 {
		return
	}
	declaredText, leftText := diagnosticUnionText(c, declared), diagnosticUnionText(c, left)
	if symbol := c.GetSymbolAtLocation(declaredSubject(c, call.Arguments()[0])); symbol != nil {
		// A data type's variants by name, Delivery.Sent, not their object types (D307).
		if names := dataNamesFor(c, symbol, call); names.hasVariants(c, declared) {
			declaredText, leftText = names.typeText(c, declared), diagnosticListText(names.unionTexts(c, left), " | ")
			if len(members(declared)) > diagnosticListLimit && declaredText == names.unionText(c, declared) {
				declaredText = diagnosticListText(names.unionTexts(c, declared), " | ")
			}
		}
	}
	if nested := nestedMatchRemainder(c, call, left); nested != "" {
		leftText = nested
	}
	d := reportAt(c, file, call.Expression().Loc, EK4701, declaredText, leftText)
	if open {
		note(d, "{0} is open: it is not a finite union of literals, data variants, and closed classes, so arms over its cases cannot cover it.", declaredText)
	}
	for _, why := range uncountedArmNotes(c, file, call) {
		note(d, why)
	}
	if why := signedZeroArmNote(c, file, call, left); why != "" {
		note(d, why)
	}
	if open {
		note(d, "Add a default arm, or narrow the subject's declared type to the cases the match handles.")
		return
	}
	note(d, "Add an arm for each case that is left, or a default arm.")
}

// signedZeroArmNote returns a note for EK4701 when the zero case is left and
// an arm before call, the $noMatch call that ends the match, tests a signed
// zero, `when -0:`: the parser writes Object.is($match1, -0), whose SameValue
// test tells -0 from +0, so the arm covers no zero case of TypeScript's 0,
// which admits both (decided detail 169). It returns "" otherwise.
func signedZeroArmNote(c *checker.Checker, file *ast.SourceFile, call *ast.Node, left *checker.Type) string {
	zeroLeft := false
	for _, m := range members(left) {
		if m.Flags()&checker.TypeFlagsNumberLiteral != 0 && c.TypeToString(m) == "0" {
			zeroLeft = true
		}
	}
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if !zeroLeft || statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return ""
	}
	written := ""
	for _, arm := range statement.Parent.AsBlock().Statements.Nodes {
		if arm == statement || written != "" {
			break
		}
		var visit func(node *ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsFunctionLike(node) || written != "" {
				return written != ""
			}
			if ast.IsCallExpression(node) && ast.IsPropertyAccessExpression(node.Expression()) && len(node.Arguments()) == 2 {
				callee := node.Expression()
				if isSynthesizedName(callee.Expression(), "Object") && callee.Name().Text() == "is" && parser.IsSignedNumberZero(node.Arguments()[1]) {
					written = nodeText(file, node.Arguments()[1])
					return true
				}
			}
			return node.ForEachChild(visit)
		}
		visit(arm)
	}
	if written == "" {
		return ""
	}
	return "when " + written + ": covers no zero case: it matches by SameValue, which tells -0 from +0, and the type 0 admits both. Write when 0:, which matches both, or a default arm."
}

// hasUnconditionalArm reports whether an arm of the match that call, its
// $noMatch call, ends leaves the match whatever the subject is: an arm with
// no test, such as a bind-only arm `when let other:`, which covers every
// case as default does.
func hasUnconditionalArm(call *ast.Node) bool {
	statement := call.Parent
	for statement != nil && !ast.IsStatement(statement) {
		statement = statement.Parent
	}
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return false
	}
	for _, arm := range statement.Parent.AsBlock().Statements.Nodes {
		if arm == statement {
			break
		}
		if ast.IsBlock(arm) && endsInJump(arm) {
			return true
		}
	}
	return false
}

// endsInJump reports whether block's last statement leaves it: a return,
// throw, break, or continue that no test guards.
func endsInJump(block *ast.Node) bool {
	statements := block.AsBlock().Statements.Nodes
	if len(statements) == 0 {
		return false
	}
	switch statements[len(statements)-1].Kind {
	case ast.KindReturnStatement, ast.KindThrowStatement, ast.KindBreakStatement, ast.KindContinueStatement:
		return true
	}
	return false
}

// provenExhaustive reports whether D209 proves that call, the $noMatch call
// that ends a match without a default arm, never runs: the subject's
// declared type is a finite union and no case of it is left there (D294).
func provenExhaustive(c *checker.Checker, call *ast.Node) bool {
	if afterIrrefutableArm(call) {
		return true
	}
	declared, left := matchRemainder(c, call)
	return declared != nil && left.Flags()&checker.TypeFlagsNever != 0
}

// afterIrrefutableArm reports whether call, the $noMatch call that ends a
// match, follows an arm that tests nothing, such as when let other:, which
// matches every value. The parser writes such an arm as a block with no if,
// so the call is unreachable, and the subject's type there is its declared
// type, not never, though no case is left.
func afterIrrefutableArm(call *ast.Node) bool {
	statement := call.Parent
	if statement == nil || statement.Parent == nil || !ast.IsBlock(statement.Parent) {
		return false
	}
	statements := statement.Parent.Statements()
	for i, s := range statements {
		if s != statement {
			continue
		}
		if i == 0 || !ast.IsBlock(statements[i-1]) {
			return false
		}
		for _, inner := range statements[i-1].Statements() {
			if ast.IsIfStatement(inner) {
				return false
			}
		}
		return true
	}
	return false
}

// matchRemainder returns the declared type of the subject of call, the
// $noMatch call that ends a match, and its narrowed type there, what no arm
// matched. It returns nils unless the declared type is a finite union. A
// subject that is an identifier expression has the type its declaration
// gives it, not the type the subject's capture has (match_capture.go).
func matchRemainder(c *checker.Checker, call *ast.Node) (declared, left *checker.Type) {
	declared, left = matchSubjectTypes(c, call)
	if declared == nil || !isFiniteMatchType(c, declared) {
		return nil, nil
	}
	return declared, left
}

// matchSubjectTypes returns the declared type of the subject of call, the
// $noMatch call that ends a match, and its narrowed type there, whatever the
// declared type is, or nils when the subject has no declaration.
func matchSubjectTypes(c *checker.Checker, call *ast.Node) (declared, left *checker.Type) {
	args := call.Arguments()
	if len(args) != 1 {
		return nil, nil
	}
	subject := args[0]
	left = c.GetTypeAtLocation(subject)
	if left == nil {
		return nil, nil
	}
	symbol := c.GetSymbolAtLocation(declaredSubject(c, subject))
	if symbol == nil {
		return nil, nil
	}
	declared = c.GetTypeOfSymbol(symbol)
	if declared == nil {
		return nil, nil
	}
	return declared, left
}

// isFiniteMatchType reports whether t is a finite union a match can cover:
// each member a literal, an enum member, null, undefined, or void, or an
// object type whose _tag is a string literal (tagged errors, Option, Exit,
// Result).
func isFiniteMatchType(c *checker.Checker, t *checker.Type) bool {
	members := []*checker.Type{t}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		members = t.Types()
	}
	for _, m := range members {
		flags := m.Flags()
		if flags&(checker.TypeFlagsUnit|checker.TypeFlagsVoid|checker.TypeFlagsNever) != 0 {
			continue
		}
		if flags&checker.TypeFlagsObject != 0 {
			if tag := c.GetPropertyOfType(m, "_tag"); tag != nil && c.GetTypeOfSymbol(tag).Flags()&checker.TypeFlagsStringLiteral != 0 {
				continue
			}
		}
		return false
	}
	return true
}

// reportPatternError reports the pattern a $patternError call stands for, at
// the pattern's first token (or the is keyword).
func reportPatternError(c *checker.Checker, file *ast.SourceFile, call *ast.Node) {
	args := call.Arguments()
	if len(args) == 0 || args[0].Kind != ast.KindNumericLiteral {
		return
	}
	code, err := strconv.Atoi(args[0].Text())
	if err != nil {
		return
	}
	at := call.Expression().Loc
	switch code {
	case 1017:
		reportAt(c, file, at, EK1017)
	case 4702:
		note(reportAt(c, file, at, EK4702), "Bind the whole value outside it, when let v and (A or B): …, or write one arm for each alternative.")
	case 4703:
		note(reportAt(c, file, at, EK4703), "Use the pattern in an if or while condition, or match the value with match.")
	case 4704:
		detail := "These"
		if len(args) > 1 && args[1].Kind == ast.KindStringLiteral {
			detail = args[1].Text()
		}
		note(reportAt(c, file, at, EK4704, detail), "Bind the value and test it in a guard: when let v and if (…): …")
	case 4705:
		note(reportAt(c, file, at, EK4705), "Write (a and b) or c, or a and (b or c).")
	}
	cover(c, call)
}
