package vibelang

import (
	"context"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// VIP-4 detail 282: retire a private empty trusted wrapper only when every
// observation is a direct invocation in an explicit Effect body. Capture the
// implementation where the old wrapper captured it; keep each invocation at
// its original position, converting its exact thrown value into a defect.
// Escaping functions and public Trusted types require a reviewed .ts adapter.
func trustedEmptyMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsVariableDeclaration(n) {
			if rewrite := trustedEmptyRewrite(c, file, n); rewrite.fixable() {
				key := fmt.Sprintf("trusted-empty:%d:%d", n.Pos(), n.End())
				if !refused[key] {
					result.fixes = append(result.fixes, fileFix{label: "trusted empty-list migration", key: key, edits: rewrite.edits})
					return true // one binding per checked round; call-site edits may overlap
				}
			}
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return result
}

func trustedEmptyRewrite(c *checker.Checker, file *ast.SourceFile, decl *ast.Node) *formRewrite {
	if decl.Type() != nil || !ast.IsIdentifier(decl.Name()) || ast.GetCombinedNodeFlags(decl)&ast.NodeFlagsConst == 0 {
		return nil
	}
	statement := decl.Parent
	if statement == nil || !ast.IsVariableDeclarationList(statement) {
		return nil
	}
	statement = statement.Parent
	if statement == nil || !ast.IsVariableStatement(statement) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport) {
		return nil
	}
	init := decl.Initializer()
	if init == nil || !ast.IsCallExpression(init) || runtimeExportOf(c, init.Expression()) != "trusted" || !trustedEmptyConstructorBinding(c, init.Expression()) {
		return nil
	}
	args := init.Arguments()
	if len(args) != 2 || !ast.IsArrayLiteralExpression(args[1]) || len(args[1].AsArrayLiteralExpression().Elements.Nodes) != 0 {
		return nil
	}
	// Never discard comments, including an approval attached to the empty list.
	text := expressionText(file, init)
	if strings.Contains(text, "/*") || strings.Contains(text, "//") {
		return nil
	}
	symbol := c.GetSymbolAtLocation(decl.Name())
	if symbol == nil {
		return nil
	}
	impl := trustedEmptyCaptureName(file, decl.Name().Text()+"_impl")
	// Inline the old forwarding function as ordinary TypeScript. In particular,
	// impl.apply is read after argument evaluation, as in runtime.trusted.
	// Its contextual type preserves the original callable's signature, and the
	// fix gate declines any implementation that cannot satisfy that type.
	edits := []sourceEdit{
		{nodeStart(file, decl), nodeStart(file, decl), impl + " = (void " + expressionText(file, init.Expression()) + ", " + expressionText(file, args[0]) + "), "},
		{decl.Name().End(), decl.Name().End(), ": typeof " + impl},
		{nodeStart(file, init), init.End(), "function (...args) { return " + impl + ".apply(void 0, args) }"},
	}
	safe := true
	calls := 0
	writtenThrows := trustedEmptyWrittenThrows(c, args[0])
	var uses func(*ast.Node) bool
	uses = func(n *ast.Node) bool {
		// Direct eval can observe or leak a lexical binding without an
		// identifier reference. Do not claim every observation is a call.
		if ast.IsCallExpression(n) && ast.IsIdentifier(n.Expression()) && n.Expression().Text() == "eval" {
			safe = false
			return true
		}
		var referenced *ast.Symbol
		if n != decl.Name() && ast.IsIdentifier(n) {
			referenced = c.GetSymbolAtLocation(n)
			// A shorthand property has its own property symbol, and an export
			// specifier can have an alias symbol. Both still expose the binding.
			if n.Parent != nil && n.Parent.Kind == ast.KindShorthandPropertyAssignment {
				referenced = c.GetShorthandAssignmentValueSymbol(n.Parent)
			} else if referenced != nil && referenced.Flags()&ast.SymbolFlagsAlias != 0 {
				referenced = c.GetAliasedSymbol(referenced)
			}
		}
		if referenced == symbol {
			call := n.Parent
			if !ast.IsCallExpression(call) || call.Expression() != n || call.AsCallExpression().QuestionDotToken != nil {
				safe = false
				return true
			}
			fn := enclosingFunction(call)
			if fn == nil || !isMarkedEffect(fn) || fn.Body() == nil || !ast.IsNodeDescendantOf(call, fn.Body()) {
				safe = false
				return true
			}
			for parent := call.Parent; parent != nil && parent != fn; parent = parent.Parent {
				if ast.IsClassDeclaration(parent) || ast.IsClassExpression(parent) {
					safe = false
					return true // class initialization belongs to its native activation
				}
			}
			// Effect operands and nonlocal control flow must not move into a plain
			// thunk. In particular, a typed throw must not become a defect.
			var runs func(*ast.Node) bool
			runs = func(value *ast.Node) bool {
				if value.Flags&ast.NodeFlagsVibeLangTry != 0 || isThrowExpression(file, value) || ast.IsThrowStatement(value) || isProgramArrow(value) {
					return true
				}
				if isFunctionBoundary(value) {
					return false
				}
				return value.ForEachChild(runs)
			}
			for _, arg := range call.Arguments() {
				if runs(arg) {
					safe = false
					return true
				}
			}
			// A local Effect binding is not the prelude module used by this bridge.
			effect := c.ResolveName("Effect", call, ast.SymbolFlagsValue|ast.SymbolFlagsNamespace, false)
			if effect != nil {
				if effect.Flags()&ast.SymbolFlagsAlias != 0 {
					effect = c.GetAliasedSymbol(effect)
				}
				d := effect.ValueDeclaration()
				if d != nil && packageOf(c, ast.GetSourceFileOfNode(d)) != "effect" {
					safe = false
					return true
				}
			}
			thunk := "() => " + expressionText(file, call)
			if trustedEmptyNarrowedArguments(c, call) {
				// A closure loses the narrowing of a parameter, a let or a
				// property path, so evaluate the arguments here, in their
				// original order, and give the thunk their narrowed values.
				// Only a thunk written as Effect.try's own try function may
				// call a callee known to throw, so such a call is refused.
				captured, ok := trustedEmptyCapturedThunk(file, call)
				if !ok || writtenThrows {
					safe = false
					return true
				}
				thunk = captured
			}
			wrapped := "try Effect.orDie(Effect.try({ try: " + thunk + ", catch: " + defectBridgeIdentity + " }))"
			if !standsAlone(call) {
				wrapped = "(" + wrapped + ")"
			}
			edits = append(edits, sourceEdit{nodeStart(file, call), call.End(), wrapped})
			calls++
			return false
		}
		return n.ForEachChild(uses)
	}
	file.AsNode().ForEachChild(uses)
	if !safe || calls == 0 {
		return nil
	}
	for i, a := range edits {
		for _, b := range edits[i+1:] {
			if a.start < b.end && b.start < a.end {
				return nil
			}
		}
	}
	return &formRewrite{description: "the empty trusted wrapper through Effect.try and Effect.orDie", edits: edits}
}

// A capture must not shadow a name anywhere the new forwarding closure can see.
func trustedEmptyCaptureName(file *ast.SourceFile, base string) string {
	used := map[string]bool{}
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			used[n.Text()] = true
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	name := base
	for suffix := 2; used[name]; suffix++ {
		name = fmt.Sprintf("%s%d", base, suffix)
	}
	return name
}

// A typed namespace-shaped value may be a Proxy whose constructor has user
// effects. Only a direct import binding or an actual namespace import proves
// that this call is the runtime constructor the migration models.
func trustedEmptyConstructorBinding(c *checker.Checker, expr *ast.Node) bool {
	if ast.IsIdentifier(expr) {
		symbol := c.GetSymbolAtLocation(expr)
		return symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0
	}
	if !ast.IsPropertyAccessExpression(expr) || !ast.IsIdentifier(expr.Expression()) {
		return false
	}
	owner := c.GetSymbolAtLocation(expr.Expression())
	if owner == nil || owner.Flags()&ast.SymbolFlagsAlias == 0 {
		return false
	}
	for _, declaration := range owner.Declarations() {
		if declaration.Kind == ast.KindNamespaceImport {
			return true
		}
	}
	return false
}

// trustedEmptyNarrowedArguments reports whether an argument of call reads a
// reference whose type at the call is narrower than its declared type. A
// const keeps its narrowing inside a closure; a parameter, a let and a
// property path may not, so moving such an argument into the bridge's thunk
// could change its type.
func trustedEmptyNarrowedArguments(c *checker.Checker, call *ast.Node) bool {
	narrowed := false
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if narrowed || isFunctionBoundary(n) {
			return narrowed
		}
		if ast.IsIdentifier(n) || ast.IsPropertyAccessExpression(n) || ast.IsElementAccessExpression(n) {
			if trustedEmptyReferenceNarrowed(c, n) {
				narrowed = true
				return true
			}
		}
		return n.ForEachChild(visit)
	}
	for _, argument := range call.Arguments() {
		if visit(argument) {
			return true
		}
	}
	return narrowed
}

func trustedEmptyReferenceNarrowed(c *checker.Checker, n *ast.Node) bool {
	if ast.IsIdentifier(n) && n.Parent != nil && (ast.IsPropertyAccessExpression(n.Parent) && n.Parent.Name() == n || ast.IsPropertyAssignment(n.Parent) && n.Parent.Name() == n) {
		return false // a member name; its access is the reference
	}
	symbol := c.GetSymbolAtLocation(n)
	if ast.IsPropertyAccessExpression(n) {
		symbol = c.GetSymbolAtLocation(n.Name())
	}
	if symbol == nil || symbol.Flags()&(ast.SymbolFlagsVariable|ast.SymbolFlagsProperty) == 0 {
		return false
	}
	if d := symbol.ValueDeclaration(); d != nil && ast.IsVariableDeclaration(d) && ast.IsVarConst(d) {
		return false
	}
	return c.GetTypeAtLocation(n) != c.GetTypeOfSymbol(symbol)
}

// trustedEmptyCapturedThunk returns ((arg0, …) => () => f(arg0, …))(a, …),
// which evaluates call's arguments where call stood, or false for a spread
// argument or explicit type arguments.
func trustedEmptyCapturedThunk(file *ast.SourceFile, call *ast.Node) (string, bool) {
	// The parameters are visible only to the thunk, which reads nothing else
	// but the callee: they must not shadow its names.
	used := map[string]bool{}
	var names func(*ast.Node) bool
	names = func(n *ast.Node) bool {
		if ast.IsIdentifier(n) {
			used[n.Text()] = true
		}
		return n.ForEachChild(names)
	}
	names(call.Expression())
	var params, args []string
	for i, argument := range call.Arguments() {
		if ast.IsSpreadElement(argument) {
			return "", false
		}
		name := fmt.Sprintf("arg%d", i)
		for suffix := 2; used[name]; suffix++ {
			name = fmt.Sprintf("arg%d_%d", i, suffix)
		}
		params = append(params, name)
		args = append(args, expressionText(file, argument))
	}
	if call.TypeArguments() != nil {
		return "", false
	}
	callee := expressionText(file, call.Expression())
	list := strings.Join(params, ", ")
	return "((" + list + ") => () => " + callee + "(" + list + "))(" + strings.Join(args, ", ") + ")", true
}

// trustedEmptyWrittenThrows reports whether a call signature of impl, the
// wrapped function, carries a written @throws or @rethrows. Such a call may
// stand only in the thunk written as Effect.try's own try function.
func trustedEmptyWrittenThrows(c *checker.Checker, impl *ast.Node) bool {
	for _, sig := range c.GetSignaturesOfType(c.GetTypeAtLocation(impl), checker.SignatureKindCall) {
		root := sig
		for root.Target() != nil {
			root = root.Target()
		}
		if decl := root.Declaration(); decl != nil {
			for _, host := range jsdocHosts(decl) {
				for _, doc := range host.JSDoc(nil) {
					for _, tag := range jsdocTags(doc) {
						if isContractTag(tag) {
							return true
						}
					}
				}
			}
		}
	}
	return false
}
