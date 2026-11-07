package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

func init() {
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{Source: diagnosticSource, ErrorCodes: []int32{EK4402.Code}, GetCodeActions: platformHostBindingFix})
}

// Only global receiver/property reads cross this boundary. Assertions,
// calls and local aliases would need their original lexical environment.
func platformHostBindingGlobal(c *checker.Checker, n *ast.Node) bool {
	if n == nil {
		return false
	}
	if ast.IsIdentifier(n) {
		symbol := c.GetSymbolAtLocation(n)
		if symbol == nil {
			return false
		}
		if symbol.Name() == "globalThis" && len(symbol.Declarations()) == 0 {
			return true
		}
		return (symbol.Name() == "URL" || symbol.Name() == "AbortSignal") && platformHostGlobal(c, symbol)
	}
	if ast.IsPropertyAccessExpression(n) {
		return n.QuestionDotToken() == nil && platformHostBindingGlobal(c, n.Expression())
	}
	if ast.IsElementAccessExpression(n) {
		return n.QuestionDotToken() == nil && ast.IsStringLiteral(n.AsElementAccessExpression().ArgumentExpression) && platformHostBindingGlobal(c, n.Expression())
	}
	return false
}

func platformHostBindingNames(n *ast.Node, names *[]string, seen map[string]bool) bool {
	if n == nil {
		return false
	}
	if ast.IsIdentifier(n) {
		if n.Text() == "" || seen[n.Text()] {
			return false
		}
		seen[n.Text()] = true
		*names = append(*names, n.Text())
		return true
	}
	if !ast.IsObjectBindingPattern(n) {
		return false
	}
	for _, element := range n.Elements() {
		if !ast.IsBindingElement(element) || element.Initializer() != nil {
			return false
		}
		if key := element.PropertyName(); key != nil && ast.IsComputedPropertyName(key) && !ast.IsStringLiteral(key.Expression()) {
			return false
		}
		if !platformHostBindingNames(element.Name(), names, seen) {
			return false
		}
	}
	return true
}

// A leading prefix runs before every other source body statement. An eager
// native import preserves that phase only when no other runtime dependency
// can interleave its initialization. Keep the ordinary declaration/type
// checks as the final fix gate rather than inventing a callable contract.
func platformHostBindingRewrite(c *checker.Checker, file *ast.SourceFile, start, end int) *formRewrite {
	// Import aliases preserve ESM live bindings. CommonJS re-exports instead
	// turn the original data properties into accessors, changing the public
	// object and partial-initialization observations.
	switch c.Program().GetEmitModuleFormatOfFile(file) {
	case core.ModuleKindES2015, core.ModuleKindES2020, core.ModuleKindES2022, core.ModuleKindESNext:
	default:
		return nil
	}
	for _, statement := range file.Statements.Nodes {
		if ast.IsImportEqualsDeclaration(statement) {
			return nil
		}
		if ast.IsImportDeclaration(statement) {
			if statement.ImportClause() == nil || !statement.ImportClause().IsTypeOnly() {
				return nil
			}
		}
		if ast.IsExportDeclaration(statement) && statement.ModuleSpecifier() != nil && !statement.AsExportDeclaration().IsTypeOnly {
			return nil
		}
	}
	var statements []*ast.Node
	var names []string
	seen := map[string]bool{}
	for _, statement := range file.Statements.Nodes {
		if !ast.IsVariableStatement(statement) || ast.HasSyntacticModifier(statement, ast.ModifierFlagsExport|ast.ModifierFlagsAmbient) {
			break
		}
		list := statement.AsVariableStatement().DeclarationList
		declarations := list.AsVariableDeclarationList().Declarations.Nodes
		if list.Flags&ast.NodeFlagsConst == 0 || len(declarations) != 1 {
			break
		}
		declaration := declarations[0]
		if declaration.Type() != nil || !platformHostBindingGlobal(c, declaration.Initializer()) {
			break
		}
		origin := platformHostOrigin(c, declaration.Initializer(), map[*ast.Symbol]bool{}, map[*ast.Symbol]platformHostValue{}, platformHostWrites(c, file), map[*ast.Node]platformHostValue{})
		if origin.root != "URL" && origin.root != "AbortSignal" {
			break
		}
		// Leading and inline metadata would otherwise attach to a new declaration
		// or cross the native checking boundary. Leave it for an explicit repair.
		text := file.Text()[statement.Pos():statement.End()]
		for _, marker := range []string{"/**", "///", "@", "eslint-", "oxlint-", "biome-", "istanbul "} {
			if strings.Contains(text, marker) {
				return nil
			}
		}
		if !platformHostBindingNames(declaration.Name(), &names, seen) {
			return nil
		}
		statements = append(statements, statement)
	}
	if len(statements) == 0 || len(names) == 0 {
		return nil
	}
	first, last := statements[0], statements[len(statements)-1]
	begin := nodeStart(file, first)
	if start < begin || end > last.End() {
		return nil
	}
	local := (&freshNames{file: file}).freshName("$platformBindings")
	var body strings.Builder
	for i, statement := range statements {
		if i > 0 {
			body.WriteString(file.Text()[statements[i-1].End():nodeStart(file, statement)])
		}
		body.WriteString("export ")
		body.WriteString(nodeText(file, statement))
	}
	replacement := "module " + local + " {\n" + body.String() + "\n}\nimport { " + strings.Join(names, ", ") + " } from " + local + "\nimport " + local + ";"
	return &formRewrite{description: "an eager native module with the same host bindings", edits: []sourceEdit{{begin, last.End(), replacement}}}
}

func platformHostBindingFix(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	c, done := fix.Program.GetTypeCheckerForFile(ctx, fix.SourceFile)
	defer done()
	found := false
	for _, d := range c.GetDiagnostics(ctx, fix.SourceFile) {
		if d.Source() == diagnosticSource && d.Code() == EK4402.Code && d.Pos() == fix.Span.Pos() && d.End() == fix.Span.End() {
			found = true
			break
		}
	}
	if !found {
		return nil, nil
	}
	rewrite := preserveRewriteComments(fix.SourceFile, platformHostBindingRewrite(c, fix.SourceFile, fix.Span.Pos(), fix.Span.End()))
	if !rewrite.fixable() {
		return nil, nil
	}
	edit := rewrite.edits[0]
	return []*ls.CodeAction{{Description: "Preserve host bindings in a native module", Changes: replaceRange(fix, edit.start, edit.end, edit.text)}}, nil
}
