package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const serviceWholeShapeBodyQuote = "A recognized service header missing its required body is `EK0906`."

func TestServiceWholeShapeBodyQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceWholeShapeBodyQuote) {
		t.Fatalf("service body rule moved: %q", serviceWholeShapeBodyQuote)
	}
}

func FuzzServiceWholeShapeBody(f *testing.F) {
	startShortBudget(f)
	shapes := []struct{ key, text string }{
		{"string", "string"},
		{"number", "number"},
		{"callable", "(value: string) => string"},
		{"effect-callable", "(value: string) => string!!"},
		{"union", "string | number"},
		{"object", "{ readonly value: string }"},
	}
	for _, shape := range shapes {
		for variant := uint8(0); variant < 4; variant++ {
			f.Add(shape.key, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestServiceWholeShapeBodyQuoted(t)
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
		variant %= 4
		newline := "\n"
		if variant&2 != 0 {
			newline = "\r\n"
		}
		body := ""
		if variant&1 != 0 {
			body = newline + "{}"
		}
		source := "export service WholeShape: " + shape.text + body + newline
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{
			"main.vibe": source, "package.json": servicesPackage,
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		errors, bodyErrors := 0, 0
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				errors++
				if diagnostic.Code() == 906 {
					bodyErrors++
				}
			}
		}
		expected := 0
		if variant&1 == 0 {
			expected = 1
		}
		if errors != expected || bodyErrors != expected {
			Gap(t, "FuzzServiceWholeShapeBody", fmt.Sprintf("%s/%d", shape.key, variant),
				"%s expected %d missing-body errors only; got %v\n%s", serviceWholeShapeBodyQuote, expected,
				SortedKeys(Keys(result.Dir, result.Diagnostics)), source)
		}
	})
}
