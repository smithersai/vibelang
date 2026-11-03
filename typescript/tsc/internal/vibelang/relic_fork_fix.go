package vibelang

import (
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

// VIP-2 admits only explicit Effect construction. The old bare fork body
// already parses as the same cold program arrow; spelling effect makes that
// construction explicit without changing its body, captures or completion.
// This migration precedes rejection so repositories can upgrade separately.
func relicForkBlockFixes(file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !file.FileName().IsVibeLangSource() || !strings.Contains(file.Text(), "fork") {
		return result
	}
	_, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: file.FileName(), PathKey: file.PathKey()}, file.Text())
	for _, form := range forms {
		if form.Kind != parser.VibeSyntaxForkBlock {
			continue
		}
		at := form.Open.Pos()
		key := fmt.Sprintf("fork-block:%d", at)
		if !refused[key] {
			insertion := "effect "
			if form.Word.End() == at {
				insertion = " effect "
			}
			result.fixes = append(result.fixes, fileFix{label: "fork blocks", key: key, edits: []sourceEdit{{at, at, insertion}}})
		}
	}
	return result
}
