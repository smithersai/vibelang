package vibelangfuzz

import (
	"fmt"
	"maps"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerReturnCalleeTarget = "FuzzProducerReturnCallee"
const producerReturnCalleeQuote = "A producer permits bare `return`, but `return value` is `EK2128`"
const producerReturnNativeQuote = "A plain `function*` stays a JavaScript generator."

func TestProducerReturnCalleeQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerReturnCalleeQuote)
	chapterSays(t, "002-running.md", producerReturnNativeQuote)
	chapterSays(t, "007-tooling.md", "including independent errors in embedded expressions and types")
}

// The marker fixes the source callable's meaning. Changing an unrelated
// callee's resolution or adding parentheses cannot remove its return error.
// Native generators and nested returns retain their own rules.
func FuzzProducerReturnCallee(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", producerReturnCalleeQuote)
	chapterSays(f, "002-running.md", producerReturnNativeQuote)
	type site struct{ shape, callee string }
	var sites []site
	var keys []string
	for _, shape := range []string{"inline", "wrapped", "declaration", "variable", "alias", "method"} {
		for _, callee := range []string{"missing", "property", "optional", "any", "unknown"} {
			sites = append(sites, site{shape, callee})
			keys = append(keys, shape+":"+callee)
			f.Add([]byte(shape+":"+callee), uint8(0))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, variant uint8) {
		selected, _ := keyedChoice(keys, data)
		s := sites[selected]
		bodies := []string{"return 7", "return undefined", "return absentValue", "return", "function* inner(){return 7};yield 1;return"}
		bodyIndex := int(variant&7) % len(bodies)
		body := bodies[bodyIndex]
		native := variant&8 != 0
		if variant&64 != 0 {
			body = strings.ReplaceAll(body, "return ", "return /* value */ ")
		}
		source := producerCalleeSource(s.shape, s.callee, body, native)
		if variant&128 != 0 {
			source = strings.ReplaceAll(source, ";", ";\n")
		}
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := map[int32]int{}
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
			}
		}
		want := map[int32]int{}
		if !native && bodyIndex <= 2 {
			want[2128]++
		}
		if s.callee == "missing" || s.callee == "optional" {
			want[2304]++
		}
		if s.callee == "property" {
			want[2339]++
		}
		if bodyIndex == 2 {
			want[2304]++
		}
		key := fmt.Sprintf("%s:body=%d:native=%t", keys[selected], bodyIndex, native)
		if !maps.Equal(got, want) {
			Gap(t, producerReturnCalleeTarget, key, "%s; want %v, got %v\n%s\n%v", producerReturnCalleeQuote, want, got, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, producerReturnCalleeTarget, key)
		ExpectPending(t, producerReturnCalleeTarget, specCorpusKey(t))
	})
}

func producerCalleeSource(shape, callee, body string, native bool) string {
	marker := "effect "
	if native {
		marker = ""
	}
	literal := marker + "function*(){" + body + "}"
	prefix, argument := "", literal
	switch shape {
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
		prefix = "const methods={" + marker + "*p(){" + body + "}};"
		argument = "methods.p"
	}
	call := "missing(" + argument + ")"
	switch callee {
	case "property":
		prefix = "const holder={};" + prefix
		call = "holder.take(" + argument + ")"
	case "optional":
		call = "missing?.(" + argument + ")"
	case "any":
		prefix = "declare const take:any;" + prefix
		call = "take(" + argument + ")"
	case "unknown":
		prefix = "declare function take(f:unknown):void;" + prefix
		call = "take(" + argument + ")"
	}
	return "export {};" + prefix + call + ";"
}
