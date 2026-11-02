package vibelangfuzz

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"slices"
	"testing"
)

const producerContractTarget = "FuzzProducerWrittenContracts"
const producerContractQuote = "The return type, when written, is `Stream.Stream<A, E, R>`"

func producerContractVIP(t testing.TB) {
	t.Helper()
	chapterSays(t, "002-running.md", producerContractQuote)
}
func TestProducerWrittenContractsQuoted(t *testing.T) { producerContractVIP(t) }

// The public Stream contract is independent of the native generator contract
// used to check the body. Both declarations and function expressions obey it.
func FuzzProducerWrittenContracts(f *testing.F) {
	startShortBudget(f)
	producerContractVIP(f)
	domains := []struct{ key, contract, body, code string }{
		{"direct", "Stream.Stream<number>", "yield 7", ""},
		{"alias", "Numbers", "yield 7", ""},
		{"readonly-alias", "ReadonlyNumbers", "yield 7", ""},
		{"picked-alias", "PickedNumbers", "yield 7", ""},
		{"inherited-alias", "InheritedNumbers", "yield 7", ""},
		{"normalized", "Stream.Stream<number> | never", "yield 7", ""},
		{"success-union", "Stream.Stream<number | string>", "yield 7; yield \"x\"", ""},
		{"any", "any", "yield 7", "EK2102"},
		{"unknown", "unknown", "yield 7", "EK2102"},
		{"never", "never", "yield 7", "EK2102"},
		{"optional", "Stream.Stream<number> | undefined", "yield 7", "EK2102"},
		{"container-union", "Stream.Stream<number> | Stream.Stream<string>", "yield 7", "EK2102"},
		{"object", "{}", "yield 7", "EK2102"},
		{"array", "number[]", "yield 7", "EK2102"},
		{"promise", "Promise<number>", "yield 7", "EK2102"},
		{"effect", "Effect.Effect<number>", "yield 7", "EK2102"},
		{"iterator", "Generator<number>", "yield 7", "EK2102"},
		{"async-iterator", "AsyncGenerator<number>", "yield 7", "EK2102"},
		{"void", "void", "yield 7", "EK2102"},
		{"bad-yield", "Stream.Stream<number>", "yield \"wrong\"", "TS2322"},
		{"bad-error", "Stream.Stream<number>", "try Effect.fail(\"bad\"); yield 7", "EK9201"},
		{"bad-requirement", "Stream.Stream<number>", "yield try needsA", "EK9202"},
		{"good-error", "Stream.Stream<number, string>", "try Effect.fail(\"bad\"); yield 7", ""},
		{"good-requirement", "Stream.Stream<number, never, A>", "yield try needsA", ""},
		{"supplied-scope", "Stream.Stream<number>", "yield try scoped", ""},
		{"supplied-scope-union", "Stream.Stream<number, never, A>", "yield try scopedA", ""},
		{"contextual-object", "Stream.Stream<{kind:\"x\"}>", "yield {kind:\"x\"}", ""},
		{"nested-native", "Stream.Stream<number>", "function* nested(): Generator<string> { yield \"x\" }; yield 7", ""},
	}
	keys := make([]string, 0, len(domains)*2)
	for _, site := range domains {
		for _, form := range []string{"declaration", "expression"} {
			key := site.key + ":" + form
			keys = append(keys, key)
			f.Add([]byte(key))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		site := domains[choice/2]
		source := "import {Effect,Scope,Stream} from \"effect\";\ninterface A {readonly a:number}; type Numbers=Stream.Stream<number>; type ReadonlyNumbers=Readonly<Stream.Stream<number>>; type PickedNumbers=Pick<Stream.Stream<number>,keyof Stream.Stream<number>>; interface InheritedNumbers extends Stream.Stream<number> {} declare const needsA:Effect.Effect<number,never,A>; declare const scoped:Effect.Effect<number,never,Scope.Scope>; declare const scopedA:Effect.Effect<number,never,Scope.Scope|A>;\n"
		if choice%2 == 0 {
			source += "export effect function* values(): " + site.contract + " { " + site.body + " }\n"
		} else {
			source += "export const values=effect function* (): " + site.contract + " { " + site.body + " }\n"
		}
		source += "export {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		actual := []string{}
		for _, diagnostic := range r.Diagnostics {
			if diagnostic.Category() != diagnostics.CategoryError {
				continue
			}
			source := diagnostic.Source()
			if source == "" {
				source = "TS"
			}
			actual = append(actual, diagnosticCodeName(source, diagnostic.Code()))
		}
		slices.Sort(actual)
		want := []string{}
		if site.code != "" {
			want = append(want, site.code)
		}
		if !slices.Equal(actual, want) {
			Gap(t, producerContractTarget, keys[choice], "%s; want %v, got %v\n%s\n%v", producerContractQuote, want, actual, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, producerContractTarget, keys[choice])
		ExpectPending(t, producerContractTarget, specCorpusKey(t))
	})
}
