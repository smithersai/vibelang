package vibelangfuzz

import (
	"context"
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const doForTryTarget = "FuzzDoForTryDiagnosticOwner"
const doForTryReturnQuote = "`return` targeting the enclosing function in head binding initialization or the body"
const doForTryJumpQuote = "a labeled `break` or `continue` in head binding initialization or the body naming a statement that encloses the `for try`"

func TestDoForTryDiagnosticOwnerQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", doForTryReturnQuote)
	chapterSays(t, "002-running.md", doForTryJumpQuote)
}

// VIP-20 owns jumps forbidden in its per-item binding callback. A do
// implementation boundary must not replace EK2002/EK2003 with EK0204.
func FuzzDoForTryDiagnosticOwner(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", doForTryReturnQuote)
	chapterSays(f, "002-running.md", doForTryJumpQuote)
	type site struct {
		key, body string
		code      int32
	}
	var sites []site
	head := func(body string) string {
		return "outer: for (const m of [1]) { for try (const { n = do { " + body + " } } of Stream.fromIterable(rows)) { } }"
	}
	for _, jump := range []string{"return", "break", "continue"} {
		for depth := 0; depth <= 5; depth++ {
			statement := jump + " outer"
			expected := int32(2003)
			if jump == "return" {
				statement, expected = "return 7", 2002
			}
			body := "if (flag) " + statement + "; 7"
			for n := 0; n < depth; n++ {
				body = "(do { " + body + " }); 7"
			}
			sites = append(sites, site{fmt.Sprintf("%s-depth-%d", jump, depth), head(body), expected})
		}
	}
	sites = append(sites,
		site{"function-in-head", head("function read(): number { return 7 }; read()"), 0},
		site{"local-label-in-head", head("inside: { if (flag) break inside; 7 }; 8"), 0},
		site{"return-in-stream-operand", "for try (const n of do { if (flag) return 7; Stream.fromIterable([1]) }) { }", 0},
		site{"ordinary-loop-body", "outer: for (const m of [1]) { const v = do { if (flag) break outer; 7 } }", 0},
	)
	keys := make([]string, len(sites))
	for i, s := range sites {
		keys[i] = s.key
		f.Add([]byte(s.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		s := sites[choice]
		source := "import { Stream } from \"effect\"\nconst rows: { n?: number }[] = [{}]\nexport effect function main(flag: boolean) { " + s.body + "; return 0 }\n"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var wanted, other int
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if s.code != 0 && IsEK(d) && d.Code() == s.code {
				wanted++
			} else {
				other++
			}
		}
		expected := 0
		if s.code != 0 {
			expected = 1
		}
		key := "destination:" + s.key
		if wanted != expected || other != 0 {
			Gap(t, doForTryTarget, key, "%s; %s; want EK%04d x%d with no other error, got %v\n%s", doForTryReturnQuote, doForTryJumpQuote, s.code, expected, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, doForTryTarget, key)
		ExpectPending(t, doForTryTarget, specCorpusKey(t))
	})
}
