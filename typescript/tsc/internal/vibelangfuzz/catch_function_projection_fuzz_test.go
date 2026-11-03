package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const catchProjectionQuote = "The handler is always a function literal, and its syntax alone decides its kind"

func catchFunctionProjectionChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), catchProjectionQuote) {
		t.Fatal("Chapter 2 no longer contains the catch-handler rule")
	}
}

func TestCatchFunctionProjectionQuoted(t *testing.T) { catchFunctionProjectionChapter(t) }

// VIP-5 admits function expressions wherever an arrow is a catch handler.
// Projection must preserve that admitted syntax rather than casting every
// handler to an arrow. The keys retain each shape independently of ordering.
func FuzzCatchFunctionProjection(f *testing.F) {
	startShortBudget(f)
	catchFunctionProjectionChapter(f)
	for _, key := range []string{"function-expression", "named-function", "typed-function", "effect-function", "arrow-control"} {
		for _, gap := range []string{" ", " /* handler */ ", "\n"} {
			f.Add(key, gap)
		}
	}
	f.Fuzz(func(t *testing.T, key, gap string) {
		if gap != " " && gap != " /* handler */ " && gap != "\n" {
			gap = " "
		}
		handler := "function (error) { return 0 }"
		switch key {
		case "named-function":
			handler = "function fallback(error) { return 0 }"
		case "typed-function":
			handler = "function (error: string): number { return 0 }"
		case "effect-function":
			handler = "effect function (error) { return try Effect.succeed(0) }"
		case "arrow-control":
			handler = "(error) => 0"
		default:
			key = "function-expression"
		}
		for _, parenthesized := range []bool{false, true} {
			h := handler
			if parenthesized {
				h = "(" + h + ")"
			}
			source := "declare const load: () => Effect.Effect<number, string>\neffect function main(): number!! { return load() catch" + gap + h + " }"
			ctx := vibelangmapper.FileContext{FileName: "/main.vibe", ModuleKey: "test/main"}
			for name, projection := range map[string]vibelangmapper.Projection{"checking": vibelangmapper.Project(source, ctx), "executable": vibelangmapper.Executable(source, ctx)} {
				file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePathFromAbsolute("/virtual.ts")}, projection.Text, core.ScriptKindTS)
				if len(file.Diagnostics()) != 0 {
					Gap(t, "FuzzCatchFunctionProjection", key, "%s must project an admitted literal handler as TypeScript: %v\n%s", name, file.Diagnostics(), projection.Text)
				}
				for _, d := range projection.Diagnostics {
					if strings.Contains(d.Message, "overlapping edits") {
						Gap(t, "FuzzCatchFunctionProjection", key, "%s: %s", name, d.Message)
					}
				}
			}
		}
	})
}
