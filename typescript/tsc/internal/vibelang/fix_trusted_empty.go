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
			wrapped := "try Effect.orDie(Effect.try({ try: () => " + expressionText(file, call) + ", catch: (error) => error }))"
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
