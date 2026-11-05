package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const anyCallUnknownThrowsQuote = "in effect code the same call has thrown type `unknown` and needs its wrapper (`EK0403`)"
const anyCallCompatibilityQuote = "a legacy Effect function returns a call of a value typed `any`."

func TestAnyCallContractDiagnosticsQuoted(t *testing.T) {
	for file, quote := range map[string]string{
		"003-failures.md":   anyCallUnknownThrowsQuote,
		"900-appendices.md": anyCallCompatibilityQuote,
	} {
		if !strings.Contains(SpecText(file), quote) {
			t.Fatalf("%s no longer says %q", file, quote)
		}
	}
}

func FuzzAnyCallContractDiagnostics(f *testing.F) {
	startShortBudget(f)
	shapes := []struct{ key, annotation string }{
		{"number", "number!!"}, {"unknown", "unknown!!"},
		{"object", "object!!"}, {"program", "(number!!)!!"},
		{"plain", "unknown"},
	}
	for _, shape := range shapes {
		for mode := uint8(0); mode < 4; mode++ {
			f.Add(shape.key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestAnyCallContractDiagnosticsQuoted(t)
		index := 0
		if len(key) > 0 {
			index = int(key[0]) % len(shapes)
		}
		for i, shape := range shapes {
			if key == shape.key {
				index = i
				break
			}
		}
		shape := shapes[index]
		modifier := "effect "
		expected := 1
		if shape.key == "plain" {
			modifier = ""
			expected = 0
		}
		source := "export " + modifier + "function inspect(h: any): " + shape.annotation + " { return h() }\n"
		if mode&1 != 0 {
			source = "export const inspect = " + modifier + "(h: any): " + shape.annotation + " => h()\n"
		}
		if mode&2 != 0 {
			source = strings.ReplaceAll(source, "\n", "\r\n")
		}
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		unknown, advisory, otherErrors := 0, 0, 0
		for _, diagnostic := range result.Diagnostics {
			switch {
			case IsEK(diagnostic) && diagnostic.Code() == 403:
				unknown++
				if diagnostic.Category() != diagnostics.CategoryError {
					t.Fatal("unknown throws must remain an error")
				}
			case IsEK(diagnostic) && diagnostic.Code() == 4409:
				advisory++
				if diagnostic.Category() != diagnostics.CategoryWarning {
					t.Fatal("compatibility advice must remain a warning")
				}
			case diagnostic.Category() == diagnostics.CategoryError:
				otherErrors++
			}
		}
		if unknown != expected || advisory != expected || otherErrors != 0 {
			Gap(t, "FuzzAnyCallContractDiagnostics", fmt.Sprintf("%s/%d", shape.key, mode%4),
				"chapters 3 and 900 require independent unknown-throw and unchecked-result diagnostics; expected %d of each, got %v\n%s",
				expected, SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
	})
}
