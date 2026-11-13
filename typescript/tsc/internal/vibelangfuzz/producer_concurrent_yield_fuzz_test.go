package vibelangfuzz

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"
)

const producerConcurrentYieldTarget = "FuzzProducerConcurrentYield"
const producerConcurrentYieldQuote = "A `yield` expression belongs to a producer or native generator body of its own activation, as in JavaScript: a nested callable cannot yield through an outer producer."

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
		code               string
	}{
		{"unbounded", "for concurrent (const x of [1,2]) { yield x }", "number", ""},
		{"bounded-one", "for concurrent(1) (const x of [1,2]) { yield x }", "number", ""},
		{"bounded-two", "for concurrent(2) (const x of [1,2]) { yield x }", "number", ""},
		{"nested-loops", "for concurrent(1) (const x of [1,2]) { for concurrent(1) (const y of [3,4]) { yield x+y } }", "number", ""},
		{"around", "yield \"start\"; for concurrent(1) (const x of [1,2]) { yield x }; yield \"end\"", "string | number", ""},
		{"tuple", "for concurrent(1) (const [key,value] of [[\"a\",1]] as [string,number][]) { yield key; yield value }", "string | number", ""},
		{"object", "for concurrent(1) (const x of [1,2]) { yield {value:x} }", "{value:number}", ""},
		{"run-effect", "for concurrent(1) (const x of [1,2]) { const n=try poll; yield n+x }", "number", ""},
		{"continue", "for concurrent(1) (const x of [1,2]) { if(x===1) continue; yield x }", "number", ""},
		{"native-generator-boundary", "for concurrent(1) (const x of [1,2]) { function* local():Generator<string> { yield \"local\" }; yield x }", "number", ""},
		{"plain-function-boundary", "for concurrent(1) (const x of [1,2]) { function local() { yield x }; yield x }", "number", "TS1163"},
		{"plain-arrow-boundary", "for concurrent(1) (const x of [1,2]) { const local=()=>{yield x}; yield x }", "number", "TS1163"},
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
		if site.code == "" {
			source += "const forward:Stream.Stream<" + site.element + ",never,never>=p();\nconst backward:ReturnType<typeof p>=null as unknown as Stream.Stream<" + site.element + ",never,never>;\n"
			source += "type IsAny<T>=0 extends (1&T)?true:false; type Element<S>=S extends Stream.Stream<infer A,infer E,infer R>?A:never; const precise:IsAny<Element<ReturnType<typeof p>>>=false;\n"
		}
		source += "export {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got, want := r4Errors(r.Diagnostics), []string{}
		if site.code != "" {
			want = append(want, site.code)
		}
		if !slices.Equal(got, want) {
			Gap(t, producerConcurrentYieldTarget, keys[choice], "%s; want %v, got %v\n%s", producerConcurrentYieldQuote, want, got, source)
		}
		ExpectPending(t, producerConcurrentYieldTarget, keys[choice])
		ExpectPending(t, producerConcurrentYieldTarget, specCorpusKey(t))
	})
}
