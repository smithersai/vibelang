package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const dataVariantIdentifierQuote = "Variant names are TypeScript `IdentifierName`s, including reserved words such as `default`."
const dataVariantMalformedQuote = "a malformed variant or a payload member that is not a [Field](900-appendices.md#field)"

func dataVariantNameQuotes(tb testing.TB) {
	tb.Helper()
	chapter := SpecText("006-data.md")
	for _, quote := range []string{dataVariantIdentifierQuote, dataVariantMalformedQuote} {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("data variant rule changed: %q", quote)
		}
	}
}
func TestDataVariantNamesQuoted(t *testing.T) { dataVariantNameQuotes(t) }

var dataVariantNameKeys = []string{"identifier", "escaped", "reserved", "single-quoted", "double-quoted", "number", "bigint", "template"}

func FuzzDataVariantNames(f *testing.F) {
	startShortBudget(f)
	dataVariantNameQuotes(f)
	for _, key := range dataVariantNameKeys {
		for _, flags := range []uint8{0, 3, 4, 9, 19} {
			f.Add(key, uint16(7), flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, n uint16, flags uint8) {
		selected := -1
		for i, k := range dataVariantNameKeys {
			if key == k {
				selected = i
				break
			}
		}
		if selected < 0 {
			selected = 0
			if len(key) > 0 {
				selected = int(key[0]) % len(dataVariantNameKeys)
			}
		}
		key = dataVariantNameKeys[selected]
		name := fmt.Sprintf("Value%d", n)
		invalid := false
		switch key {
		case "escaped":
			name = fmt.Sprintf("V\\u0061lue%d", n)
		case "reserved":
			name = []string{"default", "true", "null", "class", "await", "yield", "case"}[int(n)%7]
		case "single-quoted":
			name = "'" + name + "'"
			invalid = true
		case "double-quoted":
			name = "\"" + name + "\""
			invalid = true
		case "number":
			name = fmt.Sprint(n)
			invalid = true
		case "bigint":
			name = fmt.Sprint(n) + "n"
			invalid = true
		case "template":
			name = "`" + name + "`"
			invalid = true
		}
		generic := ""
		if flags&2 != 0 {
			generic = "<T>"
		}
		source := "data Bad" + generic + " { " + name + "; Good { value:number } }; data After { Ready }; const tail=1;"
		source = fmt.Sprintf([]string{"%s", "function scope(){%s}", "namespace Scope{%s}"}[int(flags>>2)%3], source)
		if flags&16 != 0 {
			source = strings.ReplaceAll(source, ";", ";\r\n")
		}
		fileName := "/main.vibe"
		if flags&1 != 0 {
			fileName = "/main.vibex"
		}
		precise := fmt.Sprintf("%s:%d", key, flags)
		t.Logf("variant profile=%s value=%d flags=%d", key, n, flags)
		file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
		ds := file.Diagnostics()
		if invalid {
			if len(ds) != 1 || ds[0].Source() != "EK" || ds[0].Code() != 1606 {
				Gap(t, "FuzzDataVariantNames", precise+":diagnostic", "malformed variant needs only EK1606: %v", ds)
			}
			at := strings.Index(source, name)
			if ds[0].Pos() != at || ds[0].Len() != len(name) {
				Gap(t, "FuzzDataVariantNames", precise+":range", "diagnostic range %d+%d, want %d+%d", ds[0].Pos(), ds[0].Len(), at, len(name))
			}
		} else if len(ds) != 0 {
			Gap(t, "FuzzDataVariantNames", precise+":identifier", "IdentifierName variant: %v", ds)
		}
		found := map[string]bool{}
		for _, form := range forms {
			if form.Name == parser.VibeSyntaxData {
				for _, variant := range form.Variants {
					found[source[variant.Name.Pos():variant.Name.End()]] = true
				}
			}
		}
		if !found["Good"] || !found["Ready"] {
			Gap(t, "FuzzDataVariantNames", precise+":recovery", "following variants lost: %v", found)
		}
	})
}
