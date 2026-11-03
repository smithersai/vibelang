package vibelang

import (
	"context"
	"fmt"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
)

func init() { sourceFileMigrations = append(sourceFileMigrations, schemaExactOptionalMigrationFixes) }

// This explicit compatibility upgrade keeps the previous Schema.optional
// decoder when exactOptionalPropertyTypes changes the sugar to optionalKey.
// Ordinary --fix must keep newly written exact optional declarations exact.
func schemaExactOptionalMigrationFixes(_ context.Context, program *compiler.Program, file *ast.SourceFile, refused map[string]bool) proposal {
	result := proposal{file: file}
	if !program.Options().ExactOptionalPropertyTypes.IsTrue() {
		return result
	}
	seen := map[int]bool{}
	for _, ref := range file.VibeLangSchemaOptionals {
		if ref.AllowsUndefined || ast.GetSourceFileOfNode(ref.Expression) != file {
			continue
		}
		start, end := scanner.SkipTrivia(file.Text(), ref.TypeRange.Pos()), ref.TypeRange.End()
		key := fmt.Sprintf("schema-exact-optional:%d:%d", start, end)
		if seen[start] || refused[key] {
			continue
		}
		seen[start] = true
		edits := []sourceEdit{{end, end, " | undefined"}}
		if ref.Parenthesize {
			edits = []sourceEdit{{start, start, "("}, {end, end, " | undefined)"}}
		}
		result.fixes = append(result.fixes, fileFix{label: "optional schema compatibility", key: key, edits: edits})
	}
	return result
}
