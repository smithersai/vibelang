package vibelangfuzz

import (
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"strings"
	"testing"
)

func serviceMixedMembersQuoted(t testing.TB) {
	t.Helper()
	b := string(rune(96))
	for path, quote := range map[string]string{
		"005-services.md": "a " + b + "constructor" + b + ", an index signature",
		"007-tooling.md":  b + "EK4831" + b + " | A class written with " + b + "Context.Service" + b,
	} {
		if !strings.Contains(SpecText(path), quote) {
			t.Fatalf("%s no longer says %q", path, quote)
		}
	}
}
func TestServiceMixedMembersQuoted(t *testing.T) { serviceMixedMembersQuoted(t) }
func FuzzServiceMixedMemberDiagnostics(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"mixed", "index", "constructor", "ordinary", "computed", "empty"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, reverse bool) {
		serviceMixedMembersQuoted(t)
		fragments := []string{}
		expected := map[string]bool{}
		switch key {
		case "mixed":
			fragments = append(fragments, "export service Indexed { [name: string]: unknown }", "export service Constructed { constructor() {} }")
			expected["[name: string]: unknown"] = true
			expected["constructor"] = true
		case "index":
			fragments = append(fragments, "export service Indexed { [name: string]: unknown }")
			expected["[name: string]: unknown"] = true
		case "constructor":
			fragments = append(fragments, "export service Constructed { constructor() {} }")
			expected["constructor"] = true
		case "ordinary", "computed", "empty":
		default:
			key = "empty"
		}
		fragments = append(fragments, "export class Explicit extends Context.Service<Explicit, Record<string, unknown>>()("+string(rune(34))+"explicit"+string(rune(34))+") {}")
		if key != "computed" && key != "empty" {
			fragments = append(fragments, "export class Ordinary { [name: string]: unknown; constructor(public value: number) {} }")
		}
		if key != "ordinary" && key != "empty" {
			fragments = append(fragments, "export service Named { [Symbol.iterator]: () => IterableIterator<number> }")
		}
		if key == "empty" {
			fragments = append(fragments, "export service Empty {}")
		}
		if reverse {
			for a, b := 0, len(fragments)-1; a < b; a, b = a+1, b-1 {
				fragments[a], fragments[b] = fragments[b], fragments[a]
			}
		}
		source := strings.Join(fragments, "\n") + "\n"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		found := map[string]bool{}
		lint := 0
		for _, d := range result.Diagnostics {
			if !IsEK(d) {
				t.Fatalf("unexpected TypeScript diagnostic: %s", d.String())
			}
			span := source[d.Pos():d.End()]
			switch d.Code() {
			case 902:
				if d.Category() != diagnostics.CategoryError {
					t.Fatalf("EK0902 must be an error: %s", d.String())
				}
				if !expected[span] || found[span] {
					t.Fatalf("unexpected or duplicate EK0902 span %q", span)
				}
				found[span] = true
			case 4831:
				if d.Category() != diagnostics.CategoryWarning {
					t.Fatalf("EK4831 must be a warning: %s", d.String())
				}
				lint++
				if span != "Explicit" {
					t.Fatalf("EK4831 span %q", span)
				}
			default:
				t.Fatalf("unexpected diagnostic: %s", d.String())
			}
		}
		if len(found) != len(expected) || lint != 1 {
			t.Fatalf("%s: member spans %v want %v, class lint %d", key, found, expected, lint)
		}
	})
}
