package vibelangfuzz

import (
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const serviceShapeShadowQuote = "whose members are TypeScript [Member]"

func serviceShapeShadowQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), serviceShapeShadowQuote) {
		t.Fatalf("chapter 5 no longer says %q", serviceShapeShadowQuote)
	}
}

func TestServiceShapeShadowQuoted(t *testing.T) { serviceShapeShadowQuoted(t) }

// VIP-9 preserves TypeScript member signatures, including their lexical
// type-parameter bindings. Compare with an ordinary TypeScript object type.
func FuzzServiceShapeShadow(f *testing.F) {
	startShortBudget(f)
	serviceShapeShadowQuoted(f)
	for variant := byte(0); variant < 16; variant++ {
		f.Add([]byte{variant})
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		variant := byte(0)
		if len(data) > 0 {
			variant = data[0]
		}
		member := []string{
			"take<Local>(value: Local.Shape): number",
			"take<Local>(): Local.Shape",
			"take: <Local>(value: Local.Shape) => number",
			"take<Local, U extends Local.Shape>(value: U): number",
		}[variant%4]
		vibe := "export function scope(): void { service Local { static readonly key = \"fuzz/shadow\"; " + member + " } }\n"
		native := "type Shape = { " + member + " }; export {}\n"
		if variant&8 != 0 {
			vibe = "export function scope(): void { service Local { static readonly key = \"fuzz/shadow\"; n: number }; type Contract = { " + member + " } }\n"
		}
		if variant&4 != 0 {
			vibe = strings.ReplaceAll(vibe, "Local", "LocalCafé")
			native = strings.ReplaceAll(native, "Local", "LocalCafé")
		}
		for _, input := range []struct{ name, source string }{{"main.vibe", vibe}, {"main.ts", native}} {
			config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"noEmit\":true,\"types\":[]},\"files\":[%q]}", input.name)
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{input.name: input.source}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var codes []int32
			for _, d := range r.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					codes = append(codes, d.Code())
				}
			}
			if !slices.Equal(codes, []int32{2702}) {
				Gap(t, "FuzzServiceShapeShadow", "shadowed-name", "%s: %s: want [2702], got %v\n%s", serviceShapeShadowQuote, input.name, codes, input.source)
				return
			}
			if input.name == "main.vibe" && variant&8 != 0 {
				config := toolsConfig(w, r.Dir)
				if config == nil {
					t.Fatal("missing config")
				}
				fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
				if fixed.Err != nil || len(fixed.Files) != 0 {
					Gap(t, "FuzzServiceShapeShadow", "shadowed-fix", "the local service fix rewrote a shadowing type: err=%v files=%v\n%s", fixed.Err, fixed.Files, input.source)
					return
				}
				ExpectPending(t, "FuzzServiceShapeShadow", "shadowed-fix")
			}
		}
		ExpectPending(t, "FuzzServiceShapeShadow", "shadowed-name")
		ExpectPending(t, "FuzzServiceShapeShadow", specCorpusKey(t))
	})
}
