package vibelangfuzz

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"
)

const producerWrittenTarget = "FuzzProducerWrittenStream"
const producerWrittenQuote = "A written `Stream.Stream<A, E, R>` return contract checks each `yield x` against `A`, and the escaping errors and supplied requirements against `E` and `R`."

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
		code               string
	}{
		{"number", "yield 1; yield 2", "Stream.Stream<number>", ""},
		{"string-three", "yield \"a\"", "Stream.Stream<string, never, never>", ""},
		{"error-channel", "yield 1", "Stream.Stream<number, string>", ""},
		{"bare-return", "yield 1; return", "Stream.Stream<number>", ""},
		{"union", "yield 1; yield \"a\"", "Stream.Stream<number | string>", ""},
		{"mismatch", "yield 1", "Stream.Stream<string>", "TS2322"},
		{"mismatch-object", "yield { a: 1 }", "Stream.Stream<number>", "TS2322"},
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
		got, want := r4Errors(r.Diagnostics), []string{}
		if site.code != "" {
			want = append(want, site.code)
		}
		if !slices.Equal(got, want) {
			Gap(t, producerWrittenTarget, key, "%s; want %v, got %v\n%s", producerWrittenQuote, want, got, source)
		}
		ExpectPending(t, producerWrittenTarget, key)
		ExpectPending(t, producerWrittenTarget, specCorpusKey(t))
	})
}
