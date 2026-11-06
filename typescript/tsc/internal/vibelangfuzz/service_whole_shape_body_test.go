package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
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
		if variant&1 != 0 {
			return
		}
		// A migration meets this header in code an older compiler accepted, so --fix owns it.
		config := toolsConfig(w, result.Dir)
		if result.Program == nil || config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid generated project")
		}
		var fixed *vibelang.FixResult
		within(t, "fix", func() {
			fixed = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		})
		text := ""
		for name, file := range fixed.Files {
			if strings.HasSuffix(name.AsString(), "main.vibe") {
				text = file.Text
			}
		}
		if fixed.Err != nil || !strings.Contains(text, "export service WholeShape: "+shape.text+" {}") {
			Gap(t, "FuzzServiceWholeShapeBody", "fix:"+shape.key, "--fix left the header: err=%v\n%s", fixed.Err, text)
			return
		}
		after, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": text, "package.json": servicesPackage}})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		for _, diagnostic := range after.Diagnostics {
			if diagnostic.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzServiceWholeShapeBody", "fix-result:"+shape.key, "the fixed declaration fails: %v\n%s",
					SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
				return
			}
		}
	})
}
