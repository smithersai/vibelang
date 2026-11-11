package vibelangfuzz

import (
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// FuzzOracleIsolation mutates the boundaries that must never silence an
// independent oracle: prose versus tokens, diagnostic file versus message,
// and one pending key versus other keys. It tests harness policy, not a
// compiler behavior used as its own specification.
func FuzzOracleIsolation(f *testing.F) {
	startShortBudget(f)
	for _, word := range []string{"layer is separate", "node_modules/effect", "contract:fixed", "readonly", "suggestion"} {
		f.Add(word, uint8(0))
	}
	f.Fuzz(func(t *testing.T, text string, selector uint8) {
		// Quote arbitrary bytes so no generated prose becomes source syntax.
		literal := strconv.Quote(text)
		expression := "const layer = " + literal + "; const value = layer " + []string{"as unknown", "satisfies unknown", "instanceof Object", "in Object", "as { value: number }", "satisfies { value: number }", "instanceof {}", "in {}"}[selector%8] + ";"
		if toolsHasLayerDeclaration(expression) {
			t.Fatal("an ordinary layer expression disabled tooling")
		}

		if toolsHasLayerDeclaration("const note = " + literal + ";\n") {
			t.Fatal("a string disabled tooling")
		}
		comment := "// layer " + strings.NewReplacer("\n", " ", "\r", " ", "\u2028", " ", "\u2029", " ").Replace(text) + "\nexport const n = 1\n"
		if toolsHasLayerDeclaration(comment) {
			t.Fatal("a comment disabled tooling")
		}
		line := "out/main.d.ts(1,1): error TS2694: " + literal + " refers to node_modules/effect"
		if !stockConsumerLineOwned(line, nil) {
			t.Fatal("a diagnostic message hid an emitted-declaration error")
		}
		if stockConsumerLineOwned("node_modules/pkg/index.d.ts(1,1): error TS2694: "+literal, nil) {
			t.Fatal("a package file was mistaken for emitted output")
		}
		category := []diagnostics.Category{diagnostics.CategoryError, diagnostics.CategoryWarning, diagnostics.CategorySuggestion, diagnostics.CategoryMessage}[selector%4]
		if CategoryMatches(DefaultUnknown, category) {
			t.Fatal("an unknown category default accepted a diagnostic")
		}
		feature := PendingEntry{Target: "FuzzX", Key: "feature:hang-" + strconv.Itoa(int(selector)), Owner: "compiler", Reason: "hang: omitted input"}
		if hangFeatureWitnessProblem([]PendingEntry{feature}, feature) == "" {
			t.Fatal("an unprobed hang exclusion escaped validation")
		}
		witness := PendingEntry{Target: feature.Target, Key: "corpus:hang", Owner: "compiler", Reason: "hang: " + feature.Key}
		if problem := hangFeatureWitnessProblem([]PendingEntry{feature, witness}, feature); problem != "" {
			t.Fatal(problem)
		}
		entries := []PendingEntry{{Target: "FuzzX", Key: []string{"contract:", "resolve:", "spread:", "exit:", "misspelt:"}[selector%5] + literal, Owner: "compiler"}}
		if unused := UnusedPending(entries, nil, func(string) bool { return true }, func(PendingEntry) bool { return false }); len(unused) != 1 {
			t.Fatal("an arbitrary stale pending key escaped XPASS")
		}
	})
}
