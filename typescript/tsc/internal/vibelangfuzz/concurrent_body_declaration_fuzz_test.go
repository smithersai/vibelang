package vibelangfuzz

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"testing"
)

const concurrentBodyDeclarationTarget = "FuzzConcurrentBodyDeclaration"
const concurrentBodyDeclarationQuote = `"(" ForDeclaration "of" AssignmentExpression ")" Statement`

func TestConcurrentBodyDeclarationQuoted(t *testing.T) {
	chapterSays(t, "900-appendices.md", concurrentBodyDeclarationQuote)
}

// The body of for concurrent and of for try is a Statement, as a for...of
// body is, so each loop reports TypeScript's TS1156 exactly where the native
// loop over the same body does: for a let, const or using declaration, an
// interface or a type alias that stands as the body, labeled or not, and for
// nothing else. Each input names a loop form and a body; its tail adds
// labels. The oracle is the native twin compiled beside it.
func FuzzConcurrentBodyDeclaration(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "900-appendices.md", concurrentBodyDeclarationQuote)
	loops := []struct{ key, head string }{
		{"concurrent", "for concurrent (const x of xs)"},
		{"concurrent-limit", "for concurrent(2) (const x of xs)"},
		{"concurrent-let", "for concurrent (let x of xs)"},
		{"concurrent-pattern", "for concurrent (const { n = 1 } of rows)"},
		{"stream", "for try (const x of stream)"},
	}
	bodies := []struct{ key, text string }{
		{"const", "const y = 1;"},
		{"let", "let y = 1;"},
		{"using", "using r = { [Symbol.dispose]() {} };"},
		{"interface", "interface I { a: number }"},
		{"type", "type T = number;"},
		{"block", "{ const y = 1; }"},
		{"class", "class C {}"},
		{"function", "function g() {}"},
		{"expression", "xs.length;"},
		{"if-const", "if (flag) { const y = 1; }"},
	}
	type site struct{ loop, body int }
	var sites []site
	var keys []string
	for l, loop := range loops {
		for b, body := range bodies {
			sites = append(sites, site{l, b})
			keys = append(keys, loop.key+"-"+body.key)
		}
	}
	for _, body := range bodies {
		f.Add([]byte("concurrent-" + body.key))
	}
	for _, loop := range loops[1:] {
		f.Add([]byte(loop.key + "-const"))
		f.Add([]byte(loop.key + "-type"))
	}
	f.Add([]byte("concurrent-const:\x01"))
	f.Add([]byte("concurrent-interface:\x02"))
	f.Add([]byte("stream-let:\x01"))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		choice, tail := keyedChoice(keys, data)
		s := sites[choice]
		body := bodies[s.body].text
		labels := 0
		if len(tail) > 0 {
			labels = int(tail[0]) % 3
		}
		for i := 0; i < labels; i++ {
			body = fmt.Sprintf("label%d: %s", i, body)
		}
		errors := func(head string) ([]string, string) {
			source := "import { Effect, Stream } from \"effect\";\n" +
				"export effect function f(xs: number[], rows: Array<{ n?: number }>, stream: Stream.Stream<number>, flag: boolean) {\n" +
				head + " " + body + "\n}"
			r, err := w.Compile(context.Background(), Single(source))
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			at := strings.Index(source, head) + len(head)
			var got []string
			for _, d := range r.Diagnostics {
				if !IsEK(d) && d.Code() == 1156 {
					got = append(got, fmt.Sprintf("%d+%d", d.Pos()-at, d.Len()))
				}
			}
			slices.Sort(got)
			return got, source
		}
		native, _ := errors("for (const x of xs)")
		got, source := errors(loops[s.loop].head)
		key := fmt.Sprintf("rule:%s:labels=%d", keys[choice], labels)
		if !slices.Equal(got, native) {
			Gap(t, concurrentBodyDeclarationTarget, key, "%s; the native loop reports TS1156 at %v, this loop at %v\n%s", concurrentBodyDeclarationQuote, native, got, source)
		}
		ExpectPending(t, concurrentBodyDeclarationTarget, key)
		ExpectPending(t, concurrentBodyDeclarationTarget, specCorpusKey(t))
	})
}
