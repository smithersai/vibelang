package vibelangfuzz

import (
	"context"
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const restoreComputedNamesQuote = "A computed class key and an `extends` clause are effect code"
const restoreComputedMaskQuote = "Resolve `restore` in the same source activation as its lexical mask."

func TestRestoreComputedNamesQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", restoreComputedNamesQuote)
	chapterSays(t, "002-running.md", restoreComputedMaskQuote)
}

func FuzzRestoreComputedNames(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", restoreComputedNamesQuote)
	chapterSays(f, "002-running.md", restoreComputedMaskQuote)
	key := "[(do {restore {}}, \"m\" as const)]"

	sites := []struct{ key, body, kind string }{
		{"object-method", "const o={" + key + "(){return 1}}", "inline"},
		{"object-number", "const o={[(do {restore {}},1)](){return 1}}", "inline"},
		{"object-symbol", "const name=Symbol();const o={[(do {restore {}},name)](){return 1}}", "inline"},
		{"class-method", "class C {" + key + "(){return 1}}", "inline"},
		{"class-number", "class C {[(do {restore {}},1)](){return 1}}", "inline"},
		{"class-symbol", "const name=Symbol();class C {[(do {restore {}},name)](){return 1}}", "inline"},
		{"class-static", "class C {static " + key + "(){return 1}}", "inline"},
		{"class-expression", "const C=class {" + key + "(){return 1}}", "inline"},
		{"class-heritage", "class Base{};class C extends (do {restore {}}, Base){}", "inline"},
		{"interruptible-name", "interruptible {const o={" + key + "(){return 1}}}", "inline"},
		{"inner-mask-name", "uninterruptible {const o={" + key + "(){return 1}}}", "own"},
		{"method-body", "const o={effect m(){restore {}}}", "boundary"},
		{"method-own-mask", "const o={effect m(){uninterruptible{restore {}}}}", "own"},
	}
	keys := []string{}
	for _, site := range sites {
		for _, mode := range []string{"masked", "unmasked"} {
			k := site.key + ":" + mode
			keys = append(keys, k)
			f.Add([]byte(k))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, _ := keyedChoice(keys, data)
		site := sites[choice/2]
		masked := choice%2 == 0
		body := site.body
		if masked {
			body = "uninterruptible {" + body + "}"
		}
		source := "import {Effect} from \"effect\";effect function f(){" + body + "};export {}"
		want := int32(0)
		if site.kind == "boundary" && masked {
			want = 2202
		} else if site.kind != "own" && !masked {
			want = 2111
		}
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		got := []string{}
		for _, d := range r.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				prefix := "TS"
				if IsEK(d) {
					prefix = "EK"
				}
				got = append(got, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
		}
		expected := []string{}
		if want != 0 {
			expected = append(expected, fmt.Sprintf("EK%d", want))
		}
		if fmt.Sprint(got) != fmt.Sprint(expected) {
			Gap(t, "FuzzRestoreComputedNames", keys[choice], "%s; want%v got%v\n%s\n%v", restoreComputedMaskQuote, expected, got, source, Keys(r.Dir, r.Diagnostics))
		}
		ExpectPending(t, "FuzzRestoreComputedNames", keys[choice])
		ExpectPending(t, "FuzzRestoreComputedNames", specCorpusKey(t))
	})
}
