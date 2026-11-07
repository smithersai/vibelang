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

const concurrentHeadExecutionQuote = "The item arrives under a fresh parameter, and the head\u0027s declaration runs first in the item\u0027s generator, so a default or computed key in it may run Effects and a failure there fails that item."

func TestConcurrentHeadExecutionQuoted(t *testing.T) {
	if !strings.Contains(SpecText("002-running.md"), concurrentHeadExecutionQuote) {
		t.Fatal("stale concurrent initialization quote")
	}
}

func FuzzConcurrentHeadExecution(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("002-running.md"), concurrentHeadExecutionQuote) {
		f.Fatal("stale concurrent initialization quote")
	}
	keys := []string{"object-default", "array-default", "computed-key", "nested-default", "plain-default"}
	for _, key := range keys {
		for variant := uint8(0); variant < 8; variant++ {
			f.Add(key, variant)
		}
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		index := -1
		for i, candidate := range keys {
			if key == candidate {
				index = i
				break
			}
		}
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(keys)
		}
		key = keys[index]
		heads := []string{"{ n = do { try Effect.void; 7 } }", "[n = do { try Effect.void; 7 }]", "{ [do { try Effect.void; \"n\" }]: n }", "{ pair: [n = do { try Effect.void; 7 }] }", "{ n = 7 }"}
		rows := []string{"[{}]", "[[]]", "[{n:7}]", "[{pair:[]}]", "[{}]"}
		kind, bound, trivia := "const", "", " "
		if variant&1 != 0 {
			kind = "let"
		}
		if variant&2 != 0 {
			bound = "(1)"
		}
		if variant&4 != 0 {
			trivia = "\n/* item */ "
		}
		body := "{ total += n }"
		if variant&8 != 0 {
			body = "total += n;"
		}
		source := fmt.Sprintf("export effect function sample() { const $concurrentItem=9; let total=0; for concurrent%s (%s %s of %s)%s%s return total }", bound, kind, heads[index], rows[index], trivia, body)
		for _, mode := range []string{"checking", "lint", "execution"} {
			ctx := vibelangmapper.FileContext{Lint: mode == "lint"}
			var projection vibelangmapper.Projection
			if mode == "execution" {
				projection = vibelangmapper.Executable(source, ctx)
			} else {
				projection = vibelangmapper.Project(source, ctx)
			}
			if len(projection.Diagnostics) != 0 {
				Gap(t, "FuzzConcurrentHeadExecution", key, "%s rejects item initialization: %v\n%s", mode, projection.Diagnostics, projection.Text)
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/virtual.ts")}, projection.Text, core.ScriptKindTS)
			if len(file.Diagnostics()) != 0 {
				Gap(t, "FuzzConcurrentHeadExecution", key, "%s emits invalid TypeScript: %v\n%s", mode, file.Diagnostics(), projection.Text)
			}
		}
		ExpectPending(t, "FuzzConcurrentHeadExecution", key)
		ExpectPending(t, "FuzzConcurrentHeadExecution", specCorpusKey(t))
	})
}
