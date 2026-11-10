package vibelangfuzz

import (
	"fmt"
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerUnionTarget = "FuzzProducerUnionContract"

func TestProducerUnionContractQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerOverloadQuote)
	chapterSays(t, "002-running.md", producerOverloadNativeQuote)
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types")
}

// A callback contract admitting a Stream cannot become a native-generator
// contract because another callable or return alternative is an iterator.
func FuzzProducerUnionContract(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", producerOverloadQuote)
	contracts := []struct{ key, text string }{
		{"function-stream-first", "(()=>Stream.Stream<number>)|(()=>Generator<number,void,unknown>)"},
		{"function-generator-first", "(()=>Generator<number,void,unknown>)|(()=>Stream.Stream<number>)"},
		{"return-stream-first", "()=>Stream.Stream<number>|Generator<number,void,unknown>"},
		{"return-generator-first", "()=>Generator<number,void,unknown>|Stream.Stream<number>"},
		{"function-unknown", "(()=>Generator<number,void,unknown>)|(()=>unknown)"},
		{"function-object", "(()=>Generator<number,void,unknown>)|{}"},
		{"return-object", "()=>Generator<number,void,unknown>|{}"},
		{"return-unknown", "()=>Generator<number,void,unknown>|unknown"},
	}
	type site struct{ contract, shape string }
	var sites []site
	var keys []string
	for _, contract := range contracts {
		for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "alias", "method"} {
			key := contract.key + ":" + shape
			sites = append(sites, site{contract.text, shape})
			keys = append(keys, key)
			for _, variant := range []uint8{0, 1, 2, 3, 4, 8, 9, 10, 11, 12} {
				f.Add([]byte(key), variant)
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
		if native {
			marker = ""
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
		case "alias":
			prefix = marker + "function* p(){" + body + "};const alias=p;"
			argument = "alias"
		case "method":
			prefix = "const object={" + marker + "*p(){" + body + "}};"
			argument = "object.p"
		}
		source := "import {Stream} from \"effect\";declare function take(f:" + s.contract + "):number;" + prefix + "export const result:number=take(" + argument + ");"
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
			Gap(t, producerUnionTarget, key, "%s; want %v, got %v\n%s\n%v", producerOverloadQuote, want, got, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, producerUnionTarget, key)
		ExpectPending(t, producerUnionTarget, specCorpusKey(t))
	})
}
