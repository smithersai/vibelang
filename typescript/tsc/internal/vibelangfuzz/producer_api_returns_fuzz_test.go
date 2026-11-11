package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

const producerAPIReturnTarget = "FuzzProducerAPIReturns"
const producerAPIReturnQuote = "A producer permits bare `return`, but `return value` is `EK2128`"
const producerAPINativeQuote = "A plain `function*` stays a JavaScript generator."

func TestProducerAPIReturnsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", producerAPIReturnQuote)
	chapterSays(t, "002-running.md", producerAPINativeQuote)
}

// Each key fixes an API, argument spelling, return owner and producer marker.
// The mutation byte changes only trivia. The oracle counts the explicit
// producers owning valued returns, never the contextual generator type.
func FuzzProducerAPIReturns(f *testing.F) {
	startShortBudget(f)
	apis := []struct{ key, call string }{
		{"custom", "take(ARG)"}, {"gen", "Effect.gen(ARG)"},
		{"fn", "Effect.fnUntraced(ARG)"}, {"named-fn", "Effect.fn(\"read\")(ARG)"},
	}
	bodies := []struct {
		key, source string
		own, nested int
	}{
		{"value", "return 1", 1, 0}, {"undefined", "return undefined", 1, 0},
		{"void", "return void 0", 1, 0}, {"conditional", "if (true) return 1", 1, 0},
		{"two", "if (true) return 1;return 2", 2, 0},
		{"bare", "yield 1;return", 0, 0},
		{"function", "const f=()=>{return 1};void f;return", 0, 0},
		{"generator", "function* inner(){return 1};return", 0, 0},
		{"producer", "effect function* inner(){return 1};return", 0, 1},
	}
	type rule struct {
		key, source string
		want        int
	}
	var rules []rule
	for _, api := range apis {
		for _, home := range []string{"inline", "named", "alias"} {
			for _, body := range bodies {
				for _, producer := range []bool{true, false} {
					marker, kind, want := "", "native", body.nested
					if producer {
						marker, kind = "effect ", "producer"
						want += body.own
					}
					pre := "import {Effect} from \"effect\";declare function take(body:()=>Generator<number,void,unknown>):void;"
					arg := marker + "function*(){" + body.source + "}"
					if home != "inline" {
						pre += marker + "function* producer(){" + body.source + "};"
						arg = "producer"
						if home == "alias" {
							pre += "const alias=producer;"
							arg = "alias"
						}
					}
					rules = append(rules, rule{api.key + "-" + home + "-" + body.key + "-" + kind, pre + strings.ReplaceAll(api.call, "ARG", arg), want})
				}
			}
		}
	}
	for _, r := range rules {
		f.Add(r.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, trivia uint8) {
		TestProducerAPIReturnsQuoted(t)
		i := slices.IndexFunc(rules, func(r rule) bool { return r.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		r := rules[i]
		source := strings.Repeat("/* return 9; */\n", int(trivia)%4) + r.source
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 2128 {
				got++
			}
		}
		if got != r.want {
			Gap(t, producerAPIReturnTarget, r.key, "%s; %s; want EK2128 x%d, got x%d\n%s\n%v", producerAPIReturnQuote, producerAPINativeQuote, r.want, got, source, Keys(result.Dir, result.Diagnostics))
		}
		ExpectPending(t, producerAPIReturnTarget, r.key)
		ExpectPending(t, producerAPIReturnTarget, specCorpusKey(t))
	})
}
