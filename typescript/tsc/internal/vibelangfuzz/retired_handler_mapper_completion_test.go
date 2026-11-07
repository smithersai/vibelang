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

func TestRetiredHandlerMapperCompletionQuoted(t *testing.T) { relicRejectionQuoted(t) }

// Rejected handler syntax must not receive executable continuation edits.
// Its completion shape must leave independent native declarations intact.
func FuzzRetiredHandlerMapperCompletion(f *testing.F) {
	startShortBudget(f)
	clauses := []struct{ key, text string }{
		{"empty", ""},
		{"call", "consume(x)"},
		{"conditional", "if (x) consume(x)"},
		{"return", "return x"},
	}
	for _, clause := range clauses {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(clause.key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestRetiredHandlerMapperCompletionQuoted(t)
		clause := clauses[len(key)%len(clauses)]
		for _, candidate := range clauses {
			if candidate.key == key {
				clause = candidate
			}
		}
		body := "try { work() } handle Ask.ask(x) { " + clause.text + " }"
		if mode&1 != 0 {
			body = strings.Replace(body, "work()", "work(); break", 1)
			body = "for (const value of [1]) { " + body + " }"
		}
		source := fmt.Sprintf("control Ask { ask(): number!! }\nfunction half(n: number) { return n / 2 }\nexport effect function probe() { %s }\n", body)
		if mode&2 != 0 {
			source = "// λ\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		for name, projected := range map[string]vibelangmapper.Projection{
			"checking":   vibelangmapper.Project(source, vibelangmapper.FileContext{}),
			"executable": vibelangmapper.Executable(source, vibelangmapper.FileContext{}),
		} {
			found := false
			for _, d := range projected.Diagnostics {
				if d.Code == 3501 {
					found = true
				}
				if strings.Contains(d.Message, "overlapping edits") {
					Gap(t, "FuzzRetiredHandlerMapperCompletion", clause.key, "%s projection overlaps after rejecting handler syntax: %+v", name, projected.Diagnostics)
				}
			}
			if !found {
				Gap(t, "FuzzRetiredHandlerMapperCompletion", clause.key, "retired handler lost EK3501: %+v", projected.Diagnostics)
			}
			if problem := spanmap.New(projected.Segments).Validate(projected.Text, source); problem != nil {
				Gap(t, "FuzzRetiredHandlerMapperCompletion", clause.key, "%s map: %v", name, problem)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/retired-handler.ts")}, projected.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzRetiredHandlerMapperCompletion", clause.key, "%s syntax: %v\n%s", name, file.Diagnostics(), projected.Text)
			}

		}
		js, _, diagnostics := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if js == "" || !strings.Contains(js, "function half$direct(") {
			Gap(t, "FuzzRetiredHandlerMapperCompletion", clause.key, "retired handler damaged an independent pure declaration: %+v\n%s", diagnostics, js)
		}
		ExpectPending(t, "FuzzRetiredHandlerMapperCompletion", clause.key)
	})
}
