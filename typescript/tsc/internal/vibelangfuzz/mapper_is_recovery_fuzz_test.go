package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperIsRecoveryQuote = "an `is` pattern binding in an unbraced statement body"

func TestMapperIsRecoveryQuoted(t *testing.T) {
	if !strings.Contains(SpecText("004-match.md"), mapperIsRecoveryQuote) {
		t.Fatal("unbraced binding rule changed")
	}
}

func FuzzMapperIsRecoveryBlocks(f *testing.F) {
	startShortBudget(f)
	loops := []struct{ key, text string }{
		{"concurrent", "for concurrent(1)(const x of xs) "},
		{"stream", "for try(const x of Stream.fromIterable(xs)) "},
		{"ordinary", "for (const x of xs) "},
	}
	patterns := []struct{ key, text string }{{"object", "{id:let id}"}, {"tuple", "[let id]"}, {"nested", "{nested:{id:let id}}"}}
	for i, loop := range loops {
		for mode := uint8(0); mode < 8; mode++ {
			braces := "unbraced"
			if mode&4 != 0 {
				braces = "braced"
			}
			f.Add(loop.key+"/"+patterns[mode%3].key+"/"+braces, uint8(i), mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, kind, mode uint8) {
		loop, pat := loops[int(kind)%len(loops)], patterns[int(mode)%len(patterns)]
		braced := mode&4 != 0
		parts := strings.Split(key, "/")
		if len(parts) == 3 {
			for _, row := range loops {
				if row.key == parts[0] {
					loop = row
				}
			}
			for _, row := range patterns {
				if row.key == parts[1] {
					pat = row
				}
			}
			if parts[2] == "braced" {
				braced = true
			} else if parts[2] == "unbraced" {
				braced = false
			}
		}
		braces := "unbraced"
		if braced {
			braces = "braced"
		}
		key = loop.key + "/" + pat.key + "/" + braces
		pattern, head := pat.text, loop.text
		body := "(x is " + pattern + ") && readers.push(()=>id);"
		if braced {
			body = "{ " + body + " }"
		}
		source := "effect function home(xs:unknown[]){ const readers:(()=>unknown)[]=[]; " + head + body + " return readers; }"
		ctx := vibelangmapper.FileContext{}
		for name, result := range map[string]vibelangmapper.Projection{"checking": vibelangmapper.Project(source, ctx), "executable": vibelangmapper.Executable(source, ctx)} {
			for _, d := range result.Diagnostics {
				if strings.Contains(d.Message, "overlapping edits") {
					Gap(t, "FuzzMapperIsRecoveryBlocks", key, "%s invalid projection: %s\n%s", name, d.Message, source)
				}
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/mapper.ts")}, result.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzMapperIsRecoveryBlocks", key, "%s output does not parse: %v\n%s", name, file.Diagnostics(), result.Text)
			}
			if !braced && !strings.Contains(result.Text, "$patternError") {
				Gap(t, "FuzzMapperIsRecoveryBlocks", key, "%s lost the unbraced binding marker:\n%s", name, result.Text)
			}
		}
	})
}
