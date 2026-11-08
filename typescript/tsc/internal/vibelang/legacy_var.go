package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/checker"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() {
	fileChecks = append(fileChecks, checkLegacyVarDeclarations)
}

// VIP-1 denies var everywhere in .vibe source, including plain functions.
// Inspect declaration lists, so properties and strings named var stay valid.
// VIP-2's do early errors own their var: a var the parser already reports as
// a final declaration (EK0201) or in a parameter list (EK0203) gets no EK0107.
// An ambient var directly in a declare global block gets none either: it emits
// nothing, and it is the only declaration TypeScript adds to typeof globalThis.
func checkLegacyVarDeclarations(c *checker.Checker, file *ast.SourceFile) {
	owned := map[int]bool{}
	for _, d := range file.Diagnostics() {
		if d.Source() == diagnosticSource && (d.Code() == parser.DoEndsCode || d.Code() == parser.DoParameterVarCode) {
			owned[d.Pos()] = true
		}
	}
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if node.Kind == ast.KindVariableDeclarationList && node.Flags&ast.NodeFlagsBlockScoped == 0 && node.Flags&ast.NodeFlagsReparsed == 0 && !isGlobalAugmentationVar(node) {
			span := scanner.GetRangeOfTokenAtPosition(file, node.Pos())
			if file.Text()[span.Pos():span.End()] == "var" && !owned[span.Pos()] {
				reportAt(c, file, span, EK0107.With("var is not allowed in a .vibe file. Preserve its scope with explicit block-scoped declarations, or keep legacy JavaScript in a .ts file."))
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
}

// isGlobalAugmentationVar reports whether list is a var statement directly in
// the body of a declare global block. Nested namespaces and module-scope
// declare var are not covered: let or const serves those.
func isGlobalAugmentationVar(list *ast.Node) bool {
	statement := list.Parent
	if statement == nil || statement.Kind != ast.KindVariableStatement || statement.Flags&ast.NodeFlagsAmbient == 0 {
		return false
	}
	block := statement.Parent
	return block != nil && block.Kind == ast.KindModuleBlock && block.Parent != nil && ast.IsGlobalScopeAugmentation(block.Parent)
}
