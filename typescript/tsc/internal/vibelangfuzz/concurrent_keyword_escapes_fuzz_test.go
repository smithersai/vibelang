package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const concurrentKeywordTarget = "FuzzConcurrentKeywordEscapes"
const concurrentKeywordQuote = "ForConcurrent = [+Effect] \"for\" \"concurrent\""
const concurrentKeywordNativeQuote = "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestConcurrentKeywordEscapesQuoted(t *testing.T) {
	concurrentKeywordChapter(t)
}
func concurrentKeywordChapter(t testing.TB) {
	t.Helper()
	for chapter, quote := range map[string]string{
		"900-appendices.md": concurrentKeywordQuote,
		"007-tooling.md":    concurrentKeywordNativeQuote,
	} {
		if !strings.Contains(SpecText(chapter), quote) {
			t.Fatalf("%s no longer says %q", chapter, quote)
		}
	}
}

// A literal loop keyword follows native await's lexical rule. Vary every
// letter, both Unicode escape syntaxes, trivia, limits and parser modes.
// Ordinary escaped names retain the same diagnostics as their TypeScript twin.
func FuzzConcurrentKeywordEscapes(f *testing.F) {
	startShortBudget(f)
	concurrentKeywordChapter(f)
	keys := []string{"loop", "loop-limit", "binding", "call", "property", "head-binding"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 9, 16, 25, 64, 128, 255} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		escape := func(word string) string {
			i := int(mode) % len(word)
			replacement := fmt.Sprintf("\\u%04x", word[i])
			if mode&16 != 0 {
				replacement = fmt.Sprintf("\\u{%x}", word[i])
			}
			return word[:i] + replacement + word[i+1:]
		}
		word := escape("concurrent")
		trivia := []string{" ", " /* header */ ", "\n", " /*\nheader\n*/ "}[int(mode>>5)%4]
		source := ""
		twin := ""
		switch key {
		case "loop", "loop-limit":
			limit := ""
			if key == "loop-limit" {
				limit = "(2)"
			}
			source = "effect function f(){for" + trivia + word + trivia + limit + "(const x of [1]){}}"
			twin = "async function f(){for" + trivia + escape("await") + trivia + "(const x of [1]){}}"
		case "binding":
			source = "const " + word + "=1;export{concurrent}"
		case "call":
			source = "function f(" + word + ":(n:number)=>number){return concurrent(1)}"
		case "property":
			source = "const o={" + word + "(){return 1}};o.concurrent()"
		case "head-binding":
			source = "effect function f(){for concurrent(const " + word + " of [1]){const y=concurrent}}"
			twin = "async function f(){for await(const " + word + " of [1]){const y=concurrent}}"
		}
		if twin == "" {
			twin = source
		}
		extension := "vibe"
		if mode&64 != 0 {
			extension = "vibex"
		}
		parse := func(name, source string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name), VibeLangDoAsFunction: mode&128 != 0}, source, core.ScriptKindTS)
			var codes []int32
			for _, d := range file.Diagnostics() {
				codes = append(codes, d.Code())
			}
			return codes
		}
		got, want := parse("/main."+extension, source), parse("/main.ts", twin)
		if strings.HasPrefix(key, "loop") && (len(want) != 1 || want[0] != 1260) {
			t.Fatalf("native await control changed: %v", want)
		}
		if !slices.Equal(got, want) {
			Gap(t, concurrentKeywordTarget, "keyword:"+key, "%s; native keyword diagnostics %v, got %v\n%s", concurrentKeywordQuote, want, got, source)
		}
		ExpectPending(t, concurrentKeywordTarget, "keyword:"+key)
		ExpectPending(t, concurrentKeywordTarget, specCorpusKey(t))
	})
}
