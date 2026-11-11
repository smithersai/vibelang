package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const sidecarSerializerLimitTarget = "FuzzSidecarSerializerLimit"
const sidecarSerializerLimitQuote = "Declaration output is API-identical to what `tsc` writes for the Effect TypeScript twin"

// sidecarSerializerLimitSource is a module whose one export's inferred type
// grows with n: an object of literal properties, a tuple of literals, or a
// struct of nested objects, the shapes of t3code's large Schema modules. Past
// a few thousand members the type is longer than TypeScript's serializer
// limit (1,000,000 characters), and tsc reports TS7056.
func sidecarSerializerLimitSource(shape uint8, n int) string {
	// Through a generic call, so declaration emit prints the inferred type,
	// not the initializer's text.
	var b strings.Builder
	b.WriteString("const id = <T,>(x: T): T => x\n")
	switch shape % 3 {
	case 0:
		b.WriteString("export const value = id({\n")
		for i := range n {
			fmt.Fprintf(&b, "  property_with_a_rather_long_name_%05d: \"value_with_a_rather_long_text_%05d\",\n", i, i)
		}
		b.WriteString("} as const)\n")
	case 1:
		b.WriteString("export const value = id([\n")
		for i := range n {
			fmt.Fprintf(&b, "  \"a_rather_long_literal_member_of_the_tuple_%05d\",\n", i)
		}
		b.WriteString("] as const)\n")
	default:
		b.WriteString("export const value = id({\n")
		for i := range n {
			fmt.Fprintf(&b, "  struct_with_a_rather_long_name_%05d: { identifier: %d, display_name: \"name_%05d\", tags: [\"alpha\", \"beta\"] },\n", i, i, i)
		}
		b.WriteString("} as const)\n")
	}
	return b.String()
}

func TestSidecarSerializerLimitQuoted(t *testing.T) {
	if !strings.Contains(SpecText("001-functions.md"), sidecarSerializerLimitQuote) {
		t.Fatalf("Chapter 1 no longer says %q", sidecarSerializerLimitQuote)
	}
}

// serializerLimitEmit is what one compilation of main.ts or main.vibe writes.
type serializerLimitEmit struct {
	errors      string // error diagnostics, as "TS<code> <line>:<column>" in main
	declaration string // out/main.d.ts, as tsc writes it
	forced      string // main.d.ts as forced declaration emit writes it despite errors
	sidecar     string // main.d.vibe.ts
}

// checkSidecarSerializerLimit compiles one source as main.ts and as
// main.vibe. Chapter 1 requires the .vibe module's declaration output to be
// what tsc writes for its TypeScript twin, so the comparison is the compiler
// with itself on two inputs the spec says must agree: the same errors at the
// same places (TS7056 past the limit), the same main.d.ts (none past it), and
// a sidecar equal to TypeScript's forced declaration of the twin, cut off at
// the limit rather than printing the whole type.
func checkSidecarSerializerLimit(t *testing.T, w *Workspace, shape uint8, n int) {
	t.Helper()
	TestSidecarSerializerLimitQuoted(t)
	source := sidecarSerializerLimitSource(shape, n)
	compile := func(name string) serializerLimitEmit {
		var result *Result
		var err error
		within(t, "compile", func() { result, err = w.Compile(t.Context(), Project{Files: map[string]string{name: source}}) })
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		var out serializerLimitEmit
		var errors []string
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			at := "global"
			if d.File() != nil {
				line, column := scanner.GetECMALineAndByteOffsetOfPosition(d.File(), d.Pos())
				at = fmt.Sprintf("%d:%d", line+1, column+1)
			}
			errors = append(errors, fmt.Sprintf("TS%d %s", d.Code(), at))
		}
		out.errors = strings.Join(errors, ", ")
		out.declaration = result.Outputs["out/main.d.ts"]
		within(t, "forced declaration emit", func() {
			result.Program.Emit(t.Context(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true,
				WriteFile: func(name tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
					if strings.HasSuffix(string(name), "/main.d.ts") {
						out.forced = text
					}
					return nil
				}})
		})
		within(t, "sidecar emit", func() {
			var sidecarErrors []*ast.Diagnostic
			if emitted := result.Program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
				if strings.HasSuffix(name, "/main.d.vibe.ts") {
					out.sidecar = text
				}
				return nil
			}); emitted != nil {
				sidecarErrors = emitted.Diagnostics
			}
			for _, d := range sidecarErrors {
				if d.Category() == diagnostics.CategoryError && !strings.Contains(out.errors, fmt.Sprintf("TS%d ", d.Code())) {
					out.errors += fmt.Sprintf(", sidecar TS%d", d.Code())
				}
			}
		})
		return out
	}
	stock := compile("main.ts")
	vibe := compile("main.vibe")
	key := fmt.Sprintf("feature:shape-%d", shape%3)
	switch {
	case vibe.errors != stock.errors:
		Gap(t, sidecarSerializerLimitTarget, key, "Chapter 1: %q; a .vibe module of %d members reports [%s], its .ts twin [%s]", sidecarSerializerLimitQuote, n, vibe.errors, stock.errors)
	case vibe.declaration != stock.declaration:
		Gap(t, sidecarSerializerLimitTarget, key, "Chapter 1: %q; the .vibe module of %d members writes a %d-byte main.d.ts, tsc %d bytes for its twin", sidecarSerializerLimitQuote, n, len(vibe.declaration), len(stock.declaration))
	case vibe.sidecar != stock.forced:
		Gap(t, sidecarSerializerLimitTarget, key, "Chapter 1: %q; the sidecar of a .vibe module of %d members has %d bytes, TypeScript's forced declaration of its twin %d", sidecarSerializerLimitQuote, n, len(vibe.sidecar), len(stock.forced))
	}
	ExpectPending(t, sidecarSerializerLimitTarget, key)
}

func FuzzSidecarSerializerLimit(f *testing.F) {
	startShortBudget(f)
	f.Add(uint8(0), uint16(40))
	f.Add(uint8(1), uint16(40))
	f.Add(uint8(2), uint16(40))
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, shape uint8, size uint16) {
		checkSidecarSerializerLimit(t, w, shape, int(size)%32000+1)
	})
}
