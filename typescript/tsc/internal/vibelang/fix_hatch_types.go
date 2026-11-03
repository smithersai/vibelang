package vibelang

import (
	"context"
	"slices"
	"strconv"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/astnav"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/ls/lsconv"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

// VIP-6 changes typeof sync/callback from the compatibility helper's type
// to the native Effect export. When a native call/assignment error traces
// back to one of these annotations, preserve its old API with an explicit
// runtime import type. Only types change: evaluation and function identity
// stay untouched. Queries in dependencies remain read-only (VIP-34).
const legacyHatchTypeAction = "Keep the legacy runtime type of this annotation"

var legacyHatchTypeCodes = []int32{2322, 2344, 2345, 2554, 2558, 2635, 2769}

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: legacyHatchTypeCodes, GetCodeActions: legacyHatchTypeActions})
}

func legacyHatchTypeMigrationFixes(ctx context.Context, program *compiler.Program, refused map[string]bool) map[*ast.SourceFile]proposal {
	return legacyHatchTypePlans(ctx, program, refused, nil)
}

func legacyHatchTypePlans(ctx context.Context, program *compiler.Program, refused map[string]bool, only *ls.CodeFixContext) map[*ast.SourceFile]proposal {
	own := map[*ast.SourceFile]bool{}
	candidate := false
	for _, file := range fixableFiles(program) {
		own[file] = true
		if !file.HasIdentifier("sync") && !file.HasIdentifier("callback") {
			continue
		}
		var visit func(*ast.Node) bool
		visit = func(n *ast.Node) bool {
			if n.Kind == ast.KindTypeQuery {
				name := n.AsTypeQueryNode().ExprName
				if name != nil && ast.IsIdentifier(name) && hatchNames[name.Text()] {
					candidate = true
					return true
				}
			}
			return n.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
	}
	plans := map[*ast.SourceFile]proposal{}
	if !candidate {
		return plans
	}
	ds := program.GetSemanticDiagnostics(ctx, nil)
	c, done := program.GetTypeChecker(ctx)
	defer done()
	queries := map[*ast.Node]bool{}
	for _, d := range ds {
		if d.Source() != "" || d.File() == nil {
			continue
		}
		if !slices.Contains(legacyHatchTypeCodes, d.Code()) {
			continue
		}
		if only != nil && (d.File() != only.SourceFile || d.Pos() > only.Span.End() || d.End() < only.Span.Pos()) {
			continue
		}
		var returned *ast.Node
		for n := astnav.GetTokenAtPosition(d.File(), d.Pos()); n != nil; n = n.Parent {
			if (d.Code() == 2344 || d.Code() == 2558 || d.Code() == 2635) && implicitHatchTypeQuery(c, n) {
				queries[n] = true
			}
			if ast.IsCallExpression(n) {
				sig := c.GetResolvedSignature(n)
				if sig == nil || sig.Declaration() == nil {
					continue
				}
				for _, q := range hatchTypeOrigins(c, hatchTypeValueSymbol(c, n.Expression()), map[*ast.Symbol]bool{}) {
					name := q.AsTypeQueryNode().ExprName
					for _, native := range c.GetSignaturesOfType(c.GetTypeAtLocation(name), checker.SignatureKindCall) {
						if native.Declaration() == sig.Declaration() {
							queries[q] = true
						}
					}
				}
			}
			if d.Code() == 2322 && ast.IsReturnStatement(n) {
				returned = n.Expression()
			}
			if d.Code() == 2322 && ast.IsFunctionLike(n) {
				if ast.IsArrowFunction(n) && n.Body() != nil && !ast.IsBlock(n.Body()) {
					returned = n.Body()
				}
				if returned != nil && n.Type() != nil {
					for _, q := range hatchTypeQueries(c, n.Type(), map[*ast.Symbol]bool{}) {
						name := q.AsTypeQueryNode().ExprName.Text()
						if isRuntimeSymbol(c, hatchTypeValueSymbol(c, returned), name) {
							queries[q] = true
						}
					}
				}
				returned = nil // a return belongs only to its nearest function
			}
			if d.Code() == 2322 && ast.IsVariableDeclaration(n) && n.Type() != nil && n.Initializer() != nil {
				for _, q := range hatchTypeOrigins(c, c.GetSymbolAtLocation(n.Name()), map[*ast.Symbol]bool{}) {
					name := q.AsTypeQueryNode().ExprName.Text()
					if isRuntimeSymbol(c, hatchTypeValueSymbol(c, n.Initializer()), name) {
						queries[q] = true
					}
				}
			}
		}
	}
	for q := range queries {
		file := ast.GetSourceFileOfNode(q)
		if !own[file] {
			continue
		}
		name := q.AsTypeQueryNode().ExprName
		runtime := runtimeModuleSymbol(c, preludeStateOf(c), file)
		if runtime == nil || c.TryGetMemberInModuleExports(name.Text(), runtime) == nil {
			continue
		}
		key := "legacyHatchType:" + file.FileName().AsString() + ":" + strconv.Itoa(nodeStart(file, name))
		if refused[key] {
			continue
		}
		p := plans[file]
		p.file = file
		p.fixes = append(p.fixes, fileFix{
			edits: []sourceEdit{{nodeStart(file, name), name.End(), "import(\"vibelang-runtime\")." + name.Text()}},
			key:   key, label: "legacy hatch types",
		})
		plans[file] = p
	}
	for file, p := range plans {
		slices.SortStableFunc(p.fixes, func(a, b fileFix) int { return firstEdit(a.edits) - firstEdit(b.edits) })
		plans[file] = p
	}
	return plans
}

// Follow annotations and type/value aliases, including an imported public
// annotation. The caller enforces ownership on the query's actual file.
func hatchTypeOrigins(c *checker.Checker, symbol *ast.Symbol, seen map[*ast.Symbol]bool) []*ast.Node {
	if symbol == nil || seen[symbol] {
		return nil
	}
	seen[symbol] = true
	if symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		return hatchTypeOrigins(c, c.GetAliasedSymbol(symbol), seen)
	}
	var queries []*ast.Node
	visit := func(n *ast.Node) {
		queries = append(queries, hatchTypeQueries(c, n, seen)...)
	}
	for _, d := range symbol.Declarations() {
		// An implicit VibeLang global query cannot originate in an ordinary
		// library declaration. Avoid traversing Effect's entire type graph.
		if !isVibeLangFile(ast.GetSourceFileOfNode(d)) {
			continue
		}
		switch {
		case ast.IsInterfaceDeclaration(d):
			for _, member := range d.Members() {
				if member.Kind == ast.KindPropertySignature && member.Type() != nil {
					visit(member.Type())
				}
			}
		case ast.IsVariableDeclaration(d), d.Kind == ast.KindParameter, d.Kind == ast.KindPropertySignature, ast.IsPropertyDeclaration(d), ast.IsTypeAliasDeclaration(d), ast.IsFunctionLike(d):
			if d.Type() != nil {
				visit(d.Type())
			}
			if ast.IsVariableDeclaration(d) && d.Type() == nil && d.Initializer() != nil {
				initializer := ast.SkipParentheses(d.Initializer())
				if ast.IsFunctionLike(initializer) && initializer.Type() != nil {
					visit(initializer.Type())
				} else {
					queries = append(queries, hatchTypeOrigins(c, hatchTypeValueSymbol(c, initializer), seen)...)
				}
			}
		}
	}
	return queries
}

// A factory's return annotation may hold the query rather than the variable
// that receives its result. Keep the same owned-type/alias traversal in both.
func hatchTypeQueries(c *checker.Checker, node *ast.Node, seen map[*ast.Symbol]bool) []*ast.Node {
	var queries []*ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if n.Kind == ast.KindTypeQuery {
			if implicitHatchTypeQuery(c, n) {
				queries = append(queries, n)
			}
			return false
		}
		if ast.IsTypeReferenceNode(n) {
			queries = append(queries, hatchTypeOrigins(c, c.GetSymbolAtLocation(n.AsTypeReferenceNode().TypeName), seen)...)
		}
		return n.ForEachChild(visit)
	}
	visit(node)
	return queries
}

func hatchTypeValueSymbol(c *checker.Checker, n *ast.Node) *ast.Symbol {
	for n != nil && ast.IsParenthesizedExpression(n) {
		n = n.Expression()
	}
	if n == nil {
		return nil
	}
	if ast.IsCallExpression(n) {
		return hatchTypeValueSymbol(c, n.Expression())
	}
	if ast.IsPropertyAccessExpression(n) {
		return c.GetSymbolAtLocation(n.Name())
	}
	if ast.IsElementAccessExpression(n) {
		key := n.AsElementAccessExpression().ArgumentExpression
		if key == nil {
			return nil
		}
		if ast.IsStringLiteral(key) || key.Kind == ast.KindNoSubstitutionTemplateLiteral {
			return c.GetPropertyOfType(c.GetTypeAtLocation(n.Expression()), key.Text())
		}
	}
	return c.GetSymbolAtLocation(n)
}

func implicitHatchTypeQuery(c *checker.Checker, n *ast.Node) bool {
	if n == nil || n.Kind != ast.KindTypeQuery {
		return false
	}
	name := n.AsTypeQueryNode().ExprName
	return name != nil && ast.IsIdentifier(name) && hatchNames[name.Text()] && !shadowedByValue(name, name.Text()) &&
		isEffectGlobal(c, preludeStateOf(c), ast.GetSourceFileOfNode(name), name)
}

func legacyHatchTypeActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	plans := legacyHatchTypePlans(ctx, fix.Program, nil, fix)
	files := make([]*ast.SourceFile, 0, len(plans))
	for file := range plans {
		files = append(files, file)
	}
	slices.SortFunc(files, func(a, b *ast.SourceFile) int { return a.FileName().Compare(b.FileName()) })
	action := &ls.CodeAction{Description: legacyHatchTypeAction}
	for _, file := range files {
		var changes []*lsproto.TextEdit
		for _, f := range plans[file].fixes {
			for _, e := range f.edits {
				changes = append(changes, &lsproto.TextEdit{Range: fix.LS.ToLSPRange(file, core.NewTextRange(e.start, e.end)), NewText: e.text})
			}
		}
		if file == fix.SourceFile {
			action.Changes = append(action.Changes, changes...)
		} else {
			action.AdditionalChanges = append(action.AdditionalChanges, ls.FileTextChanges{URI: lsconv.FileNameToDocumentURI(file.FileName()), Changes: changes})
		}
	}
	if len(action.Changes) == 0 && len(action.AdditionalChanges) == 0 {
		return nil, nil
	}
	return []*ls.CodeAction{action}, nil
}
