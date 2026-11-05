package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/spanmap"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const mapperLoopIsQuote = "`subject is P` evaluates the subject once and returns the pattern's Boolean result"
const mapperLoopHomeQuote = "An `is` in a loop head uses the pinned loop-head/per-iteration scopes."

func TestMapperLoopIsQuoted(t *testing.T) {
	text := SpecText("004-match.md")
	if !strings.Contains(text, mapperLoopIsQuote) || !strings.Contains(text, mapperLoopHomeQuote) {
		t.Fatal("loop pattern scope or evaluation rule changed")
	}
}

// Mutate the complete loop head. Synthetic declarations and the condition
// must share one rendering, and the source subject must occur exactly once.
func FuzzMapperLoopIsBindings(f *testing.F) {
	startShortBudget(f)
	patterns := []struct{ key, text string }{
		{"object", "{done: false, value: let value}"},
		{"nested", "{done: false, value: {id: let value}}"},
		{"tuple", "[let value]"},
	}
	for _, p := range patterns {
		for mode := uint8(0); mode < 16; mode++ {
			f.Add(p.key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMapperLoopIsQuoted(t)
		pattern := patterns[len(key)%len(patterns)]
		for _, candidate := range patterns {
			if candidate.key == key {
				pattern = candidate
			}
		}
		subject := "it.next()"
		if mode&4 != 0 {
			subject = "(" + subject + ")"
		}
		head, update := "", "use(value)"
		if mode&2 != 0 {
			head, update = "let turns = 0", "turns++"
		}
		effect := ""
		if mode&1 != 0 {
			effect = "effect "
		}
		source := fmt.Sprintf("function use(n: unknown) {}\nexport %sfunction probe(it: {next(): IteratorResult<number>}) { for (%s; %s is %s; %s) { use(value) } }\n", effect, head, subject, pattern.text, update)
		if mode&8 != 0 {
			source = "// λ\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		for name, projected := range map[string]vibelangmapper.Projection{
			"checking":   vibelangmapper.Project(source, vibelangmapper.FileContext{}),
			"executable": vibelangmapper.Executable(source, vibelangmapper.FileContext{}),
		} {
			if len(projected.Diagnostics) != 0 {
				Gap(t, "FuzzMapperLoopIsBindings", pattern.key, "%s diagnostics: %+v\n%s", name, projected.Diagnostics, source)
			}
			if problem := spanmap.New(projected.Segments).Validate(projected.Text, source); problem != nil {
				Gap(t, "FuzzMapperLoopIsBindings", pattern.key, "%s map: %v", name, problem)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/mapper-loop.ts")}, projected.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzMapperLoopIsBindings", pattern.key, "%s syntax: %v\n%s", name, file.Diagnostics(), projected.Text)
			}
			if strings.Count(projected.Text, "it.next()") != 1 {
				Gap(t, "FuzzMapperLoopIsBindings", pattern.key, "%s repeats or drops the subject:\n%s", name, projected.Text)
			}
		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diagnostics) != 0 || js == "" || strings.Count(js, "it.next()") != 1 {
			Gap(t, "FuzzMapperLoopIsBindings", pattern.key, "execution rendering: %+v\n%s", diagnostics, js)
		}
		ExpectPending(t, "FuzzMapperLoopIsBindings", pattern.key)
	})
}
