package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const producerConcurrentYieldTarget = "FuzzProducerConcurrentYield"
const producerConcurrentYieldQuote = "In a `for concurrent` body, each item's fiber offers its own elements, so elements arrive in offer order."

func producerConcurrentYieldChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), producerConcurrentYieldQuote) {
		t.Fatalf("stale producer/concurrent quote: %s", producerConcurrentYieldQuote)
	}
}
func TestProducerConcurrentYieldQuoted(t *testing.T) { producerConcurrentYieldChapter(t) }

// Concurrent item arrows are implementation boundaries. They contribute
// yields to the enclosing producer; a nested source callable is a boundary.
func FuzzProducerConcurrentYield(f *testing.F) {
	startShortBudget(f)
	producerConcurrentYieldChapter(f)
	sites := []struct {
		key, body, element string
		reject             bool
	}{
		{"unbounded", "for concurrent (const x of [1,2]) { yield x }", "number", false},
		{"bounded-one", "for concurrent(1) (const x of [1,2]) { yield x }", "number", false},
		{"bounded-two", "for concurrent(2) (const x of [1,2]) { yield x }", "number", false},
		{"nested-loops", "for concurrent(1) (const x of [1,2]) { for concurrent(1) (const y of [3,4]) { yield x+y } }", "number", false},
		{"around", "yield \"start\"; for concurrent(1) (const x of [1,2]) { yield x }; yield \"end\"", "string | number", false},
		{"tuple", "for concurrent(1) (const [key,value] of [[\"a\",1]] as [string,number][]) { yield key; yield value }", "string | number", false},
		{"object", "for concurrent(1) (const x of [1,2]) { yield {value:x} }", "{value:number}", false},
		{"run-effect", "for concurrent(1) (const x of [1,2]) { const n=try poll; yield n+x }", "number", false},
		{"continue", "for concurrent(1) (const x of [1,2]) { if(x===1) continue; yield x }", "number", false},
		{"native-generator-boundary", "for concurrent(1) (const x of [1,2]) { function* local():Generator<string> { yield \"local\" }; yield x }", "number", false},
		{"plain-function-boundary", "for concurrent(1) (const x of [1,2]) { function local() { yield x }; yield x }", "number", true},
		{"plain-arrow-boundary", "for concurrent(1) (const x of [1,2]) { const local=()=>{yield x}; yield x }", "number", true},
	}
	keys := []string{}
	for _, site := range sites {
		for _, form := range []string{"declaration", "expression"} {
			key := site.key + ":" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		site := sites[choice/2]
		source := "import {Effect,Stream} from \"effect\"; declare const poll:Effect.Effect<number>;\n"
		if choice%2 == 0 {
			source += "export effect function* p() { " + site.body + " }\n"
		} else {
			source += "export const p=effect function* () { " + site.body + " }\n"
		}
		if !site.reject {
			source += "const forward:Stream.Stream<" + site.element + ",never,never>=p();\nconst backward:ReturnType<typeof p>=null as unknown as Stream.Stream<" + site.element + ",never,never>;\n"
			source += "type IsAny<T>=0 extends (1&T)?true:false; type Element<S>=S extends Stream.Stream<infer A,infer E,infer R>?A:never; const precise:IsAny<Element<ReturnType<typeof p>>>=false;\n"
		}
		source += "export {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		hasError := HasError(r.Diagnostics)
		if hasError != site.reject {
			Gap(t, producerConcurrentYieldTarget, keys[choice], "%s; reject=%t, diagnostics=%v\n%s", producerConcurrentYieldQuote, site.reject, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, producerConcurrentYieldTarget, keys[choice])
		ExpectPending(t, producerConcurrentYieldTarget, specCorpusKey(t))
	})
}
