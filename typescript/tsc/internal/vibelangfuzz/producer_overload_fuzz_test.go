package vibelangfuzz

import (
	"fmt"
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerOverloadTarget = "FuzzProducerCompatibleOverload"
const producerOverloadQuote = "`effect function*` returns a Stream, as `async function*` returns an AsyncIterable."
const producerOverloadNativeQuote = "A plain `function*` stays a JavaScript generator."

func TestProducerCompatibleOverloadQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerOverloadQuote)
	chapterSays(t, "002-running.md", producerOverloadNativeQuote)
	chapterSays(t, "001-functions.md", "Valid function/class overload signatures retain TypeScript’s ordinary rules.")
}

// A selected overload accepting a Stream callback retains the producer's
// source contract. Reordering unrelated generator overloads or grouping the
// argument cannot introduce a native-generator compatibility diagnostic.
func FuzzProducerCompatibleOverload(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", producerOverloadQuote)
	type site struct {
		target, shape string
		reverse       bool
	}
	var sites []site
	var keys []string
	for _, target := range []string{"Stream.Stream<number>", "unknown", "any"} {
		for _, reverse := range []bool{false, true} {
			for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "method"} {
				key := fmt.Sprintf("%s:reverse=%t:%s", target, reverse, shape)
				sites = append(sites, site{target, shape, reverse})
				keys = append(keys, key)
				for _, variant := range []uint8{0, 1, 2, 3, 4, 8, 9, 10, 11, 12} {
					f.Add([]byte(key), variant)
				}
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, variant uint8) {
		selected, _ := keyedChoice(keys, data)
		s := sites[selected]
		bodyIndex := int(variant&7) % 5
		body := []string{"yield 1", "yield 1;return", "yield 1;return undefined", "const value:number=\"bad\";yield 1", "yield absent;return"}[bodyIndex]
		native := variant&8 != 0
		marker := "effect "
		resultType := "number"
		if native {
			marker = ""
			resultType = "unknown"
		}
		if variant&64 != 0 {
			body = strings.ReplaceAll(body, "yield ", "yield /* value */ ")
		}
		literal := marker + "function*(){" + body + "}"
		prefix, argument := "", literal
		switch s.shape {
		case "wrapped":
			argument = "(" + literal + ")"
		case "declaration":
			prefix = marker + "function* p(){" + body + "};"
			argument = "p"
		case "variable":
			prefix = "const p=" + literal + ";"
			argument = "p"
		case "method":
			prefix = "const object={" + marker + "*p(){" + body + "}};"
			argument = "object.p"
		}
		accepted := "declare function take(f:()=>" + s.target + "):number;"
		generator := "declare function take(f:()=>Generator<number,void,unknown>):string;"
		overloads := accepted + generator
		if s.reverse {
			overloads = generator + accepted
		}
		source := "import {Stream} from \"effect\";" + overloads + prefix + "export const result:" + resultType + "=take(" + argument + ");"
		if variant&128 != 0 {
			source = strings.ReplaceAll(source, ";", ";\n")
		}
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got, want := map[int32]int{}, map[int32]int{}
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
			}
		}
		if !native && bodyIndex == 2 {
			want[2128]++
		}
		if bodyIndex == 3 {
			want[2322]++
		}
		if bodyIndex == 4 {
			want[2304]++
		}
		key := fmt.Sprintf("%s:body=%d:native=%t", keys[selected], bodyIndex, native)
		if !maps.Equal(got, want) {
			Gap(t, producerOverloadTarget, key, "%s; want %v, got %v\n%s\n%v", producerOverloadQuote, want, got, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, producerOverloadTarget, key)
		ExpectPending(t, producerOverloadTarget, specCorpusKey(t))
	})
}
