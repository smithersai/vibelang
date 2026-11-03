package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
	"github.com/microsoft/TypeScript/tsc/internal/lsp/lsproto"
)

func init() {
	nativeFixCodes = append(nativeFixCodes, 2349)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 2349)
	tsFormFixCodes = append(tsFormFixCodes, 2349)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{2349}, GetCodeActions: priorityYieldActions})
}

// Only these implicit prelude names used to be factories. An imported native
// Effect value, a local name and other Effect calls retain their own meaning.
func implicitNativeFactoryName(c *checker.Checker, file *ast.SourceFile, expression *ast.Node) string {
	callee := ast.SkipParentheses(expression)
	if !isVibeLangFile(file) || !ast.IsIdentifier(callee) || (callee.Text() != "yieldNow" && callee.Text() != "interrupt") || shadowed(callee, callee.Text()) || implicitEffectModuleDisabled(c, file, callee.Text()) {
		return ""
	}
	symbol := resolvedAlias(c, c.GetSymbolAtLocation(callee))
	native := resolvedAlias(c, effectExportSymbol(c, preludeStateOf(c), file, callee.Text()))
	if symbol == nil || symbol != native {
		return ""
	}
	return callee.Text()
}

// The old prelude functions built cold Effects. Replace the callee alone with
// a plain factory: keep its argument list, optional call and existing try,
// evaluate the priority once, and support ordinary JavaScript factory scopes.
func priorityYieldActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.Program == nil || fix.SourceFile == nil {
		return nil, nil
	}
	file := fix.SourceFile
	var call *ast.Node
	var visit func(*ast.Node) bool
	visit = func(n *ast.Node) bool {
		if nodeStart(file, n) > fix.Span.Pos() || n.End() < fix.Span.End() {
			return false
		}
		if ast.IsCallExpression(n) {
			call = n
		}
		return n.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if call == nil || call.TypeArguments() != nil {
		return nil, nil
	}
	c, done := fix.Program.GetTypeCheckerForFile(ctx, file)
	defer done()
	name := implicitNativeFactoryName(c, file, call.Expression())
	if name == "" || len(call.Arguments()) > 1 || name == "interrupt" && len(call.Arguments()) != 0 {
		return nil, nil
	}
	// An existing try over a zero-argument call can keep the compact native
	// value rewrite. The generic Effect-call action handles it.
	if len(call.Arguments()) == 0 && underTry(call) {
		return nil, nil
	}
	text := file.Text()
	start, end := nodeStart(file, call.Expression()), call.Expression().End()
	comments := strings.Join(rewriteComments.FindAllString(text[start:end], -1), "\n")
	if comments != "" {
		comments += "\n"
	}
	ordinary := retiredAwaitFresh(file, "$nativeInterrupt")
	imported := "interrupt as " + ordinary
	replacement := "(" + comments + "() => " + ordinary + ")"
	if name == "yieldNow" {
		ordinary = retiredAwaitFresh(file, "$nativeYieldNow")
		priority := retiredAwaitFresh(file, "$nativeYieldNowWith")
		value := retiredAwaitFresh(file, "$yieldPriority")
		imported = "yieldNow as " + ordinary + ", yieldNowWith as " + priority
		replacement = "(" + comments + "(" + value + "?: number) => " + value + " === undefined ? " + ordinary + " : " + priority + "(" + value + "))"
	}
	statementValue := call
	for statementValue.Parent != nil && ast.IsParenthesizedExpression(statementValue.Parent) {
		statementValue = statementValue.Parent
	}
	// A discarded Effect statement was already invalid (EK4801). Retain the
	// existing migration's explicit-run repair there; held and returned
	// factory results remain data.
	if !underTry(call) && statementValue.Parent != nil && ast.IsExpressionStatement(statementValue.Parent) && inEffectCode(call) {
		replacement = "try " + replacement
	} else if !underTry(call) && continuesStatement(text, call, start) {
		replacement = ";" + replacement
	}
	imports := "import { " + imported + " } from \"effect/Effect\"\n"
	at := retiredAwaitImportPosition(file)
	edits := []sourceEdit{{at, at, imports}, {start, end, replacement}}
	if !editsPreserveComments(text, edits) {
		return nil, nil
	}
	var changes []*lsproto.TextEdit
	for _, edit := range edits {
		changes = append(changes, replaceRange(fix, edit.start, edit.end, edit.text)...)
	}
	return []*ls.CodeAction{{Description: "Preserve the native Effect factory's result and priority", Changes: changes}}, nil
}
