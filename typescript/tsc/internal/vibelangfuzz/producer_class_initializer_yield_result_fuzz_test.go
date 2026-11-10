package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"strings"
	"testing"
)

const classInitializerYieldTarget = "FuzzProducerClassInitializerYieldResult"
const classInitializerYieldQuote = "A `yield` expression belongs to a producer or native generator body of its own activation, as in JavaScript:"
const classInitializerBoundaryQuote = "not counting nested functions, class field or enum member initializers or `static` blocks"

func TestProducerClassInitializerYieldResultQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", classInitializerYieldQuote)
	chapterSays(t, "002-running.md", classInitializerBoundaryQuote)
}

// Each class initializer keeps the ordinary generator's TypeScript checks.
// A written next-value contract and a computed name exercise both boundaries.
func FuzzProducerClassInitializerYieldResult(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", classInitializerYieldQuote)
	chapterSays(f, "002-running.md", classInitializerBoundaryQuote)
	type profile struct {
		key, source, body string
		want              []int32
		written           bool
	}
	var profiles []profile
	var keys []string
	for _, form := range []struct{ key, source string }{
		{"declaration", "export $effectfunction* run()$contract{BODY}"},
		{"expression", "export const run=$effectfunction*()$contract{BODY}"},
		{"class-method", "export class Feed{$effect*run()$contract{BODY}}"},
		{"object-method", "export const feed={$effect*run()$contract{BODY}}"},
	} {
		for _, home := range []struct {
			key, body string
			want      []int32
		}{
			{"instance-typed", "class C{value:number=(yield 1)}", []int32{1163}},
			{"instance-inferred", "class C{value=(yield 1)}", []int32{1163, 7057}},
			{"static-typed", "class C{static value:number=(yield 1)}", []int32{1163}},
			{"static-inferred", "class C{static value=(yield 1)}", []int32{1163, 7057}},
			{"accessor-typed", "class C{accessor value:number=(yield 1)}", []int32{1163}},
			{"accessor-inferred", "class C{accessor value=(yield 1)}", []int32{1163, 7057}},
			{"static-block-typed", "class C{static{const value:number=(yield 1)}}", []int32{1163}},
			{"static-block-inferred", "class C{static{const value=(yield 1)}}", []int32{1163, 7057}},
			{"computed-name", "class C{[((yield 1),\"method\")](){}}", nil},
		} {
			for _, written := range []bool{false, true} {
				key := fmt.Sprintf("%s:%s:written=%t", form.key, home.key, written)
				profiles = append(profiles, profile{key, form.source, home.body, home.want, written})
				keys = append(keys, key)
				for _, variant := range []uint8{0, 1, 2, 4} {
					f.Add([]byte(key), variant)
				}
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
			contract := ""
			want := slices.Clone(p.want)
			if p.written {
				contract = ":Generator<number,void,undefined>"
				if producer {
					contract = ":Stream.Stream<number>"
				}
				if len(want) != 0 {
					want = []int32{1163}
					if strings.Contains(p.key, "-typed:") {
						want = append(want, 2322)
					}
				}
			}
			body := p.body
			if variant&1 != 0 {
				body = strings.ReplaceAll(body, "(yield 1)", "((yield 1))")
			}
			source := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(p.source, "$effect", marker), "$contract", contract), "BODY", body)
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
			if !slices.Equal(got, want) {
				Gap(t, classInitializerYieldTarget, key, "%s; want %v, got %v\n%s", classInitializerYieldQuote, want, got, source)
			}
			ExpectPending(t, classInitializerYieldTarget, key)
		}
		ExpectPending(t, classInitializerYieldTarget, specCorpusKey(t))
	})
}
