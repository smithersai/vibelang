package vibelang

import (
	"strings"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// Keep the predicate and its narrowed read in the same plain thunk. The
// boolean bridge alone cannot transport TypeScript's control-flow proof.
func planForeignPredicate(c *checker.Checker, file *ast.SourceFile, call *ast.Node) (*formRewrite, string) {
	bridge, fallback := foreignPredicateBridge(c, file, call)
	if bridge == nil {
		return nil, fallback
	}
	edits, statement, declaration := bridge.edits, bridge.statement, bridge.declaration
	start := nodeStart(file, statement)
	indent := lineIndent(file.Text(), start)
	separator := "\n" + indent
	if strings.TrimSpace(file.Text()[strings.LastIndexByte(file.Text()[:start], '\n')+1:start]) != "" {
		separator = "; "
	}
	if !ast.IsBlock(statement.Parent) {
		// A declaration must stay under an enclosing unbraced guard or label.
		var inside, outside []sourceEdit
		for _, edit := range edits {
			if edit.start >= start && edit.end <= statement.End() {
				inside = append(inside, sourceEdit{edit.start - start, edit.end - start, edit.text})
			} else {
				outside = append(outside, edit)
			}
		}
		text := file.Text()[start:statement.End()]
		text = applyEdits(text, inside)
		inner := indent + branchIndentUnit(indent)
		edits = append(outside, sourceEdit{start, statement.End(), "{\n" + inner + declaration + "\n" + inner + text + "\n" + indent + "}"})
	} else {
		edits = append(edits, sourceEdit{start, start, declaration + separator})
	}
	return &formRewrite{edits: joinEditsAt(edits), description: "the predicate through Effect.try, preserving narrowing and defects"}, ""
}

// A predicateBridge is what keeps a foreign type predicate's proof: the edits
// that read its const in the narrowed scopes and test it in the condition,
// the const's declaration, and the if statement the declaration goes before.
type predicateBridge struct {
	edits       []sourceEdit
	declaration string
	statement   *ast.Node
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
	statement := condition.Parent
	if !ast.IsIfStatement(statement) || statement.Expression() != condition {
		return nil, ""
	}
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
	for _, scope := range scopes {
		rewrite(scope)
	}
	comparison := " !== undefined"
	if negated {
		comparison = " === undefined"
	}
	edits = append(edits, sourceEdit{nodeStart(file, condition), condition.End(), name + comparison})
	declaration := "const " + name + " = try Effect.orDie(Effect.try({ try: () => " + nodeText(file, call) + " ? " + nodeText(file, tested) + " : undefined, catch: " + defectBridgeIdentity + " }))"
	return &predicateBridge{edits: edits, declaration: declaration, statement: statement}, ""
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
