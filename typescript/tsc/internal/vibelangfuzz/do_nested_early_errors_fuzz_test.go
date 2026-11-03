package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const nestedDoParameterQuote = "`var` in a `do` expression in a parameter list is `EK0203`."

func TestDoNestedEarlyErrorsQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", doLoopHeadQuote)
	chapterSays(t, "002-running.md", nestedDoParameterQuote)
}

// Nesting a source do does not add a source function boundary. Loop-head
// jumps keep EK0205; parameter vars keep EK0203 exactly once. Source
// functions and local loops retain their separate execution boundaries.
func FuzzDoNestedEarlyErrors(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", doLoopHeadQuote)
	chapterSays(f, "002-running.md", nestedDoParameterQuote)
	keys := []string{"break", "continue", "label", "parameter", "pattern", "parameter-match", "parameter-do-match", "match-break", "match-continue", "match-local", "local", "function", "class", "enclosing", "nested-local"}
	for _, key := range keys {
		f.Add(key, uint8(1), uint8(0))
		f.Add(key, uint8(3), uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, depth, head uint8) {
		if !slices.Contains(keys, key) {
			key = keys[int(depth)%len(keys)]
		}
		body := "break; []"
		var want int32 = parser.DoLoopHeadCode
		switch key {
		case "continue", "match-continue":
			body = "continue; []"
		case "label":
			body = "break a; []"
		case "parameter", "pattern", "parameter-match", "parameter-do-match":
			body, want = "var v = 1; v", parser.DoParameterVarCode
		case "local", "match-local":
			body, want = "while (true) { break; } []", 0
		case "function":
			body, want = "(() => { var v = 1; return v })()", 0
		case "class":
			body, want = "class C { m() { var v = 1; return v } }; 1", 0
		case "enclosing":
			body, want = "break enclosing; []", 0
		case "nested-local":
			want = 0
		}
		for i := 0; i < 1+int(depth%4); i++ {
			body = "(do { " + body + " })"
		}
		loops := []string{"while ($do) {}", "for (const v of $do) {}", "for (const v in $do) {}", "for (; $do;) {}"}
		source := "function f() { enclosing: while (true) { a: b: " + strings.ReplaceAll(loops[int(head)%len(loops)], "$do", body) + " } }"
		if strings.HasPrefix(key, "match-") {
			source = "function f() { enclosing: while (true) { a: b: " + strings.ReplaceAll(loops[int(head)%len(loops)], "$do", "match (0) { default: "+body+" }") + " } }"
		}
		switch key {
		case "parameter", "function", "class":
			source = "function f(x = " + body + ") {}"
		case "pattern":
			source = "function f({x = " + body + "} = {}) {}"
		case "parameter-match":
			source = "function f(x = match (0) { default: " + body + " }) {}"
		case "parameter-do-match":
			source = "function f(x = do { match (0) { default: " + body + " } }) {}"
		case "nested-local":
			source = "function f() { while (do { while (true) { const v = " + body + "; } true }) {} }"
		}
		file, _ := parser.ParseVibeLangSyntax(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source)
		count := 0
		if want != 0 {
			count = 1
		}
		got := file.Diagnostics()
		gap := "rule:" + key
		if len(got) != count || count == 1 && got[0].Code() != want {
			Gap(t, "FuzzDoNestedEarlyErrors", gap, "want EK%04d once (zero means no diagnostics), got %v\n%s", want, got, source)
		}
		ExpectPending(t, "FuzzDoNestedEarlyErrors", gap)
		ExpectPending(t, "FuzzDoNestedEarlyErrors", specCorpusKey(t))
	})
}
