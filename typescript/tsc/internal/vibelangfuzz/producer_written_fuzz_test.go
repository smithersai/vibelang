package vibelangfuzz

import (
	"context"
	"os"
	"strings"
	"testing"
)

const producerWrittenTarget = "FuzzProducerWrittenStream"
const producerWrittenQuote = "a written return type that is not a `Stream.Stream<A, E, R>`"

func producerWrittenChapter(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("002-running.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), producerWrittenQuote) {
		t.Fatalf("chapter 2 no longer says %q", producerWrittenQuote)
	}
}
func TestProducerWrittenStreamQuoted(t *testing.T) { producerWrittenChapter(t) }

// A producer with a written Stream return type compiles when its yields fit
// the element type and is TypeScript's mismatch when they do not; the
// declared type stays the written Stream (VIP-21).
func FuzzProducerWrittenStream(f *testing.F) {
	startShortBudget(f)
	producerWrittenChapter(f)
	sites := []struct {
		key, body, written string
		ok                 bool
	}{
		{"number", "yield 1; yield 2", "Stream.Stream<number>", true},
		{"string-three", "yield \"a\"", "Stream.Stream<string, never, never>", true},
		{"error-channel", "yield 1", "Stream.Stream<number, string>", true},
		{"bare-return", "yield 1; return", "Stream.Stream<number>", true},
		{"union", "yield 1; yield \"a\"", "Stream.Stream<number | string>", true},
		{"mismatch", "yield 1", "Stream.Stream<string>", false},
		{"mismatch-object", "yield { a: 1 }", "Stream.Stream<number>", false},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		f.Add([]byte(site.key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice := 0
		for i, key := range keys {
			if string(data) == key || strings.HasPrefix(string(data), key+":") {
				choice = i
			}
		}
		if choice == 0 && len(data) > 0 && string(data) != keys[0] {
			choice = int(data[0]) % len(keys)
		}
		site := sites[choice]
		source := "import { Stream } from \"effect\";\nexport effect function* p(): " + site.written + " { " + site.body + " }\nconst same: " + site.written + " = p()\nexport {}"
		r, err := w.Compile(context.Background(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer r.Remove()
		key := "rule:" + site.key
		if site.ok && HasError(r.Diagnostics) {
			Gap(t, producerWrittenTarget, key, "%s: a written Stream must be accepted with fitting yields\n%s\n%v", producerWrittenQuote, source, Keys(r.Dir, r.Diagnostics))
		}
		if !site.ok && !HasError(r.Diagnostics) {
			Gap(t, producerWrittenTarget, key, "a yield outside the written element type must be rejected\n%s", source)
		}
		ExpectPending(t, producerWrittenTarget, key)
		ExpectPending(t, producerWrittenTarget, specCorpusKey(t))
	})
}
