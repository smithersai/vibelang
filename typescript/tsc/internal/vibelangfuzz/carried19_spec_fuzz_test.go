package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestCarriedSourceThrowsTagsQuoted(t *testing.T) {
	text := SpecText("../vips/0004-throw.md")
	// Both public wordings forbid the same source contract; the second is
	// the accepted simplified VIP that replaces the expanded chapter.
	for _, quote := range []string{"(in a `.vibe` file every such tag is `EK0406`)", "a written `@throws` or `@rethrows` in a `.vibe` file is `EK0406`."} {
		if strings.Contains(text, quote) {
			return
		}
	}
	t.Fatal("VIP-4 no longer forbids source throws tags")
}

// The oracle follows the accepted VIP-4 ruling, not current compiler output.
// Each keyed seed has one rejected source operation; pending keys retain XPASS.
func FuzzCarriedSourceThrowsTags(f *testing.F) {
	startShortBudget(f)
	programs := map[string]string{
		"function":      "/** @throws {Error} */\nexport function local() { return 1 }",
		"rethrows":      "/** @rethrows callback */\nexport function local(callback: () => number) { return 1 }",
		"service":       "service Port { static readonly key = \"carried19/Port\"; /** @throws {Error} */\nread: () => number }\nexport {}",
		"function-type": "export type Reader = { /** @throws {Error} */ (): number }",
	}
	keys := []string{"function", "rethrows", "service", "function-type"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestCarriedSourceThrowsTagsQuoted(t)
		key := keys[0]
		if slices.Contains(keys, string(data)) {
			key = string(data)
		} else if len(data) > 0 {
			key = keys[int(data[0])%len(keys)]
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": programs[key]}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		g := &Gaps{Target: "FuzzCarriedSourceThrowsTags"}
		if countCode(result.Diagnostics, 406) != 1 {
			g.Add("feature:"+key, "VIP-4 requires EK0406 for this source operation; got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), programs[key])
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
