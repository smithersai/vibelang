package vibelangfuzz

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const groupedTryTarget = "FuzzTryGroupedEffects"

var groupedTryQuotes = []string{
	"\x60effect { … }\x60 is an expression. It builds an Effect from the block without running it.",
	"\x60try e\x60 is \x60yield* e\x60. It runs \x60e\x60 and gives its success value.",
	"It runs now and gives its source block's normal completion value.",
}

func TestTryGroupedEffectsQuoted(t *testing.T) {
	requireTryGroupedQuotes(t)
}

func requireTryGroupedQuotes(t testing.TB) {
	t.Helper()
	text := SpecText("002-running.md")
	for _, quote := range groupedTryQuotes {
		if !strings.Contains(text, quote) {
			t.Fatalf("stale grouped try quote: %s", quote)
		}
	}
}

func FuzzTryGroupedEffects(f *testing.F) {
	startShortBudget(f)
	requireTryGroupedQuotes(f)
	rows := []struct {
		key, expr string
		code      int32
	}{
		{"block", "effect { return 7 }", 0},
		{"block-run", "effect { return try Effect.succeed(7) }", 0},
		{"block-throw", "effect { throw 'typed' }", 0},
		{"held", "held", 0},
		{"conditional", "true ? effect { return 7 } : Effect.succeed(8)", 0},
		{"do", "do { Effect.succeed(7) }", 0},
		{"asserted", "(effect { return 7 }) as Effect.Effect<number>", 0},
		{"satisfies", "(effect { return 7 }) satisfies Effect.Effect<number>", 0},
		{"plain-arrow", "() => 7", 4616},
		{"plain-function", "function () { return 7 }", 4616},
		{"async-arrow", "async () => 7", 4616},
		{"effect-arrow", "effect () => 7", 4616},
		{"effect-function", "effect function () { return 7 }", 4616},
		{"factory-call", "(effect () => 7)()", 0},
		{"body-type", "effect { const bad: number = 'wrong'; return bad }", 2322},
		{"body-call", "effect { return id('wrong') }", 2345},
	}
	for _, row := range rows {
		for depth := 1; depth <= 4; depth++ {
			f.Add(fmt.Sprintf("%s:%d", row.key, depth))
		}
	}
	f.Add("block:0")
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		requireTryGroupedQuotes(t)
		base, tail, _ := strings.Cut(key, ":")
		index := slices.IndexFunc(rows, func(row struct {
			key, expr string
			code      int32
		}) bool {
			return row.key == base
		})
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		depth, err := strconv.Atoi(tail)
		if err != nil || depth < 0 || depth > 4 {
			depth = 1
			if len(tail) > 0 {
				depth += int(tail[0]) % 4
			}
		}
		row := rows[index]
		if depth == 0 && row.key != "block" {
			depth = 1
		}
		operand := strings.Repeat("(", depth) + row.expr + strings.Repeat(")", depth)
		source := fmt.Sprintf("import { Effect } from \"effect\";\nfunction id(n: number) { return n }\nconst held = effect { return 7 };\nexport effect function probe() { return try %s }\n", operand)
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
		var want []int32
		if row.code != 0 {
			want = []int32{row.code}
		}
		slices.Sort(codes)
		if !slices.Equal(codes, want) {
			quote := groupedTryQuotes[0]
			if row.key == "do" {
				quote = groupedTryQuotes[2]
			}
			Gap(t, groupedTryTarget, row.key, "%s; want exact error codes %v, got %v\n%s", quote, want, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, groupedTryTarget, row.key)
		ExpectPending(t, groupedTryTarget, specCorpusKey(t))
	})
}
