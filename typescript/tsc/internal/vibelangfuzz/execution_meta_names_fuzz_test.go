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

const executionMetaTarget = "FuzzExecutionMetaNames"

func TestExecutionMetaNamesQuoted(t *testing.T) { executionMetaChapter(t) }
func executionMetaChapter(t testing.TB) {
	t.Helper()
	quote := "As in \x60new . target\x60, whitespace, comments and line breaks may separate the tokens of \x60try.all\x60, \x60fork.in\x60, \x60fork.scoped\x60 and \x60fork.detached\x60"
	if !strings.Contains(SpecText("900-appendices.md"), quote) {
		t.Fatalf("Appendix A no longer says %q", quote)
	}
	quote = "Native lexical, syntax and static errors keep their \x60TS\x60 codes, as in TypeScript, including independent errors in embedded expressions and types."
	if !strings.Contains(SpecText("007-tooling.md"), quote) {
		t.Fatalf("Chapter 7 no longer says %q", quote)
	}
}

// Meta-property names retain native IdentifierName escapes, including names
// whose decoded text is a TypeScript keyword. Invalid names retain the
// operation-name diagnostic of their literal spelling.
func FuzzExecutionMetaNames(f *testing.F) {
	startShortBudget(f)
	executionMetaChapter(f)
	keys := []string{"try-all", "try-race", "try-any", "try-allSettled", "fork-in", "fork-scoped", "fork-detached", "try-unknown", "fork-unknown", "ordinary-property"}
	for _, key := range keys {
		for _, mode := range []uint8{0, 1, 3, 16, 19, 64, 128, 255} {
			f.Add(key, mode)
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(mode)%len(keys)]
		}
		escape := func(word string) string {
			i := int(mode) % len(word)
			e := fmt.Sprintf("\\u%04x", word[i])
			if mode&16 != 0 {
				e = fmt.Sprintf("\\u{%x}", word[i])
			}
			return word[:i] + e + word[i+1:]
		}
		parts := strings.Split(key, "-")
		owner, name := parts[0], parts[1]
		unknown := name == "unknown"
		if unknown {
			name = []string{"await", "yield", "new", "never", "other"}[int(mode>>1)%5]
		}
		trivia := []string{"", " ", " /* meta */ ", "\n"}[int(mode>>5)%4]
		source := func(name string) string {
			if key == "ordinary-property" {
				return "const o={};o." + escape("any")
			}
			suffix := " []"
			if owner == "fork" {
				suffix = " e"
			}
			if name == "in" || key == "fork-in" {
				suffix = "(scope) e"
			}
			return "effect function f(e:any,scope:any){return " + owner + trivia + "." + trivia + name + suffix + "}"
		}
		plain, escaped := source(name), source(escape(name))
		if key == "ordinary-property" {
			plain = "const o={};o.any"
		}
		ext := "vibe"
		kind := core.ScriptKindTS
		if mode&64 != 0 {
			ext = "vibex"
			kind = core.ScriptKindTSX
		}
		parse := func(fileName, source string) []int32 {
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: tspath.RootedFilePath(fileName), PathKey: tspath.PathKey(fileName), VibeLangDoAsFunction: mode&128 != 0}, source, kind)
			var ds []int32
			for _, d := range file.Diagnostics() {
				ds = append(ds, d.Code())
			}
			return ds
		}
		native := parse("/native.ts", "function f(){return new."+escape("target")+"}")
		if len(native) != 0 {
			t.Fatalf("native meta-name control changed: %v", native)
		}
		want, got := parse("/main."+ext, plain), parse("/main."+ext, escaped)
		expected := int32(0)
		if unknown {
			expected = 1803
			if owner == "fork" {
				expected = 1705
			}
		}
		if expected == 0 && len(want) != 0 || expected != 0 && (len(want) != 1 || want[0] != expected) {
			t.Fatalf("literal meta-name control changed: %v in %s", want, plain)
		}
		if !slices.Equal(got, want) {
			Gap(t, executionMetaTarget, "meta:"+key, "native IdentifierName escape diagnostics: got %v want %v\n%s", got, want, escaped)
		}
		ExpectPending(t, executionMetaTarget, "meta:"+key)
		ExpectPending(t, executionMetaTarget, specCorpusKey(t))
	})
}
