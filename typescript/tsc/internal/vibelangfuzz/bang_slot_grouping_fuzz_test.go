package vibelangfuzz

import (
	"os"
	"strings"
	"testing"
)

// Chapter 1 reads A!E!R as Effect's Effect type and nothing more, so a slot's
// parentheses, which only the ! needs, must not reach the declaration: the !
// form and Effect.Effect written out, two programs the chapter says mean the
// same type, declare the same bytes (Smithers' Crypto bytes:
// Effect.Effect<(Format extends "bytes" ? Uint8Array : string), string>).
const bangSlotQuote = "`A!E!R` is a type alias for Effect's Effect type, nothing more."

var bangSlotShapes = []struct{ key, text string }{
	{"conditional", `T extends string ? 1 : 2`},
	{"union", `string | number`},
	{"intersection", `{ a: 1 } & { b: 2 }`},
	{"function", `() => void`},
	{"constructor", `new () => object`},
	{"keyof-grouped", `keyof ({ a: 1 } | { b: 2 })`},
	{"array-grouped", `(string | number)[]`},
	{"tuple", `[string, (number | boolean)?]`},
	{"typeof", `typeof globalThis`},
	{"nested-effect", `Effect.Effect<number, string>`},
	{"generic-exclude", `Exclude<T, string>`},
}

var bangSlots = []struct{ key, bang, written string }{
	{"success", `(%)!string`, `Effect.Effect<%, string>`},
	{"error", `number!(%)`, `Effect.Effect<number, %>`},
	{"requirement", `number!string!(%)`, `Effect.Effect<number, string, %>`},
	{"both", `(%)!(%)`, `Effect.Effect<%, %>`},
}

func bangSlotChapter(tb testing.TB) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		tb.Fatal(err)
	}
	if !strings.Contains(string(chapter), bangSlotQuote) {
		tb.Fatalf("chapter 1 no longer says %q", bangSlotQuote)
	}
}

func TestBangSlotGroupingQuoted(t *testing.T) { bangSlotChapter(t) }

func FuzzBangSlotGrouping(f *testing.F) {
	startShortBudget(f)
	bangSlotChapter(f)
	for i, shape := range bangSlotShapes {
		f.Add([]byte(shape.key + "/" + bangSlots[i%len(bangSlots)].key))
	}
	w := NewWorkspace(f)
	declare := func(t *testing.T, text string) string {
		r, err := w.Compile(t.Context(), Single("export type F<T> = "+text+"\n"))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		return r.Outputs["out/main.d.ts"]
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		si, bi := 0, 0
		if len(data) > 0 {
			si = int(data[0]) % len(bangSlotShapes)
		}
		if len(data) > 1 {
			bi = int(data[1]) % len(bangSlots)
		}
		for a, shape := range bangSlotShapes {
			for b, slot := range bangSlots {
				if string(data) == shape.key+"/"+slot.key {
					si, bi = a, b
				}
			}
		}
		shape, slot := bangSlotShapes[si], bangSlots[bi]
		bang := strings.ReplaceAll(slot.bang, "%", shape.text)
		written := strings.ReplaceAll(slot.written, "%", shape.text)
		got, want := declare(t, bang), declare(t, written)
		key := shape.key + "/" + slot.key
		if got != want {
			Gap(t, "FuzzBangSlotGrouping", key, "chapter 1: %s; %s declares:\n%s\nbut %s declares:\n%s", bangSlotQuote, bang, got, written, want)
			return
		}
		ExpectPending(t, "FuzzBangSlotGrouping", key)
		ExpectPending(t, "FuzzBangSlotGrouping", specCorpusKey(t))
	})
}
