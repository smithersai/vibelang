package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

// Preserve calls which the old Map<unknown, unknown>/Set<unknown> extraction
// accepted. The assertion changes no evaluation or receiver identity. Restrict
// normal --fix to diagnosed calls; valid specialized bindings keep their types.
func collectionBindingMigrationFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	diagnostics := program.GetSemanticDiagnostics(ctx, file)
	if len(diagnostics) == 0 {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	seen := map[int]bool{}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if !ast.IsCallExpression(node) || !ast.IsPropertyAccessExpression(node.Expression()) {
			return node.ForEachChild(visit)
		}
		receiver := node.Expression().Expression()
		if !ast.IsIdentifier(receiver) || receiver.Flags&ast.NodeFlagsReparsed != 0 {
			return node.ForEachChild(visit)
		}
		diagnosed := false
		for _, d := range diagnostics {
			if d.Code() == 2345 && nodeStart(file, node) <= d.Loc().Pos() && d.Loc().End() <= node.End() {
				diagnosed = true
				break
			}
		}
		if !diagnosed {
			return node.ForEachChild(visit)
		}
		symbol := c.GetSymbolAtLocation(receiver)
		if symbol == nil || symbol.ValueDeclaration() == nil || !ast.IsVariableDeclaration(symbol.ValueDeclaration()) {
			return node.ForEachChild(visit)
		}
		value := hoistedValue(symbol.ValueDeclaration())
		if value == nil || !ast.IsElementAccessExpression(value) {
			return node.ForEachChild(visit)
		}
		call := extractionCall(c, value.Expression())
		if call == nil {
			return node.ForEachChild(visit)
		}
		name, instance := collectionMatcherInstance(c, call.Arguments()[0])
		if instance == nil {
			return node.ForEachChild(visit)
		}
		// Avoid a local type named Map/Set changing what the assertion means.
		local := c.ResolveName(name, receiver, ast.SymbolFlagsType, false)
		if local != c.GlobalSymbol(name, ast.SymbolFlagsType) {
			return node.ForEachChild(visit)
		}
		start, end := nodeStart(file, receiver), receiver.End()
		if start < 0 || end > len(file.Text()) || start >= end || seen[start] {
			return node.ForEachChild(visit)
		}
		key := fmt.Sprintf("collection-binding:%d", start)
		if refused[key] {
			return node.ForEachChild(visit)
		}
		seen[start] = true
		broad := "Map<unknown, unknown>"
		if name == "Set" {
			broad = "Set<unknown>"
		}
		result.fixes = append(result.fixes, fileFix{label: "collection extractor type preservation", key: key,
			edits: []sourceEdit{{start, end, "(" + file.Text()[start:end] + " as " + broad + ")"}}})
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	return result
}
