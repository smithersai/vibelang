package vibelang

import (
	"context"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

// VIP-24 denies implicit graph composition. Freeze the already-resolved
// legacy graph into explicit Layer calls. The array evaluates every source
// argument once in source order before composition.
func relicWireFixes(ctx context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !isVibeLangFile(file) {
		return result
	}
	c, done := program.GetTypeCheckerForFile(ctx, file)
	defer done()
	names := &freshNames{file: file}
	key := "wire-compositions:" + file.FileName().AsString()
	if refused[key] {
		return result
	}
	provideMerge := names.freshName("$wireProvideMerge")
	var edits []sourceEdit
	needsImport := false
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if isWireCall(c, node) {
			if !relicWirePureCallee(c, node.Expression()) || node.QuestionDotToken() != nil {
				return node.ForEachChild(visit)
			}
			for _, arg := range node.Arguments() {
				if ast.IsSpreadElement(arg) {
					return node.ForEachChild(visit)
				}
			}
			g := graphOfWire(c, node)
			if len(g.arguments) == 0 || g.cycle != nil || len(g.duplicates) != 0 {
				return node.ForEachChild(visit)
			}
			for _, a := range g.arguments {
				if a.opaque || a.spread {
					return node.ForEachChild(visit)
				}
			}
			// Do not add an import merely to get around a shadowed module. Its
			// declaration spelling needs a separate public-ABI proof.
			if !relicWireLayerVisible(c, node) || node.TypeArguments() != nil {
				return node.ForEachChild(visit)
			}
			values := names.freshName("$wireLayers")
			source := file.Text()
			open := scanner.SkipTrivia(source, node.Expression().End())
			if open >= node.End() || source[open] != '(' {
				return false
			}
			args := source[open+1 : node.End()-1]
			value := func(i int) string { return values + "[" + strconv.Itoa(i) + "]" }
			body := value(g.order[len(g.order)-1])
			for i := len(g.order) - 2; i >= 0; i-- {
				body = provideMerge + "(" + value(g.order[i]) + ", " + body + ")"
			}
			// IIFE parameters infer the const tuple from the argument. Keep
			// the original arguments outside the callback so try, await,
			// yield, this and arguments retain their enclosing context.
			text := "((" + values + ") => " + body + ")(" + source[node.Expression().End():open] + "[" + args + "] as const)"
			if !editsPreserveComments(source, []sourceEdit{{nodeStart(file, node), node.End(), text}}) {
				return node.ForEachChild(visit)
			}
			edits = append(edits, sourceEdit{nodeStart(file, node), node.End(), text})
			needsImport = needsImport || len(g.order) > 1
			return false
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if len(edits) == 0 {
		return result
	}
	if needsImport {
		at, ok := relicMigrationImportPosition(file)
		if !ok {
			return result
		}
		text := "import { provideMerge as " + provideMerge + " } from \"effect/Layer\";\n"
		if at > 0 && file.Text()[at-1] != '\n' && !strings.HasSuffix(file.Text()[:at], "\ufeff") {
			text = "\n" + text
		}
		edits = append(edits, sourceEdit{at, at, text})
	}
	result.fixes = append(result.fixes, fileFix{label: "wire compositions", key: key, edits: edits})
	return result
}

func relicWireLayerVisible(c *checker.Checker, node *ast.Node) bool {
	symbol := c.ResolveName("Layer", node, ast.SymbolFlagsValue, false)
	if symbol != nil && symbol.Flags()&ast.SymbolFlagsAlias != 0 {
		symbol = c.GetAliasedSymbol(symbol)
	}
	if symbol == nil {
		return false
	}
	for _, decl := range symbol.Declarations() {
		if ast.IsSourceFile(decl) && effectModuleOfFile(decl.AsSourceFile()) == "Layer" {
			return true
		}
	}
	return false
}

func relicWirePureCallee(c *checker.Checker, node *ast.Node) bool {
	node = ast.SkipParentheses(node)
	if ast.IsIdentifier(node) {
		return true
	}
	if !ast.IsPropertyAccessExpression(node) {
		return false
	}
	receiver := ast.SkipParentheses(node.Expression())
	if !ast.IsIdentifier(receiver) {
		return false
	}
	symbol := c.GetSymbolAtLocation(receiver)
	if symbol == nil || symbol.Flags()&ast.SymbolFlagsAlias == 0 {
		return false
	}
	for _, decl := range symbol.Declarations() {
		if decl.Kind == ast.KindNamespaceImport {
			return true
		}
	}
	return false
}
