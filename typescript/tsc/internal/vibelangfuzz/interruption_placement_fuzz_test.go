package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const interruptionPlacementTarget = "FuzzInterruptionPlacement"
const interruptionPlacementQuote = "`uninterruptible { }`, `interruptible { }` or `restore { }` outside effect code, `function f() { uninterruptible { } }`; `EK2201` fires, not `EK2111`"

func TestInterruptionPlacementQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", interruptionPlacementQuote)
	chapterSays(t, "002-running.md", "A computed class key and an `extends` clause are effect code, as `await` is allowed there")
}

// Every plain activation rejects all three blocks, even under an outer mask.
// The matched effect activation is valid; a newline keeps the identifier plain.
func FuzzInterruptionPlacement(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "002-running.md", interruptionPlacementQuote)
	sites := []struct{ key, source string }{
		{"plain", "function f() { % }"},
		{"async", "async function f() { % }"},
		{"arrow", "const f = () => { % }"},
		{"nested", "effect function f() { uninterruptible { const g = () => { % } } }"},
		{"method", "effect function f() { class C { m() { % } } }"},
		{"field", "effect function f() { class C { n = do { %; 1 } } }"},
		{"static", "effect function f() { class C { static { % } } }"},
		{"parameter", "effect function f(n = do { %; 1 }) {}"},
		{"top", "%"},
		{"enum", "effect function f() { enum E { A = do { %; 1 } } }"},
	}
	keys := make([]string, len(sites))
	for i, site := range sites {
		keys[i] = site.key
		for word := byte(0); word < 3; word++ {
			f.Add([]byte(site.key + ":" + string([]byte{word})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		i, tail := keyedChoice(keys, data)
		b := byte(0)
		if len(tail) > 0 {
			b = tail[0]
		}
		word := []string{"uninterruptible", "interruptible", "restore"}[int(b)%3]
		body := word + " { }"
		if b&4 != 0 {
			body = "{ " + body + " }"
		}
		source := strings.Replace(sites[i].source, "%", body, 1)
		controls := []string{
			"effect function valid() { uninterruptible { " + body + " } }",
			"effect function computed() { const o = { [do { uninterruptible { }; \"m\" }]() {} }; class C { [do { interruptible { }; \"n\" }]() {} }; class D extends do { uninterruptible { }; (class {}) } {} }",
			"function names() { const " + word + " = 1; " + word + "\n{ }; return " + word + " }",
		}
		for j, input := range append([]string{source}, controls...) {
			r, err := w.Compile(t.Context(), Single(input))
			if err != nil {
				t.Fatal(err)
			}
			errors := []string{}
			placement := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors = append(errors, fmt.Sprint(d))
				if IsEK(d) && d.Code() == 2201 {
					placement++
				}
			}
			r.Remove()
			want := 0
			if j == 0 {
				want = 1
			}
			if placement != want || len(errors) != want {
				Gap(t, interruptionPlacementTarget, sites[i].key+":"+word, "%s; want %d EK2201 alone; got %v\n%s", interruptionPlacementQuote, want, errors, input)
				return
			}
		}
	})
}
