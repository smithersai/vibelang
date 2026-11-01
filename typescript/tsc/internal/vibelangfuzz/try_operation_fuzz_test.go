package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const tryOperationTarget = "FuzzTryOperationNames"
const tryOperationQuote = "a name after `try.` other than `all`, `race`, `any` or `allSettled`"

func tryOperationChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), tryOperationQuote) {
		t.Fatalf("chapter 2 no longer says %q", tryOperationQuote)
	}
}
func TestTryOperationNamesQuoted(t *testing.T) { tryOperationChapter(t) }

// The four try operations parse; any other name after try. is one EK1803 at
// the parser and no TypeScript parse error (VIP-18).
func FuzzTryOperationNames(f *testing.F) {
	startShortBudget(f)
	tryOperationChapter(f)
	names := []string{"all", "race", "any", "allSettled", "map", "each", "then", "catch", "x"}
	for _, name := range names {
		f.Add([]byte(name))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		name := string(data)
		if name == "" || !isWord(name) {
			name = names[int(len(data))%len(names)]
		}
		source := "export effect function f(xs: Array<number!!>) { return try." + name + " xs }\n"
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		valid := name == "all" || name == "race" || name == "any" || name == "allSettled"
		var ek, ts int
		for _, d := range file.Diagnostics() {
			if d.Code() == 1803 {
				ek++
			} else {
				ts++
			}
		}
		key := "name:" + name
		if valid {
			key = "operation:" + name
		}
		if valid && (ek != 0 || ts != 0) || !valid && (ek != 1 || ts != 0) {
			Gap(t, tryOperationTarget, key, "%s; expected %d EK1803 and no parse error, got %d and %d\n%s\n%v", tryOperationQuote, map[bool]int{true: 0, false: 1}[valid], ek, ts, source, file.Diagnostics())
		}
		ExpectPending(t, tryOperationTarget, key)
		ExpectPending(t, tryOperationTarget, specCorpusKey(t))
	})
}

func isWord(s string) bool {
	for i, r := range s {
		if !(r == '_' || r == '$' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || i > 0 && r >= '0' && r <= '9') {
			return false
		}
	}
	return true
}
