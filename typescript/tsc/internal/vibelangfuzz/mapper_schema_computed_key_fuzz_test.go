package vibelangfuzz

import (
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperSchemaComputedKeyQuote = "Computed schema field names use native TypeScript runtime object-literal grammar and property-key type checks."

func TestMapperSchemaComputedKeysQuoted(t *testing.T) {
	chapterSays(t, "006-data.md", mapperSchemaComputedKeyQuote)
}

type mapperSchemaKeyCase struct{ key, prefix, expression string }

func mapperSchemaKeyCases(salt byte) []mapperSchemaKeyCase {
	name := fmt.Sprintf("key%d", salt)
	holder := fmt.Sprintf("keys%d", salt)
	call := fmt.Sprintf("keyCall%d", salt)
	value := strconv.Quote(fmt.Sprintf("value%d", salt))
	number := strconv.Itoa(42 + int(salt))
	return []mapperSchemaKeyCase{
		{"number", "", number},
		{"string", "", value},
		{"negative", "", "-" + number},
		{"identifier", "const " + name + " = " + value + ";", name},
		{"call", "function " + call + "(): string { return " + value + " };", call + "()"},
		{"getter", "const " + holder + " = { get value(): string { return " + value + " } };", holder + ".value"},
		{"element", "const " + holder + " = { value: " + value + " };", holder + "[\"value\"]"},
		{"symbol", "", "Symbol.iterator"},
		{"effect-this", "", "this.key"},
		{"parenthesized", "const " + name + " = " + value + ";", "(" + name + ")"},
		{"comment", "const " + name + " = " + value + ";", "/* key */ " + name},
		{"template", "", "`value" + number + "${1}`"},
		{"unicode", "", strconv.Quote("λ" + fmt.Sprint(salt))},
		{"proto", "", "\"__proto__\""},
		{"collision", "const Schema = { value: " + value + " };", "Schema.value"},
		{"optional", "const " + holder + " = { value: " + value + " } as { value: string } | null;", holder + "?.value ?? \"fallback\""},
	}
}

func mapperSchemaKeySource(row mapperSchemaKeyCase, n byte) string {
	modifier := ""
	if n/3%2 != 0 {
		modifier = "readonly "
	}
	field := modifier + "[" + row.expression + "]: number"
	var source string
	switch n % 3 {
	case 1:
		source = row.prefix + " schema Count = { " + field + " }"
	case 2:
		source = row.prefix + " schema Count { readonly item: { " + field + " } }"
	default:
		source = row.prefix + " schema Count { " + field + " }"
	}
	if row.key == "effect-this" {
		return "effect function main(this: { key: string }) { " + source + " }"
	}
	return source
}

func FuzzMapperSchemaComputedKeys(f *testing.F) {
	startShortBudget(f)
	var keys []string
	for _, row := range mapperSchemaKeyCases(0) {
		keys = append(keys, row.key)
		for n := byte(0); n < 6; n++ {
			f.Add([]byte(row.key), n, false)
			f.Add([]byte(row.key), n, true)
		}
	}
	f.Fuzz(func(t *testing.T, data []byte, n byte, lint bool) {
		TestMapperSchemaComputedKeysQuoted(t)
		index, _ := keyedChoice(keys, data)
		row := mapperSchemaKeyCases(n / 6)[index]
		source := mapperSchemaKeySource(row, n)
		got := vibelangmapper.Project(source, vibelangmapper.FileContext{Lint: lint})
		if len(got.Diagnostics) != 0 {
			Gap(t, "FuzzMapperSchemaComputedKeys", row.key, "%s\nrejected runtime key: %+v\n%s", mapperSchemaComputedKeyQuote, got.Diagnostics, source)
		}
		if strings.Count(got.Text, "["+row.expression+"]") != 1 {
			Gap(t, "FuzzMapperSchemaComputedKeys", row.key, "computed key changed or duplicated:\n%s", got.Text)
		}
		native := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/computed-key.ts")}, got.Text, core.ScriptKindTS)
		if len(native.Diagnostics()) != 0 {
			Gap(t, "FuzzMapperSchemaComputedKeys", row.key, "projection is not native TypeScript: %v\n%s", native.Diagnostics(), got.Text)
		}
	})
}
