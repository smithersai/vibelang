package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const limitCommaGrammarQuote = "ForConcurrent = [+Effect] \"for\" \"concurrent\" (\"(\" AssignmentExpression \")\")? \"(\" ForDeclaration \"of\" AssignmentExpression \")\" Statement"

func requireLimitCommaGrammar(t testing.TB) {
	t.Helper()
	if !strings.Contains(SpecText("900-appendices.md"), limitCommaGrammarQuote) {
		t.Fatal("Appendix A changed its ForConcurrent AssignmentExpression limit; review this oracle")
	}
}
func TestConcurrentLimitCommaGrammarQuoted(t *testing.T) { requireLimitCommaGrammar(t) }

func FuzzConcurrentLimitCommaGrammar(f *testing.F) {
	startShortBudget(f)
	requireLimitCommaGrammar(f)
	rows := []struct {
		key, limit string
		bad        bool
	}{
		{"bad-call", "mark(1), 1", true},
		{"bad-comment", "mark(1), /* preserve */ 1", true},
		{"bad-newline", "mark(1),\n1", true},
		{"bad-three", "mark(1), mark(2), 1", true},
		{"bad-conditional", "(flag ? mark(1) : mark(2)), 1", true},
		{"grouped", "(mark(1), 1)", false},
		{"nested-grouped", "((mark(1), 1))", false},
		{"call-arguments", "choose(mark(1), 1)", false},
		{"object-members", "({ a: mark(1), b: 1 }).b", false},
		{"array-elements", "[mark(1), 1][1]", false},
	}
	for _, row := range rows {
		f.Add(row.key)
		// Vary source activations, whitespace and numeric call operands.
		for _, mutation := range []byte{0, 1, 2, 8, 9, 10} {
			f.Add(row.key + ":" + string([]byte{mutation}))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data string) {
		key, tail, _ := strings.Cut(data, ":")
		i := slices.IndexFunc(rows, func(r struct {
			key, limit string
			bad        bool
		}) bool {
			return r.key == key
		})
		if i < 0 {
			if len(data) == 0 {
				return
			}
			i = int(data[0]) % len(rows)
		}
		row := rows[i]
		limit := row.limit
		space := ""
		block := false
		if len(tail) != 0 {
			limit = strings.ReplaceAll(limit, "mark(1)", fmt.Sprintf("mark(%d)", int(tail[0])%5))
			space = []string{"", " ", "\n"}[int(tail[0])%3]
			block = tail[0]&8 != 0
		}
		body := fmt.Sprintf("for concurrent%s(%s) (const item of [1]) { }; return 0", space, limit)
		activation := "export effect function probe(flag: boolean) { " + body + " }"
		if block {
			activation = "export const probe = (flag: boolean) => effect { " + body + " }"
		}
		source := "import { Effect } from \"effect\";\nfunction mark(n: number) { return n }\nfunction choose(a: number, b: number) { return b }\n" + activation + "\n"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var codes []int32
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		if row.bad == (len(codes) == 0) {
			Gap(t, "FuzzConcurrentLimitCommaGrammar", row.key, "%s; reject bare comma=%v, got %v\n%s", limitCommaGrammarQuote, row.bad, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzConcurrentLimitCommaGrammar", row.key)
		ExpectPending(t, "FuzzConcurrentLimitCommaGrammar", specCorpusKey(t))
	})
}
