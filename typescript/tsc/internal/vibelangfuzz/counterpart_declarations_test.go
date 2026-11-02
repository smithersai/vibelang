package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

var counterpartComparisonKeys = []string{
	"comments", "property-order", "union-order", "readonly-wrapper",
	"literal-change", "readonly-change", "removed-file", "added-file",
}

// Compiler-only probes explicitly compare private API shapes. Real package
// metadata keeps the migration gate's published-byte policy.
// Preserve the declared type and file-set contract in every context.
func counterpartComparisonWitness(t *testing.T, api, key string, mode uint8) {
	t.Helper()
	typeName := fmt.Sprintf("Shape%d", mode%8)
	before, after := t.TempDir(), t.TempDir()
	left, right := "export type "+typeName+" = number;\n", "export type "+typeName+" = number;\n"
	structuralEqual := true
	switch key {
	case "comments":
		left = "/** original */\n" + left
		right = "/** counterpart */\n" + right
	case "property-order":
		left = "export type " + typeName + " = { a: string; b: number };\n"
		right = "export type " + typeName + " = { b: number; a: string };\n"
	case "union-order":
		left = "export type " + typeName + " = number | string;\n"
		right = "export type " + typeName + " = string | number;\n"
	case "readonly-wrapper":
		left = "export type " + typeName + " = Readonly<{ value: number }>;\n"
		right = "export type " + typeName + " = { readonly value: number };\n"
	case "literal-change":
		left = "export type " + typeName + " = 1;\n"
		right = "export type " + typeName + " = 2;\n"
		structuralEqual = false
	case "readonly-change":
		left = "export type " + typeName + " = { value: number };\n"
		right = "export type " + typeName + " = { readonly value: number };\n"
		structuralEqual = false
	case "removed-file", "added-file":
		structuralEqual = false
	default:
		t.Fatalf("unknown comparison key %q", key)
	}
	for dir, source := range map[string]string{before: left, after: right} {
		if err := writeInside(dir, "main.d.ts", source); err != nil {
			t.Fatal(err)
		}
	}
	if key == "removed-file" || key == "added-file" {
		dir := before
		if key == "added-file" {
			dir = after
		}
		if err := writeInside(dir, "extra.d.ts", left); err != nil {
			t.Fatal(err)
		}
	}
	scope := int(mode/8) % 4
	want := structuralEqual
	for _, dir := range []string{before, after} {
		var file, text string
		switch scope {
		case 0: // A compiler-only probe; the helper explicitly supplies private metadata.
		case 1:
			file, text = "package.json", "{\"name\":\"comparison-control\",\"types\":\"./main.d.ts\"}"
			want = false
		case 2:
			file, text = "public-surface.json", "{\"roots\":[\"main.d.ts\"],\"reachable\":[\"main.d.ts\"],\"unresolved\":[]}"
			want = false
		case 3:
			file, text = "public-surface.json", "{\"roots\":[],\"reachable\":[],\"unresolved\":[]}"
		}
		if file != "" {
			if err := writeInside(dir, file, text); err != nil {
				t.Fatal(err)
			}
		}
	}
	diff, err := compareIdentityDeclarations(t.Context(), api, before, after)
	if err != nil || (diff == "") != want {
		t.Fatalf("%s scope%d: equality=%v, want%v, err=%v\n%s", key, scope, diff == "", want, err, diff)
	}
	diff, err = compareIdentityDeclarations(t.Context(), api, before, before)
	if err != nil || diff != "" {
		t.Fatalf("%s scope%d: identical control: err=%v\n%s", key, scope, err, diff)
	}
}

func TestCounterpartDeclarationComparison(t *testing.T) {
	api := declarationIdentityAPI(t)
	for _, key := range counterpartComparisonKeys {
		for _, mode := range []uint8{0, 8, 16, 24} {
			t.Run(fmt.Sprintf("%s/scope%d", key, mode/8), func(t *testing.T) {
				counterpartComparisonWitness(t, api, key, mode)
			})
		}
	}
}

func FuzzCounterpartDeclarationComparison(f *testing.F) {
	startShortBudget(f)
	if !strings.Contains(SpecText("001-functions.md"), dataCounterpartQuote) {
		f.Fatal("Chapter1 counterpart contract changed; update its cited oracle")
	}
	api := declarationIdentityAPI(f)
	for _, key := range counterpartComparisonKeys {
		f.Add(key, uint8(0))
		f.Add(key, uint8(8))
	}
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		found := false
		for _, known := range counterpartComparisonKeys {
			found = found || key == known
		}
		if !found {
			key = counterpartComparisonKeys[int(mode)%len(counterpartComparisonKeys)]
		}
		counterpartComparisonWitness(t, api, key, mode)
	})
}
