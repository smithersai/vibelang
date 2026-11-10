package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const producerEnumYieldTarget = "FuzzProducerEnumYieldResult"
const producerEnumYieldQuote = "A `yield` expression belongs to a producer or native generator body of its own activation, as in JavaScript:"
const producerEnumBoundaryQuote = "not counting nested functions, class field or enum member initializers or `static` blocks"

func TestProducerEnumYieldResultQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerEnumYieldQuote)
	chapterSays(t, "002-running.md", producerEnumBoundaryQuote)
}

// The source activation rule leaves enum initialization with native yield
// diagnostics. The same enum in an ordinary generator is its native control.
func FuzzProducerEnumYieldResult(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", producerEnumYieldQuote)
	chapterSays(f, "002-running.md", producerEnumBoundaryQuote)
	type profile struct {
		key, source, expression string
		codes                   []int32
	}
	var profiles []profile
	var keys []string
	for _, form := range []struct{ key, source string }{
		{"declaration", "export $effectfunction* run(){BODY}"},
		{"expression", "export const run=$effectfunction*(){BODY}"},
		{"class-method", "export class Feed{$effect*run(){BODY}}"},
		{"object-method", "export const feed={$effect*run(){BODY}}"},
	} {
		for _, expression := range []struct {
			key, source string
			codes       []int32
		}{
			{"value", "(yield 1)", []int32{1163, 7057}},
			{"discarded", "((yield 1),1)", []int32{1163}},
			{"cast", "((yield 1) as number)", []int32{1163}},
			{"conditional", "true?(yield 1):1", []int32{1163, 7057}},
		} {
			key := form.key + ":" + expression.key
			profiles = append(profiles, profile{key, form.source, expression.source, expression.codes})
			keys = append(keys, key)
			for variant := uint8(0); variant < 8; variant++ {
				f.Add([]byte(key), variant)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, variant uint8) {
		chosen, _ := keyedChoice(keys, data)
		p := profiles[chosen]
		for _, producer := range []bool{false, true} {
			marker := ""
			if producer {
				marker = "effect "
			}
			expression := p.expression
			if variant&1 != 0 {
				expression = "(" + expression + ")"
			}
			source := strings.ReplaceAll(strings.ReplaceAll(p.source, "$effect", marker), "BODY", "enum E{A="+expression+"}")
			if variant&2 != 0 {
				source = strings.ReplaceAll(source, "yield ", "yield /* source */ ")
			}
			if variant&4 != 0 {
				source = strings.ReplaceAll(source, "{", "{\n")
			}
			result, err := w.Compile(t.Context(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			var got []int32
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					got = append(got, d.Code())
				}
			}
			result.Remove()
			slices.Sort(got)
			key := fmt.Sprintf("%s:producer=%t:variant=%d", p.key, producer, variant&7)
			if !slices.Equal(got, p.codes) {
				Gap(t, producerEnumYieldTarget, key, "%s; native enum wants %v, got %v\n%s", producerEnumYieldQuote, p.codes, got, source)
			}
			ExpectPending(t, producerEnumYieldTarget, key)
		}
		ExpectPending(t, producerEnumYieldTarget, specCorpusKey(t))
	})
}
