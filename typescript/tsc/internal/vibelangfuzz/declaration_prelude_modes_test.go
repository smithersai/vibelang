package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const declarationPreludeModesQuote = "Declarations are exactly what idiomatic Effect TypeScript would declare."

func requireDeclarationPreludeModesQuote(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("001-functions.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), declarationPreludeModesQuote) {
		t.Fatal("chapter 1 declaration identity quote changed")
	}
}
func TestDeclarationPreludeModesQuoted(t *testing.T) { requireDeclarationPreludeModesQuote(t) }

// VIP-27 permits this compiler-self comparison: ordinary TypeScript has the
// explicit imports that the prelude supplies to VibeLang. Compare raw .d.ts
// bytes, including import style, across emit kinds and package defaults.
// NodeNext stays ESM here; its cross-mode assertion requirement is independent
// of Preserve/Bundler and is not relaxed by the product fix.
func FuzzDeclarationPreludeModes(f *testing.F) {
	startShortBudget(f)
	requireDeclarationPreludeModesQuote(f)
	keys := []string{"layer", "context", "option", "schema", "pair", "shadow"}
	for _, mode := range []string{"Preserve", "ESNext", "NodeNext"} {
		for _, key := range keys {
			f.Add(mode, key, uint8(0))
			if mode != "NodeNext" {
				f.Add(mode, key, uint8(1))
				f.Add(mode, key, uint8(2))
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode, key string, pkg uint8) {
		resolution := "Bundler"
		switch mode {
		case "Preserve", "ESNext":
		case "NodeNext":
			resolution = "NodeNext"
			pkg = 0
		default:
			return
		}
		imports, source := "", ""
		switch key {
		case "layer":
			imports = "Layer"
			source = "export const value = Layer.merge(Layer.empty, Layer.empty)\n"
		case "context":
			imports = "Context, References"
			source = "export const value = Context.add(Context.empty(), References.MinimumLogLevel, \"Info\")\n"
		case "option":
			imports = "Option"
			source = "export const value = Option.some(1)\n"
		case "schema":
			imports = "Schema"
			source = "export const value = Schema.String\n"
		case "pair":
			imports = "Layer, Option"
			source = "export const value = [Layer.empty, Option.some(1)] as const\n"
		case "shadow":
			source = "const Layer = { empty: 1 }; export const value = Layer.empty\n"
		default:
			return
		}
		packageText := []string{`{"type":"module"}`, `{"type":"commonjs"}`, `{}`}[int(pkg)%3]
		original := source
		if imports != "" {
			original = "import { " + imports + " } from \"effect\"\n" + source
		}
		compile := func(name, text string) *Result {
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","singleThreaded":true,"module":%q,"moduleResolution":%q,"strict":true,"types":[],"skipLibCheck":true,"declaration":true,"outDir":"out"},"files":[%q]}`, mode, resolution, name)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{name: text, "package.json": packageText}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			if !result.Program.Options().SingleThreaded.IsTrue() {
				t.Fatal("declaration identity must disable parallel emit on both inputs")
			}
			for _, d := range result.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzDeclarationPreludeModes", fmt.Sprintf("%s/%s/%d", mode, key, pkg%3), "unexpected diagnostic in %s: %v", name, d)
				}
			}
			return result
		}
		vibe := compile("main.vibe", source)
		defer vibe.Remove()
		native := compile("main.ts", original)
		defer native.Remove()
		declaration := func(result *Result) string {
			for name, text := range result.Outputs {
				if strings.HasSuffix(name, "/main.d.ts") {
					return text
				}
			}
			t.Fatal("missing main declaration")
			return ""
		}
		got, want := declaration(vibe), declaration(native)
		if got != want {
			Gap(t, "FuzzDeclarationPreludeModes", fmt.Sprintf("%s/%s/%d", mode, key, pkg%3), "module=%s package=%s\nVibeLang:\n%s\nTypeScript:\n%s", mode, packageText, got, want)
		}
	})
}
