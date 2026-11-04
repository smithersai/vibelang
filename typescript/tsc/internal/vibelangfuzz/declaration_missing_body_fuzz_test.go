package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"strings"
	"testing"
)

const missingSchemaBodyQuote = "A recognized ordinary schema header missing its required declaration form is `EK1503`"
const missingDataBodyQuote = "a recognized data header missing its variant body is `EK1604`"

func TestDeclarationMissingBodyQuoted(t *testing.T) {
	chapter := SpecText("006-data.md")
	for _, q := range []string{missingSchemaBodyQuote, missingDataBodyQuote} {
		if !strings.Contains(chapter, q) {
			t.Fatalf("stale chapter006 oracle: %s", q)
		}
	}
}

func FuzzDeclarationMissingBody(f *testing.F) {
	startShortBudget(f)
	chapter := SpecText("006-data.md")
	for _, q := range []string{missingSchemaBodyQuote, missingDataBodyQuote} {
		if !strings.Contains(chapter, q) {
			f.Fatalf("stale chapter006 oracle: %s", q)
		}
	}
	for _, kind := range []string{"schema", "data"} {
		for _, suffix := range []string{"", "a", "b", "c", "d", "e"} {
			f.Add([]byte(kind + ":" + suffix))
		}
	}
	f.Fuzz(func(t *testing.T, input []byte) {
		key, tail, _ := strings.Cut(string(input), ":")
		if key != "data" && key != "schema" {
			if len(input) > 0 && input[0]&1 != 0 {
				key = "data"
			} else {
				key = "schema"
			}
		}
		bits := 0
		for _, b := range []byte(tail) {
			bits = (bits + int(b)) % 256
		}
		names := []string{"Missing", "M\\u0069ssing", "$Missing", "_Missing"}
		ends := []string{"", ";", "\nconst after=1;", " // body absent\n", " /* body absent */", "\r\nconst after=1;"}
		name := names[bits%len(names)]
		if key == "data" && bits&64 != 0 {
			name += "<T>"
		}
		source := key + " " + name + ends[bits%len(ends)]
		wantCount := 1
		if bits&32 != 0 {
			source += ";\n" + key + " Other"
			wantCount = 2
		}
		switch bits % 4 {
		case 1:
			source = "export " + source
		case 2:
			source = "namespace N {" + source + "\n}"
		case 3:
			source = "function f(){" + source + "\n}"
		}
		parse := func(text string) *ast.SourceFile {
			return parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, text, core.ScriptKindTS)
		}
		want := parser.VibeLangSchemaMissingBodyCode
		if key == "data" {
			want = parser.VibeLangDataMissingBodyCode
		}
		count := 0
		for _, d := range parse(source).Diagnostics() {
			if d.Source() == "EK" && d.Code() == want {
				count++
			}
			if d.Code() == 1005 {
				Gap(t, "FuzzDeclarationMissingBody", key, "Chapter006 requires EK%d rather than TS1005 for %q", want, source)
			}
		}
		if count != wantCount {
			Gap(t, "FuzzDeclarationMissingBody", key, "Chapter006 requires %d EK%d for %q; found%d", wantCount, want, source, count)
		}
		// Empty bodies remain bodies; this oracle checks syntax, not their emitter.
		for _, d := range parse(key + " Valid {}").Diagnostics() {
			if d.Code() == want {
				Gap(t, "FuzzDeclarationMissingBody", key, "A present body got missing-body EK%d", want)
			}
		}
	})
}
