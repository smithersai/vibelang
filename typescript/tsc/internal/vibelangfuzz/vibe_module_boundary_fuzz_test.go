package vibelangfuzz

import (
	"context"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
)

type moduleBindingWitness struct{ key, declaration, reference string }

var moduleBindingWitnesses = []moduleBindingWitness{
	{"const", "const policySecret = 1", "const reader = policySecret"},
	{"let", "let policySecret = 1", "const reader = policySecret"},
	{"var", "var policySecret = 1", "const reader = policySecret"},
	{"destructuring", "const { policySecret } = { policySecret: 1 }", "const reader = policySecret"},
	{"function", "function policySecret() { return 1 }", "const reader = policySecret"},
	{"class", "class policySecret {}", "const reader = policySecret"},
	{"enum", "enum policySecret { Value = 1 }", "const reader = policySecret"},
	{"namespace", "namespace policySecret { export const value = 1 }", "const reader = policySecret.value"},
	{"interface", "interface policySecret { value: number }", "type Reader = policySecret"},
	{"type", "type policySecret = number", "type Reader = policySecret"},
}

// The quoted rule classifies the whole source unit, so the neighbourhood
// covers value/type bindings, patterns and every moduleDetection/prelude
// combination, rather than only one const declaration in the discovery.
func FuzzVibeModuleBoundary(f *testing.F) {
	// Spec rule: docs/design/src/001-functions.md#932c8898f1eae4e7
	// Chapter 001: file-local module bindings across prelude switches and explicit import/export control (FuzzVibeModuleBoundary).

	// Spec rule: docs/design/src/001-functions.md#6ff6c6886d03357e
	// Chapter 001: file-local module bindings across prelude switches and explicit import/export control (FuzzVibeModuleBoundary).

	// Spec rule: docs/design/src/001-functions.md#6ff883269b72a9d4
	// Chapter 001: file-local module bindings across prelude switches and explicit import/export control (FuzzVibeModuleBoundary).

	// Spec rule: docs/design/src/001-functions.md#d570a55fbffeeb2a
	// Chapter 001: file-local module bindings across prelude switches and explicit import/export control (FuzzVibeModuleBoundary).

	startShortBudget(f)
	requireVarDenialQuotes(f)
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(text), vibeModuleBoundaryQuote) {
		f.Fatalf("missing quoted rule: %s", vibeModuleBoundaryQuote)
	}
	w := NewWorkspace(f)
	for _, witness := range moduleBindingWitnesses {
		for mode := uint8(0); mode < 3; mode++ {
			for prelude := uint8(0); prelude < 4; prelude++ {
				f.Add(witness.key, mode, prelude)
			}
		}
	}
	f.Fuzz(func(t *testing.T, key string, mode, prelude uint8) {
		witness := moduleBindingWitnesses[int(mode)%len(moduleBindingWitnesses)]
		for _, candidate := range moduleBindingWitnesses {
			if candidate.key == key {
				witness = candidate
				break
			}
		}
		detection := []string{"legacy", "auto", "force"}[int(mode)%3]
		mask := int(prelude & 3)
		result, err := w.Compile(context.Background(), Project{Files: map[string]string{
			"a.vibe": witness.declaration + "\n", "b.vibe": witness.reference + "\n", "package.json": "{\"type\":\"commonjs\"}",
		}, Config: moduleBoundaryConfig(detection, mask, []string{"a.vibe", "b.vibe"}, false)})
		if err != nil {
			t.Fatal(err)
		}
		gapKey := fmt.Sprintf("%s/%s/prelude%d", witness.key, detection, mask)
		if result.Program == nil {
			Gap(t, "FuzzVibeModuleBoundary", gapKey, "stage=config: no program")
		}
		var codes []int
		for _, diagnostic := range result.Diagnostics {
			codes = append(codes, int(diagnostic.Code()))
		}
		want := []int{2304}
		if witness.key == "var" {
			// VIP-1 bans the declaration without making its binding visible
			// to the other source module. Both exact errors must remain.
			want = []int{107, 2304}
		}
		slices.Sort(codes)
		if !slices.Equal(codes, want) {
			Gap(t, "FuzzVibeModuleBoundary", gapKey, "stage=checking: private source binding visible or unexpected diagnostic: got %v, want %v", codes, want)
		}
		for _, file := range result.Program.SourceFiles() {
			if strings.HasSuffix(file.FileName().AsString(), ".vibe") && !file.IsDeclarationFile && file.ExternalModuleIndicator == nil {
				Gap(t, "FuzzVibeModuleBoundary", gapKey, "stage=classification: source .vibe is not a module")
			}
		}
	})
}
