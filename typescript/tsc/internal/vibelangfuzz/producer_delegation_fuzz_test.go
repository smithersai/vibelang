package vibelangfuzz

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"strings"
	"testing"
)

const producerDelegationQuote = "`yield*` in a producer, `effect function* p() { yield* other() }`: no VIP specifies delegation"

func requireProducerDelegationQuote(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), producerDelegationQuote) {
		t.Fatal("stale producer delegation quote")
	}
}
func TestProducerDelegationQuoted(t *testing.T) { requireProducerDelegationQuote(t) }
func FuzzProducerDelegation(f *testing.F) {
	startShortBudget(f)
	requireProducerDelegationQuote(f)
	sites := []struct {
		key, body string
		extra     int32
	}{
		{"array", "yield* [1,2]", 0},
		{"string", "yield* \"ab\"", 0},
		{"stream", "yield* Stream.make(1)", 0},
		{"iterator", "function* native():Generator<number,void,unknown>{yield 1}; yield* native()", 0},
		{"readonly", "yield* values", 0},
		{"any", "yield* erased", 0},
		{"unknown", "yield* opaque", 0},
		{"noniterable", "yield* 42", 0},
		{"parenthesized", "yield* ([1] as ReadonlyArray<number>)", 0},
		{"mask", "uninterruptible {yield* [1]}", 0},
		{"do", "const ignored=do {yield* [1]; 0}", 0},
		{"inner-call", "yield* only(\"bad\")", 2345},
		{"missing-name", "yield* noSuchProducerOperand", 2304},
		{"inner-property", "yield* ({}).missing", 2339},
	}
	keys := []string{}
	for _, site := range sites {
		for _, form := range []string{"declaration", "expression"} {
			key := site.key + ":" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	for _, key := range []string{"native-array", "native-string", "native-async", "native-computed-name", "nested-native"} {
		keys = append(keys, key)
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		source := "import {Stream} from \"effect\"; declare const values:ReadonlyArray<number>; declare const erased:any; declare const opaque:unknown; function only(n:number):number[]{return [n]};\n"
		expected := map[int32]int{}
		if choice < len(sites)*2 {
			site := sites[choice/2]
			expected[2103] = 1
			if site.extra != 0 {
				expected[site.extra] = 1
			}
			if choice%2 == 0 {
				source += "effect function* p(){" + site.body + "}"
			} else {
				source += "const p=effect function* (){" + site.body + "}"
			}
		} else {
			switch keys[choice] {
			case "native-array":
				source += "function* p():Generator<number,void,unknown>{yield* [1,2]}"
			case "native-string":
				source += "function* p():Generator<string,void,unknown>{yield* \"ab\"}"
			case "native-async":
				source += "async function* p():AsyncGenerator<number,void,unknown>{yield* [1,2]}"
			case "native-computed-name":
				source += "function* key():Generator<never,string,unknown>{return \"m\"};function* p():Generator<number,void,string>{const object={effect [(yield* key()) as string](){return 2}};return}"
			case "nested-native":
				source += "effect function* p(){function* native():Generator<number,void,unknown>{yield* [1,2]};yield 3}"
			}
		}
		source += "\nexport {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := map[int32]int{}
		identities := true
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				got[d.Code()]++
				if (d.Code() == 2103) != IsEK(d) {
					identities = false
				}
			}
		}
		match := identities && len(got) == len(expected)
		for code, count := range expected {
			if got[code] != count {
				match = false
			}
		}
		if !match {
			Gap(t, "FuzzProducerDelegation", keys[choice], "%s; want%v got%v\n%v\n%s", producerDelegationQuote, expected, got, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, "FuzzProducerDelegation", keys[choice])
		ExpectPending(t, "FuzzProducerDelegation", specCorpusKey(t))
	})
}
