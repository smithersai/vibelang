package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const commaTryTarget = "FuzzTryCommaEffects"

var commaTryQuotes = []string{
	"`e` is an Effect when its type is assignable to `Effect.Effect<any, any, any>`.",
	"`try` works like `await`: it is a unary operator with `await`'s precedence, so `try a.b()` runs `a.b()` and `try f() + 1` adds 1 to the success.",
}

func requireTryCommaQuotes(t testing.TB) {
	t.Helper()
	text := SpecText("002-running.md")
	for _, q := range commaTryQuotes {
		if !strings.Contains(text, q) {
			t.Fatalf("stale comma try quote: %s", q)
		}
	}
}
func TestTryCommaEffectsQuoted(t *testing.T) { requireTryCommaQuotes(t) }
func FuzzTryCommaEffects(f *testing.F) {
	startShortBudget(f)
	requireTryCommaQuotes(f)
	rows := []struct {
		key, expr string
		code      int32
	}{
		{"effect", "Effect.succeed(1), Effect.succeed(2)", 0},
		{"held", "Effect.succeed(1), held", 0},
		{"three", "Effect.succeed(0), Effect.succeed(1), Effect.succeed(2)", 0},
		{"block", "Effect.succeed(1), effect { return 2 }", 0},
		{"failure", "Effect.succeed(1), Effect.fail(\"bad\")", 0},
		{"conditional", "Effect.succeed(1), flag ? held : Effect.succeed(3)", 0},
		{"asserted", "Effect.succeed(1), (held as Effect.Effect<number>)", 0},
		{"satisfies", "Effect.succeed(1), (held satisfies Effect.Effect<number>)", 0},
		{"any", "Effect.succeed(1), (held as any)", 0},
		{"config", "Effect.succeed(1), Config.String(\"KEY\")", 0},
		{"exit", "Effect.succeed(1), Exit.succeed(2)", 0},
		{"body-type", "Effect.succeed(1), effect { const bad: number = \"wrong\"; return bad }", 2322},
		{"left-error", "missing(), held", 2304},
		{"legacy-arrow", "() => 2", 4616},
		{"legacy-function", "function () { return 2 }", 4616},
		{"legacy-async", "async () => 2", 4616},
	}
	for _, r := range rows {
		for depth := 1; depth <= 4; depth++ {
			f.Add(fmt.Sprintf("%s:%d", r.key, depth))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		requireTryCommaQuotes(t)
		base, tail, _ := strings.Cut(key, ":")
		index := slices.IndexFunc(rows, func(r struct {
			key, expr string
			code      int32
		}) bool {
			return r.key == base
		})
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(rows)
		}
		depth, err := strconv.Atoi(tail)
		if err != nil || depth < 1 || depth > 4 {
			depth = 1
			if len(tail) > 0 {
				depth += int(tail[0]) % 4
			}
		}
		r := rows[index]
		operand := strings.Repeat("(", depth) + r.expr + strings.Repeat(")", depth)
		source := fmt.Sprintf("import { Effect, Config, Exit } from \"effect\";\nconst held=Effect.succeed(2);\nexport effect function probe(flag: boolean){ return try %s }\n", operand)
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		var want []int32
		if r.code != 0 {
			want = []int32{r.code}
		}
		slices.Sort(codes)
		if !slices.Equal(codes, want) {
			Gap(t, commaTryTarget, r.key, "%s; want %v got %v\n%s", commaTryQuotes[0], want, Keys(result.Dir, result.Diagnostics), source)
		}
		ExpectPending(t, commaTryTarget, r.key)
		ExpectPending(t, commaTryTarget, specCorpusKey(t))
	})
}
