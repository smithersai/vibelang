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

const mapperArgumentIsQuote = "`subject is P` evaluates the subject once and returns the pattern's Boolean result"
const mapperArgumentHomeQuote = "In an ordinary block expression or an `if` head, its `let` and `const` names belong to the nearest enclosing lexical home"

func TestMapperIsCallArgumentQuoted(t *testing.T) {
	text := SpecText("004-match.md")
	if !strings.Contains(text, mapperArgumentIsQuote) || !strings.Contains(text, mapperArgumentHomeQuote) {
		t.Fatal("call-argument pattern scope or evaluation rule changed")
	}
}

// Mutate binding patterns inside call arguments. Their declarations share
// the caller lexical home, and their subject is evaluated exactly once.
func FuzzMapperIsCallArgumentBindings(f *testing.F) {
	startShortBudget(f)
	patterns := []struct{ key, text string }{
		{"capture", "let value"},
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
		TestMapperIsCallArgumentQuoted(t)
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
		effect := ""
		if mode&1 != 0 {
			effect = "effect "
		}
		argument := subject + " is " + pattern.text
		if mode&2 != 0 {
			argument = "(" + argument + ")"
		}
		if mode&4 != 0 {
			argument = "{matched: " + argument + "}"
		}
		source := fmt.Sprintf("function use(n: unknown) {}\nexport %sfunction probe(it: {next(): unknown}) { use(%s); return value }\n", effect, argument)
		if mode&8 != 0 {
			source = "// λ\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		for name, projected := range map[string]vibelangmapper.Projection{
			"checking":   vibelangmapper.Project(source, vibelangmapper.FileContext{}),
			"executable": vibelangmapper.Executable(source, vibelangmapper.FileContext{}),
		} {
			if len(projected.Diagnostics) != 0 {
				Gap(t, "FuzzMapperIsCallArgumentBindings", pattern.key, "%s diagnostics: %+v\n%s", name, projected.Diagnostics, source)
			}
			if problem := spanmap.New(projected.Segments).Validate(projected.Text, source); problem != nil {
				Gap(t, "FuzzMapperIsCallArgumentBindings", pattern.key, "%s map: %v", name, problem)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/mapper-argument.ts")}, projected.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzMapperIsCallArgumentBindings", pattern.key, "%s syntax: %v\n%s", name, file.Diagnostics(), projected.Text)
			}
			if strings.Count(projected.Text, "it.next()") != 1 {
				Gap(t, "FuzzMapperIsCallArgumentBindings", pattern.key, "%s repeats or drops the subject:\n%s", name, projected.Text)
			}
		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diagnostics) != 0 || js == "" || strings.Count(js, "it.next()") != 1 {
			Gap(t, "FuzzMapperIsCallArgumentBindings", pattern.key, "execution rendering: %+v\n%s", diagnostics, js)
		}
		ExpectPending(t, "FuzzMapperIsCallArgumentBindings", pattern.key)
	})
}
