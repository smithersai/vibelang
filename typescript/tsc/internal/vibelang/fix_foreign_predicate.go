package vibelang

import (
	"slices"
	"strings"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// A predicateBridge is what keeps a foreign type predicate's proof: the edits
// that read its const in the narrowed scopes and test it in the condition,
// the const's declaration, and the if statement the declaration goes before.
// A placed bridge's edits already write the declaration inside the statement,
// after the operands that run before the predicate.
type predicateBridge struct {
	edits       []sourceEdit
	declaration string
	statement   *ast.Node
	placed      bool
}

// foreignPredicateBridge plans call's predicate bridge, or returns the
// boolean bridge's reason, or neither when call is not a predicate tested by
// an if.
func foreignPredicateBridge(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (*predicateBridge, string) {
	signature := c.GetResolvedSignature(call)
	if signature == nil {
		return nil, ""
	}
	predicate := c.GetTypePredicateOfSignature(signature)
	if predicate == nil || predicate.Kind() != checker.TypePredicateKindIdentifier {
		return nil, ""
	}
	condition := call
	for ast.IsParenthesizedExpression(condition.Parent) {
		condition = condition.Parent
	}
	negated := ast.IsPrefixUnaryExpression(condition.Parent) && condition.Parent.AsPrefixUnaryExpression().Operator == ast.KindExclamationToken
	if negated {
		condition = condition.Parent
		for ast.IsParenthesizedExpression(condition.Parent) {
			condition = condition.Parent
		}
	}
	// The predicate can be one operand of a chain the if tests: a negated
	// one under ||, whose failure runs the branch, or a plain one under &&.
	operator := ast.KindAmpersandAmpersandToken
	if negated {
		operator = ast.KindBarBarToken
	}
	chain := condition
	for ast.IsBinaryExpression(chain.Parent) && chain.Parent.AsBinaryExpression().OperatorToken.Kind == operator {
		chain = chain.Parent
	}
	statement := chain.Parent
	if !ast.IsIfStatement(statement) || statement.Expression() != chain {
		return nil, ""
	}
	var operands []*ast.Node
	var flatten func(*ast.Node)
	flatten = func(n *ast.Node) {
		if ast.IsBinaryExpression(n) && n.AsBinaryExpression().OperatorToken.Kind == operator {
			flatten(n.AsBinaryExpression().Left)
			flatten(n.AsBinaryExpression().Right)
			return
		}
		operands = append(operands, n)
	}
	flatten(chain)
	at := slices.Index(operands, condition)
	if predicateMayIncludeUndefined(c, predicate.Type()) {
		return nil, " (boolean bridge; the predicate type includes undefined, so the sentinel is ambiguous)"
	}
	fallback := " (boolean bridge; narrowing requires an unreassigned const or parameter identifier)"
	args := call.Arguments()
	index := int(predicate.ParameterIndex())
	if index < 0 || index >= len(args) || !ast.IsIdentifier(args[index]) {
		return nil, fallback
	}
	tested := args[index]
	binding := c.GetSymbolAtLocation(tested)
	if binding == nil || len(binding.Declarations()) != 1 {
		return nil, fallback
	}
	decl := ast.GetRootDeclaration(binding.Declarations()[0])
	if !ast.IsParameterDeclaration(decl) && !(ast.IsVariableDeclaration(decl) && ast.GetCombinedNodeFlags(decl)&ast.NodeFlagsConst != 0) {
		return nil, fallback
	}
	reference := func(n *ast.Node) bool {
		if !ast.IsIdentifier(n) {
			return false
		}
		if ast.IsShorthandPropertyAssignment(n.Parent) {
			return c.GetShorthandAssignmentValueSymbol(n.Parent) == binding
		}
		return !ast.IsDeclarationName(n) && c.GetSymbolAtLocation(n) == binding
	}
	var writes func(*ast.Node) bool
	writes = func(n *ast.Node) bool {
		if reference(n) && (ast.IsWriteAccess(n) || ast.IsShorthandPropertyAssignment(n.Parent) && ast.IsAssignmentTarget(n.Parent)) {
			return true
		}
		return n.ForEachChild(writes)
	}
	// Include captured writes: a callback can run during the predicate or
	// later inside the branch. Shadowed bindings have different symbols.
	if file.AsNode().ForEachChild(writes) {
		return nil, fallback
	}
	if symbol := c.ResolveName("undefined", call, ast.SymbolFlagsValue, false); symbol != nil && !c.IsUndefinedSymbol(symbol) {
		return nil, " (boolean bridge; undefined is shadowed)"
	}
	if analyzerFor(c).runsVibeLang(call) {
		return nil, " (boolean bridge; predicate operands run Effects)"
	}

	branch := statement.AsIfStatement()
	// Operands before the predicate can decide the condition without it, so
	// the const is declared where they have not: under an if of the operands
	// before it for &&, and after an if of them, which repeats the exiting
	// branch, for ||.
	if at > 0 && branch.ElseStatement != nil {
		return nil, " (boolean bridge; the if has an else and an operand before the predicate)"
	}
	if at > 0 && negated && (!predicateGuardExits(branch.ThenStatement) || !ast.IsBlock(statement.Parent)) {
		return nil, " (boolean bridge; an operand before the predicate and a branch that does not exit)"
	}
	// Operands after the predicate run only when it holds.
	scopes := []*ast.Node{branch.ThenStatement}
	if negated {
		scopes = nil
		if branch.ElseStatement != nil {
			scopes = append(scopes, branch.ElseStatement)
		} else if predicateGuardExits(branch.ThenStatement) && ast.IsBlock(statement.Parent) {
			for _, next := range statement.Parent.Statements() {
				if next.Pos() >= statement.End() {
					scopes = append(scopes, next)
				}
			}
		}
	}
	name := predicateValueName(c, file, call)
	var edits []sourceEdit
	var rewrite func(*ast.Node) bool
	rewrite = func(n *ast.Node) bool {
		// Hoisted function bodies do not inherit the guard proof and may
		// run before the new const is initialized.
		if ast.IsFunctionDeclaration(n) {
			return false
		}
		if reference(n) {
			text := name
			if ast.IsShorthandPropertyAssignment(n.Parent) {
				text = nodeText(file, n) + ": " + name
			}
			edits = append(edits, sourceEdit{nodeStart(file, n), n.End(), text})
		}
		return n.ForEachChild(rewrite)
	}
	scopes = append(scopes, operands[at+1:]...)
	for _, scope := range scopes {
		rewrite(scope)
	}
	comparison := " !== undefined"
	if negated {
		comparison = " === undefined"
	}
	edits = append(edits, sourceEdit{nodeStart(file, condition), condition.End(), name + comparison})
	declaration := "const " + name + " = try Effect.orDie(Effect.try({ try: () => " + nodeText(file, call) + " ? " + nodeText(file, tested) + " : undefined, catch: " + defectBridgeIdentity + " }))"
	if at == 0 {
		return &predicateBridge{edits: edits, declaration: declaration, statement: statement}, ""
	}
	// Every edit inside the statement is in the predicate's operand, the
	// operands after it, or a then branch that && narrows.
	start, end, from := nodeStart(file, statement), statement.End(), nodeStart(file, condition)
	var outside, inside []sourceEdit
	for _, edit := range edits {
		if edit.start >= from && edit.end <= end {
			inside = append(inside, sourceEdit{edit.start - from, edit.end - from, edit.text})
		} else {
			outside = append(outside, edit)
		}
	}
	text := file.Text()
	head := text[start:operands[at-1].End()]
	rest := "if (" + applyEdits(text[from:end], inside)
	indent := lineIndent(text, start)
	replacement := head + text[chain.End():end] + "\n" + indent + declaration + "\n" + indent + rest
	if !negated {
		inner := indent + branchIndentUnit(indent)
		replacement = head + ") {\n" + inner + declaration + "\n" + inner + rest + "\n" + indent + "}"
	}
	edits = append(outside, sourceEdit{start, end, replacement})
	return &predicateBridge{edits: edits, declaration: declaration, statement: statement, placed: true}, ""
}

// An uninstantiated parameter can admit undefined even when undefined is
// not assignable to every instantiation. Ask for its constraint, including
// parameters nested in unions and intersections, rather than inspecting names.
func predicateMayIncludeUndefined(c *checker.Checker, t *checker.Type) bool {
	if t == nil || c.IsTypeAssignableTo(c.GetUndefinedType(), t) {
		return true
	}
	if t.Flags()&checker.TypeFlagsUnion != 0 {
		for _, member := range t.Types() {
			if predicateMayIncludeUndefined(c, member) {
				return true
			}
		}
		return false
	}
	if t.Flags()&checker.TypeFlagsIntersection != 0 {
		for _, member := range t.Types() {
			if !predicateMayIncludeUndefined(c, member) {
				return false
			}
		}
		return true
	}
	if t.Flags()&checker.TypeFlagsInstantiableNonPrimitive != 0 {
		constraint := c.GetBaseConstraintOfType(t)
		return constraint == nil || constraint == t || predicateMayIncludeUndefined(c, constraint)
	}
	return false
}

func predicateGuardExits(n *ast.Node) bool {
	if ast.IsBlock(n) {
		statements := n.Statements()
		return len(statements) > 0 && predicateGuardExits(statements[len(statements)-1])
	}
	return ast.IsReturnStatement(n) || ast.IsThrowStatement(n)
}

// Avoid names even in nested scopes, where replacing a reference could
// otherwise capture a different binding. Reserve earlier predicates too,
// since a CLI round can plan several fixes before applying any of them.
func predicateValueName(c *checker.Checker, file *ast.SourceFile, call *ast.Node) string {
	base := "narrowed"
	callee := call.Expression()
	if ast.IsPropertyAccessExpression(callee) {
		callee = callee.Name()
	}
	if ast.IsIdentifier(callee) {
		runes := []rune(callee.Text())
		if len(runes) > 2 && string(runes[:2]) == "is" && unicode.IsUpper(runes[2]) {
			runes[2] = unicode.ToLower(runes[2])
			candidate := string(runes[2:])
			if !ast.IsKeyword(scanner.StringToToken(candidate)) {
				base = candidate
			}
		}
	}
	used := map[string]bool{}
	earlier := 0
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			used[n.Text()] = true
		}
		if ast.IsCallExpression(n) && n.Pos() < call.Pos() {
			if sig := c.GetResolvedSignature(n); sig != nil && c.GetTypePredicateOfSignature(sig) != nil {
				earlier++
			}
		}
		n.ForEachChild(visit)
		return false
	}
	file.AsNode().ForEachChild(visit)
	name := base + strings.Repeat("_", earlier)
	for used[name] || c.ResolveName(name, call, ast.SymbolFlagsValue|ast.SymbolFlagsType|ast.SymbolFlagsAlias, false) != nil {
		name += "_"
	}
	return name
}
