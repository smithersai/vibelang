package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const producerMethodLoweringTarget = "FuzzProducerMethodLowering"
const producerMethodLoweringQuote = "The shorthand `effect *name()` exists only for methods, as `async *gen()` does in TypeScript; at top level it could parse as multiplication."
const producerMethodChannelsQuote = "When it is not written, `A` is the union of the `yield` operands' types, widened as for an `async function*`, or `never` with no `yield`"

func TestProducerMethodLoweringQuoted(t *testing.T) {
	for _, quote := range []string{producerMethodLoweringQuote, producerMethodChannelsQuote} {
		if !strings.Contains(SpecText("002-running.md"), quote) {
			t.Fatalf("chapter 2 no longer says %q", quote)
		}
	}
}

type producerMethodLoweringRule struct{ key, source, call, want string }

func producerMethodLoweringRules() []producerMethodLoweringRule {
	return []producerMethodLoweringRule{
		{"instance", "class C { effect *values() { BODY } }", "new C().values()", "number"},
		{"public", "class C { public effect *values() { BODY } }", "new C().values()", "number"},
		{"static", "class C { static effect *values() { BODY } }", "C.values()", "number"},
		{"computed", "const key='values'; class C { effect *[key]() { BODY } }", "new C()[key]()", "number"},
		{"string", "class C { effect *'values'() { BODY } }", "new C().values()", "number"},
		{"numeric", "class C { effect *7() { BODY } }", "new C()[7]()", "number"},
		{"symbol", "const key=Symbol(); class C { effect *[key]() { BODY } }", "new C()[key]()", "number"},
		{"private", "class C { private effect *values() { BODY }; get() { return this.values() } }", "new C().get()", "number"},
		{"private-name", "class C { effect *#values() { BODY }; get() { return this.#values() } }", "new C().get()", "number"},
		{"protected-override", "class Base { protected effect *values() { BODY } }; class C extends Base { protected override effect *values() { BODY }; get() { return this.values() } }", "new C().get()", "number"},
		{"object", "const c={ effect *values() { BODY } }", "c.values()", "number"},
		{"object-computed", "const key='values'; const c={ effect *[key]() { BODY } }", "c[key]()", "number"},
		{"generic", "class C { effect *values<T>(value:T):Stream.Stream<T> { yield value; return } }", "new C().values(1)", "number"},
		{"destructuring", "class C { effect *values({n}:{n:number}) { yield n; BODY } }", "new C().values({n:1})", "number"},
		{"default", "class C { n=3; effect *values(n=this.n) { yield n; BODY } }", "new C().values()", "number"},
		{"rest", "class C { effect *values(...ns:number[]) { yield ns.length; BODY } }", "new C().values(1,2)", "number"},
		{"empty", "class C { effect *values() { return } }", "new C().values()", "never"},
		{"union", "class C { effect *values() { yield 's'; BODY } }", "new C().values()", "number|string"},
		{"channels", "class Required { tag='required' }; declare const poll:Effect.Effect<number,'bad',Required>; class C { effect *values() { yield try poll } }", "new C().values()", "number,'bad',Required"},
		{"native", "class C { *values() { yield 1; return } }; const native:Generator<number,void,unknown>=new C().values()", "", ""},
		{"native-annotated", "class C { *values():Generator<number,void,unknown> { yield 1; return } }; const native:Generator<number,void,unknown>=new C().values()", "", ""},
		{"native-async", "class C { async *values() { yield 1; return } }; const native:AsyncGenerator<number,void,unknown>=new C().values()", "", ""},
	}
}

// Method form chooses a Stream, independently of modifiers, names or parameter
// bindings. Check both assignability directions and reject an any element: a
// generator-shaped or accidentally erased result must not satisfy this oracle.
func FuzzProducerMethodLowering(f *testing.F) {
	startShortBudget(f)
	rules := producerMethodLoweringRules()
	for _, rule := range rules {
		f.Add(rule.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		i := slices.IndexFunc(rules, func(rule producerMethodLoweringRule) bool { return rule.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(rules)
		}
		rule := rules[i]
		body := fmt.Sprintf("yield %d; try Effect.void; yield %d", variant, int(variant)+1)
		source := "import {Effect,Stream} from \"effect\";\n" + strings.ReplaceAll(rule.source, "BODY", body)
		if rule.call != "" {
			source += "\nconst result=" + rule.call + "; const forward:Stream.Stream<" + rule.want + ">=result; const backward:typeof result=null as unknown as Stream.Stream<" + rule.want + ">;"
			source += "\ntype IsAny<T>=0 extends (1&T)?true:false; type Element<S>=S extends Stream.Stream<infer A,infer E,infer R>?A:never; const precise:IsAny<Element<typeof result>>=false;"
		}
		r, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		if HasError(r.Diagnostics) {
			Gap(t, producerMethodLoweringTarget, rule.key, "VIP-21: %s; expected precise Stream (or native generator control), got %v\n%s", producerMethodLoweringQuote, Keys(r.Dir, r.Diagnostics), source)
		}
		ExpectPending(t, producerMethodLoweringTarget, rule.key)
		ExpectPending(t, producerMethodLoweringTarget, specCorpusKey(t))
	})
}
