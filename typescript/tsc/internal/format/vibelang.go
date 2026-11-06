package format

import (
	"context"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangfmt"
)

// formatVibeLangDocument formats the same reversible TypeScript projection
// as dprint. The parser's synthesized checker tree has overlapping token
// ranges (for example, match arms), which the TypeScript formatter cannot walk.
func formatVibeLangDocument(ctx context.Context, file *ast.SourceFile) []core.TextChange {
	source := file.Text()
	result, err := vibelangfmt.Format(file.FileName().AsString(), source, func(text string) (string, error) {
		projection := parser.ParseSourceFile(ast.SourceFileParseOptions{
			// The projection is already TypeScript. A native extension would
			// let its retained directive select VibeLang again.
			FileName: "/vibelang-format.projection", PathKey: "/vibelang-format.projection",
		}, text, core.ScriptKindTS)
		return core.ApplyBulkEdits(text, FormatSpan(ctx, core.NewTextRange(0, projection.End()), projection, FormatRequestKindFormatDocument)), nil
	})
	if err != nil || result == source {
		return nil
	}
	return []core.TextChange{{TextRange: core.NewTextRange(0, len(source)), NewText: result}}
}
