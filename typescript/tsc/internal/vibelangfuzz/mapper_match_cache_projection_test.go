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

const mapperMatchCacheQuote = "Synchronous `match` evaluates its subject once and tests arms in order."

func TestMapperMatchCacheProjectionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), mapperMatchCacheQuote) {
		t.Fatal("match subject evaluation rule changed")
	}
}

func FuzzMapperMatchCacheProjection(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"held", "returned", "arrow"} {
		for n := uint8(0); n < 4; n++ {
			f.Add(key, n, false)
			f.Add(key, n, true)
		}
	}
	f.Fuzz(func(t *testing.T, key string, n uint8, crlf bool) {
		TestMapperMatchCacheProjectionQuoted(t)
		if key != "held" && key != "returned" && key != "arrow" {
			key = "held"
		}
		expression := fmt.Sprintf("match (readSubject()) { when NotFound and { let id }: id + %d; default: fallback(); }", int(n))
		source := "effect function f() { const label = " + expression + "; return label; }\n"
		switch key {
		case "returned":
			source = "effect function f() { return " + expression + "; }\n"
		case "arrow":
			source = "const f = effect () => { const label = " + expression + "; return label; };\n"
		}
		if crlf {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		for name, result := range map[string]vibelangmapper.Projection{
			"checking":   vibelangmapper.Project(source, vibelangmapper.FileContext{}),
			"executable": vibelangmapper.Executable(source, vibelangmapper.FileContext{}),
		} {
			if len(result.Diagnostics) != 0 {
				Gap(t, "FuzzMapperMatchCacheProjection", key, "%s rejected valid match: %v\n%s", name, result.Diagnostics, source)
			}
			if strings.Count(result.Text, "readSubject") != 1 {
				Gap(t, "FuzzMapperMatchCacheProjection", key, "%s: %s\n%s", name, mapperMatchCacheQuote, result.Text)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/mapper-match.ts")}, result.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzMapperMatchCacheProjection", key, "%s output does not parse: %v\n%s", name, file.Diagnostics(), result.Text)
			}
		}
	})
}
