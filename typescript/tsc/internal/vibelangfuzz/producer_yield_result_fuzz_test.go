package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const producerYieldResultQuote = "`yield x` evaluates to `undefined`"

func requireProducerYieldResultQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), producerYieldResultQuote) {
		t.Fatal("stale producer yield-result quote")
	}
}
func TestProducerYieldResultQuoted(t *testing.T) { requireProducerYieldResultQuote(t) }

func FuzzProducerYieldResult(f *testing.F) {
	startShortBudget(f)
	requireProducerYieldResultQuote(f)
	sites := []struct {
		key, body string
		reject    bool
	}{
		{"value", "const x = yield 1; const check:undefined=x", false},
		{"bare", "const x = yield; const check:undefined=x", false},
		{"negative-number", "const x = yield 1; const bad:number=x", true},
		{"not-any", "const x=yield 1; type IsAny<T>=0 extends(1&T)?true:false; const precise:IsAny<typeof x>=false", false},
		{"object", "const x=(yield {n:1}); x satisfies undefined", false},
		{"literal", "const x=yield (1 as const); const check:undefined=x", false},
		{"conditional", "const x=true?(yield 1):(yield 2); const check:undefined=x", false},
		{"assignment", "let x:undefined; x=yield 1", false},
		{"nested-block", "{ const x=yield 1; const check:undefined=x }", false},
		{"concurrent", "for concurrent (const id of [1]) { const x=yield id; const check:undefined=x }", false},
		{"mask", "uninterruptible { const x=yield 1; const check:undefined=x }", false},
	}
	keys := []string{}
	for _, site := range sites {
		for _, form := range []string{"declaration", "expression"} {
			key := site.key + ":" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	for _, key := range []string{"native-generator", "native-async-generator", "native-computed-method-name"} {
		keys = append(keys, key)
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		source := "import {Stream} from \"effect\";\n"
		reject := false
		if choice < len(sites)*2 {
			site := sites[choice/2]
			reject = site.reject
			if choice%2 == 0 {
				source += "effect function* p(){" + site.body + "}\n"
			} else {
				source += "const p=effect function* (){" + site.body + "}\n"
			}
		} else if keys[choice] == "native-generator" {
			source += "function* p():Generator<number,void,string>{const x:string=yield 1; x.toUpperCase()}\n"
		} else if keys[choice] == "native-async-generator" {
			source += "async function* p():AsyncGenerator<number,void,string>{const x:string=yield 1; x.toUpperCase()}\n"
		} else {
			source += "function* p():Generator<number,void,string>{const object={effect *[(yield 1) as string](){yield 2}};return}\n"
		}
		source += "export {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		mismatch := false
		other := false
		for _, d := range r.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if !IsEK(d) && d.Code() == 2322 {
				mismatch = true
			} else {
				other = true
			}
		}
		if other || mismatch != reject {
			Gap(t, "FuzzProducerYieldResult", keys[choice], "%s; reject=%t; diagnostics=%v\n%s", producerYieldResultQuote, reject, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzProducerYieldResult", keys[choice])
		ExpectPending(t, "FuzzProducerYieldResult", specCorpusKey(t))
	})
}
