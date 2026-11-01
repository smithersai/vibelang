package vibelangfuzz

import (
	"fmt"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

var nativeOutputSpecifierQuotes = []string{
	"Fields retain their TypeScript meaning with one deliberate file-kind exception:",
	"`x.vibe` emits `x.js` beside `x.d.ts` in `outDir`; relative `./x.vibe` specifiers become `./x.js`, as TypeScript’s `rewriteRelativeImportExtensions` does for `.ts`.",
}

func requireNativeOutputSpecifierQuotes(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range nativeOutputSpecifierQuotes {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("missing chapter 7 rule: %s", quote)
		}
	}
}

func TestNativeOutputSpecifierRulesQuoted(t *testing.T) { requireNativeOutputSpecifierQuotes(t) }

// VIP-34 keeps native compiler options. Compare the actual native output name
// with imports and reexports in .vibe JavaScript under the same config.
// This is the specification's cross-file naming invariant, not a snapshot of a
// particular compiler's chosen extension. No JSX runtime is needed to exercise
// the JSX-dependent .tsx filename rule.
func FuzzNativeOutputSpecifiers(f *testing.F) {
	startShortBudget(f)
	requireNativeOutputSpecifierQuotes(f)
	for _, mode := range []string{"preserve", "react-native", "react", "react-jsx", "react-jsxdev"} {
		for variant := uint8(0); variant < 8; variant++ {
			f.Add(mode, variant)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, mode string, variant uint8) {
		switch mode {
		case "preserve", "react-native", "react", "react-jsx", "react-jsxdev":
		default:
			return
		}
		extension := []string{"tsx", "ts", "mts", "cts"}[int(variant)%4]
		directory := ""
		if variant&4 != 0 {
			directory = "nested/"
		}
		source := directory + "token." + extension
		specifier := "./" + source
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","jsx":%q,"rewriteRelativeImportExtensions":true,"strict":true,"types":[],"skipLibCheck":true,"declaration":true,"outDir":"out","rootDir":"."},"vibe":{"effectGlobals":false,"effectModules":false},"files":["main.vibe",%q]}`, mode, source)
		result, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{
			"package.json": `{"type":"module"}`,
			source:         "export class Token { readonly value = 1 }\nexport const token = new Token()\n",
			"main.vibe":    fmt.Sprintf("import { token } from %q\nexport { Token } from %q\nexport const value = token\nexport type Shape = import(%q).Token\nexport const load = () => import(%q)\n", specifier, specifier, specifier, specifier),
		}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		key := fmt.Sprintf("%s/%s/%s", mode, extension, directory)
		for _, d := range result.Diagnostics {
			if d.Category() == diagnostics.CategoryError {
				Gap(t, "FuzzNativeOutputSpecifiers", key, "unexpected diagnostic: %v", d)
			}
		}
		native := ""
		for name := range result.Outputs {
			if strings.HasSuffix(name, "/"+directory+"token.js") || strings.HasSuffix(name, "/"+directory+"token.jsx") || strings.HasSuffix(name, "/"+directory+"token.mjs") || strings.HasSuffix(name, "/"+directory+"token.cjs") {
				native = "./" + directory + path.Base(name)
			}
		}
		if native == "" {
			Gap(t, "FuzzNativeOutputSpecifiers", key, "native module emitted no JavaScript")
			return
		}
		if !specifierWritten(native, map[string]bool{specifier: true}) {
			Gap(t, "FuzzNativeOutputSpecifiers", "provenance:"+key, "current tooling preserves native output spelling: %s must remain attributable to written %s", native, specifier)
		}
		for _, suffix := range []string{"/main.js"} {
			found := false
			for name, text := range result.Outputs {
				if !strings.HasSuffix(name, suffix) {
					continue
				}
				found = true
				if strings.Count(text, fmt.Sprintf("%q", native)) != 3 || strings.Contains(text, fmt.Sprintf("%q", specifier)) {
					Gap(t, "FuzzNativeOutputSpecifiers", key, "native output %s must be named by %s:\n%s", native, name, text)
				}
			}
			if !found {
				Gap(t, "FuzzNativeOutputSpecifiers", key, "missing output %s", suffix)
			}
		}
	})
}
