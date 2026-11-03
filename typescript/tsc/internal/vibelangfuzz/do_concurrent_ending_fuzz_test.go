package vibelangfuzz

import (
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/parser"
)

const doConcurrentEndingQuote = "Every [ForTry](900-appendices.md#fortry) and [ForConcurrent](900-appendices.md#forconcurrent) production, with or without a concurrency limit, uses the native iteration rule: `isLast` equal to `true` gives `true`; otherwise a body passing `IsBreak` with that label set gives `true`; otherwise apply the predicate to the body with the same `labelSet` and `isLast`."

func TestDoConcurrentEndingQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", doConcurrentEndingQuote)
}

// Static source predicates must see iteration, not the call used to represent
// it. Native for-of and for-try controls use the very same cited iteration rule.
func FuzzDoConcurrentEnding(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", doConcurrentEndingQuote)
	keys := []string{"final", "empty-suffix", "nested-block", "label", "branch", "switch", "nonfinal", "nonfinal-body-break", "nonfinal-body-value", "empty-switch"}
	for _, key := range keys {
		f.Add([]byte(key))
		f.Add([]byte(key + ":bounded"))
		f.Add([]byte(key + ":pattern"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		key := keys[choice]
		loop := "LOOP (const n of xs) {}"
		bodies := []string{
			loop, loop + "; {}; ;", "{ " + loop + " }", "label: " + loop,
			"if (flag) { " + loop + " } else { 1 }", "switch (1) { default: " + loop + "; break }",
			loop + "; 1", "label: { LOOP (const n of xs) { let x; break label }; 1 }",
			"label: { LOOP (const n of xs) { let x; x; break label }; 1 }", loop + "; switch (1) {}",
		}
		bad := choice < 6 || choice == 7
		limit := ""
		if len(tail) != 0 {
			limit = "(2)"
		}
		for _, head := range []string{"for concurrent" + limit, "for try", "for"} {
			source := "effect function f() { return do { " + strings.ReplaceAll(bodies[choice], "LOOP", head) + " } }"
			if strings.Contains(string(tail), "pattern") {
				source = strings.ReplaceAll(source, "const n of xs", "const { n } of xs")
			}
			file := parser.ParseSourceFile(ast.SourceFileParseOptions{FileName: "/main.vibe", PathKey: "/main.vibe"}, source, core.ScriptKindTS)
			ds := file.Diagnostics()
			valid := len(ds) == 0
			if bad {
				valid = len(ds) == 1 && ds[0].Source() == "EK" && ds[0].Code() == parser.DoEndsCode
			}
			if !valid {
				Gap(t, "FuzzDoConcurrentEnding", key+":"+head, "%s; want EK0201=%t, got %v\n%s", doConcurrentEndingQuote, bad, ds, source)
			}
		}
		ExpectPending(t, "FuzzDoConcurrentEnding", specCorpusKey(t))
	})
}
