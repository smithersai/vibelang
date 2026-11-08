package vibelang

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
)

type sourceFileMigration func(context.Context, *compiler.Program, *ast.SourceFile, map[string]bool) proposal

var sourceFileMigrations []sourceFileMigration

// A complete codec expansion must preserve every active source upgrade before
// replacing the declaration. Otherwise a later migration loses its source.
type sourceCodecMigration func(*ast.SourceFile, *ast.Node, string) (*ast.Node, map[string]string)

var sourceCodecMigrations []sourceCodecMigration
var legacySchemaTypeMigrations []func(string) string

func preserveSourceSchemaCodec(file *ast.SourceFile, value *ast.Node, alias string) (*ast.Node, map[string]string) {
	substitutions := map[string]string{}
	for _, migrate := range sourceCodecMigrations {
		var next map[string]string
		value, next = migrate(file, value, alias)
		for name, text := range next {
			substitutions[name] = text
		}
	}
	return value, substitutions
}

func preserveLegacySchemaType(typ string) string {
	for _, migrate := range legacySchemaTypeMigrations {
		typ = migrate(typ)
	}
	return typ
}
