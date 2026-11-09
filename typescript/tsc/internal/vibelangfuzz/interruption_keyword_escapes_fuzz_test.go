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

const interruptionKeywordTarget = "FuzzInterruptionKeywordEscapes"
const interruptionKeywordNativeQuote = "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."

func TestInterruptionKeywordEscapesQuoted(t *testing.T) { interruptionKeywordChapter(t) }
func interruptionKeywordChapter(t testing.TB) {
	t.Helper()
	for _, word := range []string{"uninterruptible", "restore", "interruptible"} {
		quote := fmt.Sprintf("%s = [+Effect] %q [no LineTerminator here] Block", strings.ToUpper(word[:1])+word[1:], word)
		if !strings.Contains(SpecText("900-appendices.md"), quote) {
			t.Fatalf("Appendix A no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("007-tooling.md"), interruptionKeywordNativeQuote) {
		t.Fatalf("Chapter 7 no longer says %q", interruptionKeywordNativeQuote)
	}
}

// Contextual block keywords retain async's native escape check. Newline
// boundaries, identifiers and property names retain their native reading.
func FuzzInterruptionKeywordEscapes(f *testing.F) {
	startShortBudget(f)
	interruptionKeywordChapter(f)
	var keys []string
	for _, word := range []string{"uninterruptible", "restore", "interruptible"} {
		for _, form := range []string{"keyword", "binding", "call", "property", "linebreak"} {
			key := form + ":" + word
			keys = append(keys, key)
			for _, mode := range []uint8{0, 1, 6, 16, 21, 64, 128, 255} {
				f.Add(key, mode)
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		form, word, _ := strings.Cut(key, ":")
		escape := func(word string) string {
			i := int(mode) % len(word)
			replacement := fmt.Sprintf("\\u%04x", word[i])
			if mode&16 != 0 {
				replacement = fmt.Sprintf("\\u{%x}", word[i])
			}
			return word[:i] + replacement + word[i+1:]
		}
		escaped := escape(word)
		source, twin := "", ""
		switch form {
		case "keyword":
			body := escaped + " /* body */ {}"
			if word == "restore" {
				body = "uninterruptible{" + body + "}"
			}
			source = "effect function f(){" + body + "}"
			twin = escape("async") + " function f(){}"
		case "binding":
			source = "const " + escaped + "=1"
		case "call":
			source = "function f(" + escaped + ":(n:number)=>number){return " + escaped + "(1)}"
		case "property":
			source = "const o={" + escaped + "(){return 1}};o." + escaped + "()"
		case "linebreak":
			source = "function f(" + word + ":number){" + escaped + "\n{}}"
		}
		if twin == "" {
			twin = source
		}
		ext := "vibe"
		kind := core.ScriptKindTS
		if mode&64 != 0 {
			ext = "vibex"
			kind = core.ScriptKindTSX
		}
		parse := func(name, source string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(name), PathKey: tspath.PathKey(name), VibeLangDoAsFunction: mode&128 != 0}, source, kind)
			var codes []int32
			for _, d := range file.Diagnostics() {
				codes = append(codes, d.Code())
			}
			return codes
		}
		got, want := parse("/main."+ext, source), parse("/main.ts", twin)
		if form == "keyword" && (len(want) != 1 || want[0] != 1260) {
			t.Fatalf("native async control changed: %v", want)
		}
		if !slices.Equal(got, want) {
			Gap(t, interruptionKeywordTarget, "literal:"+key, "%s; literal %q block: native diagnostics %v, got %v\n%s", interruptionKeywordNativeQuote, word, want, got, source)
		}
		ExpectPending(t, interruptionKeywordTarget, "literal:"+key)
		ExpectPending(t, interruptionKeywordTarget, specCorpusKey(t))
	})
}
