package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const awaitUsingPlacementQuote = "`await`, `for await` or `await using` in effect code: an `effect` function, a producer or an `effect` block"
const awaitUsingBoundaryQuote = "\"Inside\" means the innermost enclosing function"

func TestAwaitUsingPlacementQuoted(t *testing.T) {
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{awaitUsingPlacementQuote, awaitUsingBoundaryQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 1 no longer says %q", quote)
		}
	}
}

var awaitUsingPlacementForms = []struct {
	key, source string
	count       int
}{
	{"function", "effect function f() { %s }", 1},
	{"expression", "const f = effect function () { %s }", 1},
	{"arrow", "const f = effect () => { %s }", 1},
	{"block", "const f = effect { %s }", 1},
	{"producer", "effect function* f() { %s; yield 1 }", 1},
	{"object-method", "const o = { effect f() { %s } }", 1},
	{"class-method", "class C { effect f() { %s } }", 1},
	{"region", "effect function f() { uninterruptible { %s } }", 1},
	{"loop-body", "effect function f() { for (const x of [1]) { %s } }", 1},
	{"loop-head", "effect function f() { for (%s of [resource]) {} }", 1},
	{"do", "effect function f() { const x = do { %s; 1 } }", 1},
	{"nested-effect", "async function outer() { effect function f() { %s } }", 1},
	{"async", "async function f() { %s }", 0},
	{"async-arrow", "const f = async () => { %s }", 0},
	{"nested-async", "effect function outer() { async function f() { %s } }", 0},
	{"nested-async-arrow", "effect function outer() { const f = async () => { %s } }", 0},
	{"async-method", "effect function outer() { const o = { async f() { %s } } }", 0},
	{"native-generator", "async function* f(): AsyncGenerator<number> { %s; yield 1 }", 0},
}

func FuzzAwaitUsingPlacement(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		f.Fatal(err)
	}
	for _, quote := range []string{awaitUsingPlacementQuote, awaitUsingBoundaryQuote} {
		if !strings.Contains(string(chapter), quote) {
			f.Fatalf("stale quote %q", quote)
		}
	}
	code := chapterCode(f, chapter, awaitUsingPlacementQuote)
	for _, form := range awaitUsingPlacementForms {
		f.Add([]byte(form.key), uint8(0))
	}
	for variant := uint8(1); variant < 9; variant++ {
		f.Add([]byte("function"), variant)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte, variant uint8) {
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(awaitUsingPlacementForms)
		}
		for i, form := range awaitUsingPlacementForms {
			if string(data) == form.key {
				choice = i
				break
			}
		}
		form := awaitUsingPlacementForms[choice]
		trivia := []string{" ", " /* dispose 😀 */ ", "\n"}[int(variant)%3]
		resource := []string{"resource", "null", "undefined"}[int(variant/3)%3]
		declaration := "await" + trivia + "using r"
		if form.key != "loop-head" {
			declaration += " = " + resource
		}
		source := "declare const resource: AsyncDisposable;\n" + fmt.Sprintf(form.source, declaration) + "\nexport {}"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		placement, legacy := 0, 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == code && d.Category() == diagnostics.CategoryError {
				placement++
				if got := d.File().Text()[d.Pos():d.End()]; got != "await" {
					t.Errorf("EK%04d span = %q; want await", code, got)
				}
			}
			if IsEK(d) && d.Code() == 1003 {
				legacy++
			}
			if form.count == 0 && d.Category() == diagnostics.CategoryError {
				t.Errorf("native async control rejected: %s", d.String())
			}
		}
		if placement != form.count || legacy != 0 {
			Gap(t, "FuzzAwaitUsingPlacement", "placement:"+form.key, "%s; %s; count=%d want=%d legacy=%d; source=%s; diagnostics=%v",
				awaitUsingPlacementQuote, awaitUsingBoundaryQuote, placement, form.count, legacy, source, Keys(result.Dir, result.Diagnostics))
		}
	})
}
