package vibelangfuzz

import (
	"context"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const concurrentUnboundedQuote = "`n` is any Effect `Concurrency`"

func TestConcurrentUnboundedLimitQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentUnboundedQuote)
}

// The accepted unbounded operand must work in each ordinary typing context.
// Diagnostic ownership for invalid limits is covered separately by the chapter
// rule tests; this target covers the valid-domain regression.
func FuzzConcurrentUnboundedLimit(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", concurrentUnboundedQuote)
	variants := []struct{ key, source string }{
		{"literal", "effect function f(){for concurrent(\"unbounded\") (const x of [1]){}}"},
		{"const", "const limit=\"unbounded\" as const; effect function f(){for concurrent(limit) (const x of [1]){}}"},
		{"parameter", "effect function f(limit:Types.Concurrency){for concurrent(limit) (const x of [1]){}}"},
		{"alias", "type Limit=Types.Concurrency; effect function f(limit:Limit){for concurrent(limit) (const x of [1]){}}"},
		{"generic", "effect function f<C extends Types.Concurrency>(limit:C){for concurrent(limit) (const x of [1]){}}"},
		{"property", "effect function f(){const options:{limit:Types.Concurrency}={limit:\"unbounded\"};for concurrent(options.limit) (const x of [1]){}}"},
		{"conditional", "effect function f(flag:boolean){for concurrent(flag?2:\"unbounded\") (const x of [1]){}}"},
		{"comma", "effect function f(){let evaluated=0;for concurrent((evaluated++,\"unbounded\")) (const x of [1]){}}"},
		{"number-control", "effect function f(limit:number){for concurrent(limit) (const x of [1]){}}"},
		{"omitted-control", "effect function f(){for concurrent (const x of [1]){}}"},
	}
	keys := make([]string, len(variants))
	for i, v := range variants {
		keys[i] = v.key
		f.Add([]byte(v.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, _ := keyedChoice(keys, data)
		v := variants[i]
		source := "import type {Types} from \"effect\";\n" + v.source
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzConcurrentUnboundedLimit", "admit:"+v.key, "%s; valid native concurrency must compile, got %v\n%s", concurrentUnboundedQuote, Keys(r.Dir, r.Diagnostics), source)
			}
		}
	})
}
