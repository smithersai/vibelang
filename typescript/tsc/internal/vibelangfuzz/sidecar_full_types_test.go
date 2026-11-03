package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const sidecarFullTypesTarget = "FuzzSidecarFullTypes"
const sidecarFullTypesQuote = "Type checkers use `.d.vibe.ts`"

// sidecarFullTypesSource is a module whose one export's inferred type grows
// with n: an object of literal properties, a tuple of literals, or a struct of
// nested objects, the shapes of t3code's large Schema modules.
func sidecarFullTypesSource(shape uint8, n int) (string, string) {
	// Through a generic call, so declaration emit prints the inferred type,
	// not the initializer's text.
	var b strings.Builder
	var last string
	b.WriteString("const id = <T,>(x: T): T => x\n")
	switch shape % 3 {
	case 0:
		b.WriteString("export const value = id({\n")
		for i := range n {
			fmt.Fprintf(&b, "  property_with_a_rather_long_name_%05d: \"value_with_a_rather_long_text_%05d\",\n", i, i)
		}
		b.WriteString("} as const)\n")
		last = fmt.Sprintf(`readonly property_with_a_rather_long_name_%05d: "value_with_a_rather_long_text_%05d";`, n-1, n-1)
	case 1:
		b.WriteString("export const value = id([\n")
		for i := range n {
			fmt.Fprintf(&b, "  \"a_rather_long_literal_member_of_the_tuple_%05d\",\n", i)
		}
		b.WriteString("] as const)\n")
		last = fmt.Sprintf(`"a_rather_long_literal_member_of_the_tuple_%05d"`, n-1)
	default:
		b.WriteString("export const value = id({\n")
		for i := range n {
			fmt.Fprintf(&b, "  struct_with_a_rather_long_name_%05d: { identifier: %d, display_name: \"name_%05d\", tags: [\"alpha\", \"beta\"] },\n", i, i, i)
		}
		b.WriteString("} as const)\n")
		last = fmt.Sprintf("readonly struct_with_a_rather_long_name_%05d: {", n-1)
	}
	return b.String(), last
}

func TestSidecarFullTypesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), sidecarFullTypesQuote) {
		t.Fatalf("Chapter 7 no longer says %q", sidecarFullTypesQuote)
	}
}

// checkSidecarFullTypes compiles one source as main.ts and as main.vibe.
// Where stock TypeScript emits the .ts declaration, the .vibe module declares
// the same text; where the type is too long for it (TS7056), the .vibe
// module, whose declarations are the sidecar a checker reads in place of its
// source, still declares the type in full, with no error.
func checkSidecarFullTypes(t *testing.T, w *Workspace, shape uint8, n int) {
	t.Helper()
	TestSidecarFullTypesQuoted(t)
	source, last := sidecarFullTypesSource(shape, n)
	compile := func(name string) (string, []int32) {
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var codes []int32
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				codes = append(codes, d.Code())
			}
		}
		return result.Outputs["out/main.d.ts"], codes
	}
	stock, stockCodes := compile("main.ts")
	vibe, vibeCodes := compile("main.vibe")
	key := fmt.Sprintf("feature:shape-%d", shape%3)
	if len(vibeCodes) != 0 {
		Gap(t, sidecarFullTypesTarget, key, "Chapter 7: %q; a .vibe module of %d members reports %v (stock: %v)", sidecarFullTypesQuote, n, vibeCodes, stockCodes)
	} else if len(stockCodes) == 0 && vibe != stock {
		Gap(t, sidecarFullTypesTarget, key, "Chapter 7: %q; the .vibe declaration of %d members differs from stock TypeScript's", sidecarFullTypesQuote, n)
	} else if !strings.Contains(vibe, last) {
		Gap(t, sidecarFullTypesTarget, key, "Chapter 7: %q; the .vibe declaration of %d members does not print %q", sidecarFullTypesQuote, n, last)
	}
	ExpectPending(t, sidecarFullTypesTarget, key)
}

func FuzzSidecarFullTypes(f *testing.F) {
	startShortBudget(f)
	f.Add(uint8(0), uint16(40))
	f.Add(uint8(1), uint16(40))
	f.Add(uint8(2), uint16(40))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, size uint16) {
		checkSidecarFullTypes(t, w, shape, int(size)%32000+1)
	})
}
