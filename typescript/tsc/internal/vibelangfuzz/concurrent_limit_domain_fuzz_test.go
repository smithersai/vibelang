package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"testing"
)

const concurrentLimitDomainQuote = "a limit not assignable to Effect's `Types.Concurrency`"

func TestConcurrentLimitDomainQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", concurrentLimitDomainQuote)
	chapterSays(t, "900-appendices.md", "a `for concurrent` limit not assignable to `Types.Concurrency`")
}

// This target owns EK1907 identity and assignment-domain boundaries, not the
// independent runtime declaration's formerly missing unbounded union member.
func FuzzConcurrentLimitDomain(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", concurrentLimitDomainQuote)
	variants := []struct {
		key, prefix, limit string
		valid              bool
	}{
		{"string", "", "\"fast\"", false},
		{"wide-string", "const limit:string=\"unbounded\";", "limit", false},
		{"boolean", "", "true", false},
		{"null", "", "null", false},
		{"undefined", "", "undefined", false},
		{"void", "", "void 0", false},
		{"object", "", "({ concurrency:2 })", false},
		{"wrapped-object", "", "((({ concurrency:2 })))", false},
		{"wrapped-string", "", "((\"fast\"))", false},
		{"wrapped-undefined", "", "((undefined))", false},
		{"array", "", "[2]", false},
		{"symbol", "", "Symbol()", false},
		{"bigint", "", "2n", false},
		{"unknown", "const limit:unknown=2;", "limit", false},
		{"optional", "const limit=undefined as number|undefined;", "limit", false},
		{"union", "const limit=null as number|null;", "limit", false},
		{"function", "", "()=>2", false},
		{"generic", "function id<T>(x:T){return x};", "id(true)", false},
		{"number", "", "2", true},
		{"fractional", "", "1.5", true},
		{"negative", "", "-1", true},
		{"nan", "", "NaN", true},
		{"infinity", "", "Infinity", true},
		{"any", "const limit=undefined as any;", "limit", true},
		{"never", "const limit=undefined as never;", "limit", true},
		{"shadow-undefined", "const undefined=2;", "undefined", true},
		{"omitted", "", "", true},
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
		limit := ""
		if v.limit != "" {
			limit = "(" + v.limit + ")"
		}
		source := "export effect function main(){" + v.prefix + "for concurrent" + limit + " (const item of [1]){} }"
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		var errors []int32
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				errors = append(errors, d.Code())
			}
		}
		if v.valid {
			if len(errors) != 0 {
				Gap(t, "FuzzConcurrentLimitDomain", "admit:"+v.key, "valid concurrency operand has errors %v\n%s", errors, source)
			}
		} else if len(errors) != 1 || errors[0] != 1907 {
			Gap(t, "FuzzConcurrentLimitDomain", "diagnostic:"+v.key, "chapter2 requires exactly EK1907, got %v\n%s", errors, source)
		}
	})
}
