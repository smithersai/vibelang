package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

func TestCarriedPlainHandlerNoThrowQuoted(t *testing.T) {
	text := SpecText("../vips/0004-throw.md")
	if !strings.Contains(text, "If you throw in vibelang itself in a sync function that's an error.") {
		t.Fatalf("VIP-4 no longer says %q", "If you throw in vibelang itself in a sync function that's an error.")
	}
}

// The oracle follows the accepted VIP-4 ruling, not current compiler output.
// Each keyed seed has one rejected source operation; pending keys retain XPASS.
func FuzzCarriedPlainHandlerNoThrow(f *testing.F) {
	startShortBudget(f)
	programs := map[string]string{
		"direct": "import { Effect } from \"effect\";\nexport effect function rejected() { return Effect.fail(\"missing\") catch (error) => { throw error } }",
		"caught": "import { Effect } from \"effect\";\nexport effect function rejected() { return Effect.fail(\"missing\") catch (error) => { try { throw error } catch { return \"fallback\" } } }",
	}
	keys := []string{"direct", "caught"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		TestCarriedPlainHandlerNoThrowQuoted(t)
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
		g := &Gaps{Target: "FuzzCarriedPlainHandlerNoThrow"}
		if countCode(result.Diagnostics, 401) != 1 {
			g.Add("feature:"+key, "VIP-4 requires EK0401 for this source operation; got %v\n%s", SortedKeys(Keys(result.Dir, result.Diagnostics)), programs[key])
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
