package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const awaitPlacementQuote = "`await`, `for await` or `await using` in effect code:"

func TestAwaitAdvisoryPlacementQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), awaitPlacementQuote) {
		t.Fatalf("VIP-1 no longer says %q", awaitPlacementQuote)
	}
	TestCurrentDiagnosticPolicyQuoted(t)
	for _, quote := range []string{"| `EK4609` | lint warning: `await` on a `Fiber` in an `async` function;", "| `EK4610` | lint warning: `await` on a `Deferred` in an `async` function;"} {
		if !strings.Contains(SpecText(grammarAppendix), quote) {
			t.Fatalf("Appendix B no longer says %q", quote)
		}
	}
}

var awaitAdvisoryKeys = []string{"fiber-function", "deferred-arrow", "fiber-block", "deferred-method", "fiber-async", "deferred-async"}

func checkAwaitAdvisoryPlacement(t *testing.T, w *Workspace, key string, variant uint8) {
	t.Helper()
	TestAwaitAdvisoryPlacementQuoted(t)
	if !slices.Contains(awaitAdvisoryKeys, key) {
		key = awaitAdvisoryKeys[0]
	}
	code, typ := int32(4609), "Fiber.Fiber<number>"
	if strings.HasPrefix(key, "deferred-") {
		code, typ = 4610, "Deferred.Deferred<number>"
	}
	body := "return await value"
	declaration := "export effect function wait() { " + body + " }"
	switch strings.SplitN(key, "-", 2)[1] {
	case "arrow":
		declaration = "export const wait = effect () => { " + body + " }"
	case "block":
		declaration = "export const wait = effect { " + body + " }"
	case "method":
		declaration = "export const waiter = { effect wait() { " + body + " } }"
	case "async":
		declaration = "export async function wait() { " + body + " }"
	}
	severity := []string{"", "warning", "error", "suggestion", "off"}[int(variant)%5]
	project := Single("import type { Fiber, Deferred } from \"effect\"\ndeclare const value: " + typ + "\n" + declaration)
	if severity != "" {
		project.Config = strings.TrimSuffix(DefaultConfig, "\n}") + fmt.Sprintf(",\n\"vibe\":{\"severities\":{\"EK%d\":%q}}\n}", code, severity)
	}
	result, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	defer result.Remove()
	var categories []diagnostics.Category
	placement := 0
	allDiagnostics := slices.Clone(result.Diagnostics)
	if result.Program != nil {
		for _, file := range result.Program.GetSourceFiles() {
			if strings.HasSuffix(string(file.FileName()), "/main.vibe") {
				allDiagnostics = append(allDiagnostics, result.Program.GetSuggestionDiagnostics(t.Context(), file)...)
			}
		}
	}
	for _, d := range allDiagnostics {
		if !IsEK(d) {
			continue
		}
		if d.Code() == 102 && d.Category() == diagnostics.CategoryError {
			placement++
		}
		if d.Code() == code {
			categories = append(categories, d.Category())
		}
	}
	wantPlacement := 1
	if strings.HasSuffix(key, "-async") {
		wantPlacement = 0
	}
	wantCategory := diagnostics.CategoryWarning
	if severity == "error" {
		wantCategory = diagnostics.CategoryError
	}
	if severity == "suggestion" {
		wantCategory = diagnostics.CategorySuggestion
	}
	valid := len(categories) == 1 && categories[0] == wantCategory
	if severity == "off" || wantPlacement != 0 {
		valid = len(categories) == 0
	}
	if !valid || placement != wantPlacement {
		Gap(t, "FuzzAwaitAdvisoryPlacement", fmt.Sprintf("placement:%s:%s", key, severity), "VIP-1 EK0102 rejects effect await independently of VIP-5/30 advisory settings: placement=%d want=%d; categories=%v severity=%q", placement, wantPlacement, categories, severity)
	}
}

func TestAwaitAdvisoryPlacementRegression(t *testing.T) {
	w := NewWorkspace(t)
	for _, key := range awaitAdvisoryKeys {
		for variant := uint8(0); variant < 5; variant++ {
			t.Run(fmt.Sprintf("%s/%d", key, variant), func(t *testing.T) { checkAwaitAdvisoryPlacement(t, w, key, variant) })
		}
	}
}

func FuzzAwaitAdvisoryPlacement(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	for _, key := range awaitAdvisoryKeys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(4))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) { checkAwaitAdvisoryPlacement(t, w, key, variant) })
}
