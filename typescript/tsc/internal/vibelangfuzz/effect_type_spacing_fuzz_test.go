package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Chapter 1 reads the ! that completes A!! as one token, then rescans from
// the next character, so an Effect type ending in !! may touch the token after
// it. The quote is read from the chapter at test time. The oracle compares the
// compiler with itself on two inputs the chapter says must agree: the spaced
// and the tight spelling of every tail the rule names, for each result type.
var effectTypeSpacingQuote = "the scanner reads that `!` as one token and rescans from the next character"

var effectTypeSpacingTails = []struct{ key, source string }{
	{"assign", "const v: %s!!%s= seven"},
	{"loose", "const v = seven as %s!!%s== seven"},
	{"strict", "const v = seven as %s!!%s=== seven"},
	{"arrow", "const v = effect (): %s!!%s=> seven"},
}

var effectTypeSpacingResults = []string{"number", "Box", "(number | string)", "Array<number>", "readonly number[]", "{ n: number }", "Box[\"n\"]"}

func effectTypeSpacingChapter(tb testing.TB) {
	if !strings.Contains(SpecText("001-functions.md"), effectTypeSpacingQuote) {
		tb.Fatalf("chapter 1 no longer says %q", effectTypeSpacingQuote)
	}
}

func TestEffectTypeSpacingQuoted(t *testing.T) { effectTypeSpacingChapter(t) }

func FuzzEffectTypeSpacing(f *testing.F) {
	startShortBudget(f)
	effectTypeSpacingChapter(f)
	for _, tail := range effectTypeSpacingTails {
		for i := range effectTypeSpacingResults {
			f.Add([]byte(fmt.Sprintf("%s:%d", tail.key, i)))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		tail, result := 0, 0
		key, index, keyed := strings.Cut(string(data), ":")
		if at := slices.IndexFunc(effectTypeSpacingTails, func(e struct{ key, source string }) bool { return e.key == key }); keyed && at >= 0 {
			tail = at
			if _, err := fmt.Sscan(index, &result); err != nil || result < 0 {
				result = 0
			}
			result %= len(effectTypeSpacingResults)
		} else if len(data) > 0 {
			tail = int(data[0]) % len(effectTypeSpacingTails)
			if len(data) > 1 {
				result = int(data[1]) % len(effectTypeSpacingResults)
			}
		}
		form := effectTypeSpacingTails[tail]
		typ := effectTypeSpacingResults[result]
		compile := func(space string) (string, []string) {
			line := fmt.Sprintf(form.source, typ, space)
			source := "type Box = { n: number }\ndeclare const seven: any\nexport effect function main() {\n  " + line + "\n  return v\n}\n"
			r, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []string
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, diagnosticKey(d))
				}
			}
			return r.Outputs["out/main.js"], codes
		}
		spaced, spacedCodes := compile(" ")
		if len(spacedCodes) != 0 || spaced == "" {
			Gap(t, "FuzzEffectTypeSpacing", "spaced:"+form.key, "the spaced control %q did not compile cleanly: %v", fmt.Sprintf(form.source, typ, " "), spacedCodes)
		}
		tight, tightCodes := compile("")
		if len(tightCodes) != 0 || spaced != tight {
			Gap(t, "FuzzEffectTypeSpacing", "tight:"+form.key, "chapter 1: %s; %q compiles differently without the space:\nspaced:\n%s\ntight (%v):\n%s", effectTypeSpacingQuote, fmt.Sprintf(form.source, typ, " "), spaced, tightCodes, tight)
			return
		}
		ExpectPending(t, "FuzzEffectTypeSpacing", "tight:"+form.key)
		ExpectPending(t, "FuzzEffectTypeSpacing", "spaced:"+form.key)
	})
}
