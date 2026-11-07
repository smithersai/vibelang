package vibelang

import (
	"context"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/ls"
)

const plainInferReturnTitle = "Remove the legacy plain inference return annotation"

func init() {
	nativeFixCodes = append(nativeFixCodes, 1338)
	tsFormFixCodes = append(tsFormFixCodes, 1338)
	vipMigrationFixCodes = append(vipMigrationFixCodes, 1338)
	ls.RegisterCodeFixProvider(&ls.CodeFixProvider{ErrorCodes: []int32{1338}, GetCodeActions: plainInferReturnActions})
}

// Wrapped callbacks are TypeScript code. The retired whole-return marker
// has no native meaning there; removing it retains ordinary return inference.
func plainInferReturnActions(ctx context.Context, fix *ls.CodeFixContext) ([]*ls.CodeAction, error) {
	if fix.SourceFile == nil || !isVibeLangFile(fix.SourceFile) {
		return nil, nil
	}
	file := fix.SourceFile
	var annotation *ast.Node
	var visit func(*ast.Node) bool
	visit = func(node *ast.Node) bool {
		if nodeStart(file, node) > fix.Span.Pos() || node.End() < fix.Span.End() {
			return false
		}
		if isInferredReturnAnnotation(node) {
			fn := node.Parent
			if fn != nil && ast.IsFunctionLikeDeclaration(fn) && fn.Type() == node && fn.Body() != nil &&
				ast.GetFunctionFlags(fn)&(ast.FunctionFlagsAsync|ast.FunctionFlagsGenerator) == 0 &&
				fn.Flags&ast.NodeFlagsVibeLangEffect == 0 && inHatch(fn) {
				annotation = node
				return true
			}
		}
		return node.ForEachChild(visit)
	}
	file.AsNode().ForEachChild(visit)
	if annotation == nil {
		return nil, nil
	}
	text := file.Text()
	skipSpace := func(at int) int {
		for at > 0 && strings.ContainsRune(" \t\r\n", rune(text[at-1])) {
			at--
		}
		return at
	}
	start := skipSpace(nodeStart(file, annotation))
	if start == 0 || text[start-1] != ':' {
		return nil, nil
	}
	start = skipSpace(start - 1)
	if start == 0 || text[start-1] != ')' || hasComment(text[start:annotation.End()]) {
		return nil, nil
	}
	return []*ls.CodeAction{{Description: plainInferReturnTitle, Changes: replaceRange(fix, start, annotation.End(), "")}}, nil
}
