package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperSchemaNonfieldQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), "a member of a `schema` body that is not a [Field]") {
		t.Fatal("schema non-field rule changed")
	}
}

func FuzzMapperSchemaNonfields(f *testing.F) {
	startShortBudget(f)
	parameters := []struct{ key, text string }{{"empty", ""}, {"parameter", "value: number"}}
	results := []struct{ key, text string }{{"void", "void"}, {"number", "number"}, {"string", "string"}, {"object", "{ value: number }"}}
	for n := uint8(0); n < 8; n++ {
		f.Add(parameters[n%2].key+"/"+results[n/2%4].key, n)
	}
	f.Fuzz(func(t *testing.T, key string, n uint8) {
		parameter, result := parameters[n%2], results[n/2%4]
		if left, right, ok := strings.Cut(key, "/"); ok {
			for _, row := range parameters {
				if row.key == left {
					parameter = row
				}
			}
			for _, row := range results {
				if row.key == right {
					result = row
				}
			}
		}
		key = parameter.key + "/" + result.key
		parameterText, resultType := parameter.text, result.text
		source := fmt.Sprintf("schema Event { run(%s): %s; parts: Partial<{ a: string }> }", parameterText, resultType)
		p := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		if len(p.Diagnostics) != 2 {
			Gap(t, "FuzzMapperSchemaNonfields", key, "lost recovery diagnostics: %v\n%s", p.Diagnostics, p.Text)
		}
		file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/schema.ts")}, p.Text, core.ScriptKindTS)
		if len(file.Diagnostics()) != 0 {
			Gap(t, "FuzzMapperSchemaNonfields", key, "invalid recovery syntax: %v", file.Diagnostics())
		}
		found := false
		var visit func(*ast.Node) bool
		visit = func(node *ast.Node) bool {
			if ast.IsPropertyAssignment(node) && ast.IsIdentifier(node.Name()) && node.Name().Text() == "run" {
				value := node.Initializer()
				if !ast.IsPropertyAccessExpression(value) || value.Name().Text() != "Never" {
					Gap(t, "FuzzMapperSchemaNonfields", key, "non-field must not become an accepted unknown codec:\n%s", p.Text)
				}
				found = true
			}
			return node.ForEachChild(visit)
		}
		file.AsNode().ForEachChild(visit)
		if !found {
			Gap(t, "FuzzMapperSchemaNonfields", key, "missing method recovery property")
		}
	})
}
