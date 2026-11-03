package vibelangfuzz

import (
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const yieldActivationQuote = "`yield` in nonproducer effect code (an `effect` function, arrow or block), whether or not an outer producer exists, or in directly evaluated formal-parameter initialization of an Effect callable or producer"

func requireYieldActivationQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), yieldActivationQuote) {
		t.Fatal("stale yield activation quote")
	}
}

func TestYieldActivationQuoted(t *testing.T) { requireYieldActivationQuote(t) }

// Source activations own yield. Generated do, catch-head and item functions
// do not supply a producer activation or reset the source parameter boundary.
func FuzzYieldActivation(f *testing.F) {
	startShortBudget(f)
	requireYieldActivationQuote(f)
	sites := []struct {
		key, source string
		code        int32
	}{
		{"function", "effect function f(){yield 1}", 2104},
		{"arrow", "const f=effect ()=>{yield 1}", 2104},
		{"block", "const f=effect {yield 1}", 2104},
		{"handler", "effect function f(){return Effect.fail(1) catch effect ()=>{yield 1}}", 2104},
		{"function-handler", "effect function f(){return Effect.fail(1) catch effect function(){yield 1}}", 2104},
		{"nested-block", "effect function* p(){const f=effect {yield 1};try f}", 2104},
		{"nested-arrow", "effect function* p(){const f=effect ()=>{yield 1};try f()}", 2104},
		{"nested-function", "effect function* p(){effect function f(){yield 1};try f()}", 2104},
		{"method", "const object={effect f(){yield 1}}", 2104},
		{"class-method", "class C{effect f(){yield 1}}", 2104},
		{"producer-default", "effect function* p(value=yield 1){yield value}", 2104},
		{"function-default", "effect function f(value=yield 1){return value}", 2104},
		{"arrow-default", "const f=effect (value=yield 1)=>value", 2104},
		{"binding-default", "effect function* p({value=yield 1}={}){yield value}", 2104},
		{"binding-key", "effect function* p({[(yield 1) as string]:value}:any){yield value}", 2104},
		{"do-default", "effect function* p(value=do {yield 1; 0}){yield value}", 2104},
		{"do-body", "effect function f(){return do {yield 1; 0}}", 2104},
		{"concurrent-body", "effect function f(){for concurrent(const n of [1]){yield n}}", 2104},
		{"stream-body", "effect function f(){for try(const n of Stream.make([1])){yield n}}", 2104},
		{"delegating-nonproducer", "effect function f(){yield* [1]}", 2104},
		{"producer", "effect function* p(){yield 1}", 0},
		{"producer-do", "effect function* p(){const value=do {yield 1; 0};yield value}", 0},
		{"producer-concurrent", "effect function* p(){for concurrent(const n of [1]){yield n}}", 0},
		{"native", "effect function f(){function* p():Generator<number,void,unknown>{yield 1};return 0}", 0},
		{"native-default", "function* p(value=yield 1):Generator<unknown,void,unknown>{yield value}", 2523},
		{"plain", "function f(){yield 1}", 1163},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
		f.Add([]byte(site.key + ":operand"))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, rest := keyedChoice(keys, data)
		site := sites[choice]
		source := "import {Effect,Stream} from \"effect\";\n" + site.source + "\nexport {}"
		// Mutate the operand without changing activation ownership; unrelated
		// missing-name diagnostics must survive the placement diagnostic.
		extra := len(rest) > 0 && rest[0]&1 != 0 && strings.Contains(source, "yield 1")
		if extra {
			source = strings.Replace(source, "yield 1", "yield missingOperand", 1)
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[int32]int{}
		identities := true
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
				if d.Code() == 2104 && !IsEK(d) {
					identities = false
				}
			}
		}
		expected := map[int32]int{}
		if site.code != 0 {
			expected[site.code] = 1
		}
		if extra {
			expected[2304] = 1
		}
		match := identities && len(got) == len(expected)
		for code, count := range expected {
			if got[code] != count {
				match = false
			}
		}
		if !match {
			Gap(t, "FuzzYieldActivation", site.key, "%s: want %v got %v\n%v\n%s", yieldActivationQuote, expected, got, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzYieldActivation", site.key)
	})
}
