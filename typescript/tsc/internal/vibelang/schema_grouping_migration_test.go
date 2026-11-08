package vibelang

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

func TestLegacyGroupedSchemaValue(t *testing.T) {
	for _, test := range []struct{ typ, want string }{
		{"(\"a\" | \"b\") | null", "S.Union([S.Literals([\"a\", \"b\"]), S.Null])"},
		{"(\"a\") | \"b\"", "S.Union([S.Literal(\"a\"), S.Literal(\"b\")])"},
		{"(\"a\" | (\"b\" | \"c\")) | null", "S.Union([S.Union([S.Literal(\"a\"), S.Literals([\"b\", \"c\"])]), S.Null])"},
		{"readonly [(\"a\" | \"b\") | null]", "S.Tuple([S.Union([S.Literals([\"a\", \"b\"]), S.Null]),])"},
		{"{ readonly value: (\"a\" | \"b\") | null }", "S.Struct({\n    value: S.Union([S.Literals([\"a\", \"b\"]), S.Null]),\n})"},
	} {
		t.Run(test.typ, func(t *testing.T) {
			raw := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/type.ts", PathKey: "/type.ts"}, "type T = "+test.typ, core.ScriptKindTS)
			node := raw.Statements.Nodes[0].AsTypeAliasDeclaration().Type
			got := legacyGroupedSchemaValue(raw, node, "S")
			if got != test.want {
				t.Fatalf("got%s\nwant%s", got, test.want)
			}
		})
	}
}
