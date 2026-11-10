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
const dataVariantSeparatorQuote = `DataDeclaration = DataStart TypeParameters? "{" (Variant (Separator Variant)* Separator?)? "}"`
const dataVariantPayloadQuote = "A variant's `{` starts its field body even after line breaks; the `LineTerminator` alternative of [Separator](900-appendices.md#separator) does not apply before that `{`."

func dataVariantNameQuotes(tb testing.TB) {
	tb.Helper()
	chapter := SpecText("006-data.md")
	for _, quote := range []string{dataVariantIdentifierQuote, dataVariantMalformedQuote, dataVariantPayloadQuote} {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("data variant rule changed: %q", quote)
		}
	}
	if !strings.Contains(SpecText(grammarAppendix), dataVariantSeparatorQuote) {
		tb.Fatal("data variant separator production changed")
	}

}
func TestDataVariantNamesQuoted(t *testing.T) { dataVariantNameQuotes(t) }

var dataVariantNameKeys = []string{"identifier", "escaped", "reserved", "single-quoted", "double-quoted", "number", "bigint", "template"}

func FuzzDataVariantNames(f *testing.F) {
	startShortBudget(f)
	dataVariantNameQuotes(f)
	for _, key := range dataVariantNameKeys {
		for _, flags := range []uint8{0, 3, 4, 9, 19, 32, 35, 36, 41, 51, 96, 99, 100, 105, 115} {
			f.Add(key, uint16(7), flags)
			f.Add(key+":separator", uint16(7), flags)
		}
	}
	f.Fuzz(func(t *testing.T, key string, n uint16, flags uint8) {
		extraSeparator := strings.HasSuffix(key, ":separator")
		key = strings.TrimSuffix(key, ":separator")
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
		payload := ""
		if flags&32 != 0 {
			gap := " "
			if flags&64 != 0 {
				gap = "\r\n"
			} else if flags&128 != 0 {
				gap = " /* payload */\r\n"
			}
			bodies := []string{"{}", "{ value:number }", "{ nested:{ text:string; more:{flag:boolean} }; tuple:[number,{tag:\"x\"}] }", "{ run:(input:{x:number})=>{result:string}; list:readonly (number|string)[] }"}
			if invalid {
				bodies = append(bodies, "(value:number)", "(run:(input:{x:number})=>void)")
			}
			payload = gap + bodies[int(n)%len(bodies)]
		}
		separator := ";"
		if extraSeparator {
			separator = "; /* variant separator */ ;"
		}
		source := "data Bad" + generic + " { " + name + payload + separator + " Good { value:number } }; data After { Ready }; const tail=1;"
		source = fmt.Sprintf([]string{"%s", "function scope(){%s}", "namespace Scope{%s}"}[int(flags>>2)%3], source)
		if flags&16 != 0 {
			source = strings.ReplaceAll(source, ";", ";\r\n")
		}
		fileName := "/main.vibe"
		if flags&1 != 0 {
			fileName = "/main.vibex"
		}
		if extraSeparator {
			key += ":separator"
		}
		precise := fmt.Sprintf("%s:%d", key, flags)
		t.Logf("variant profile=%s value=%d flags=%d", key, n, flags)
		file, forms := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute(fileName), PathKey: tspath.PathKey(fileName)}, source)
		ds := file.Diagnostics()
		wantDiagnostics := 0
		if invalid {
			wantDiagnostics++
		}
		if extraSeparator {
			wantDiagnostics++
		}
		if len(ds) != wantDiagnostics {
			Gap(t, "FuzzDataVariantNames", precise+":diagnostic", "variant syntax needs %d EK1606 errors: %v", wantDiagnostics, ds)
		}
		for _, d := range ds {
			if d.Source() != "EK" || d.Code() != 1606 {
				Gap(t, "FuzzDataVariantNames", precise+":diagnostic", "variant syntax needs EK1606: %v", ds)
			}
		}
		if invalid {
			at := strings.Index(source, name)
			if ds[0].Pos() != at || ds[0].Len() != len(name) {
				Gap(t, "FuzzDataVariantNames", precise+":range", "diagnostic range %d+%d, want %d+%d", ds[0].Pos(), ds[0].Len(), at, len(name))
			}
		}
		if extraSeparator {
			commentEnd := strings.Index(source, "/* variant separator */") + len("/* variant separator */")
			at := commentEnd + strings.Index(source[commentEnd:], ";")
			index := 0
			if invalid {
				index++
			}
			if ds[index].Pos() != at || ds[index].Len() != 1 {
				Gap(t, "FuzzDataVariantNames", precise+":separator-range", "separator range %d+%d, want %d+1", ds[index].Pos(), ds[index].Len(), at)
			}
		}
		found := map[string]bool{}
		for _, form := range forms {
			if form.Name == parser.VibeSyntaxData {
				for _, variant := range form.Variants {
					found[source[variant.Name.Pos():variant.Name.End()]] = true
				}
			}
		}
		want := 2
		if !invalid {
			want++
		}
		if len(found) != want || !found["Good"] || !found["Ready"] || (!invalid && !found[name]) {
			Gap(t, "FuzzDataVariantNames", precise+":recovery", "following variants lost: %v", found)
		}
	})
}
