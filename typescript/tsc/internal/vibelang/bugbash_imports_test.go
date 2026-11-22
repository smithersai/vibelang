package vibelang

import (
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"testing"
)

func TestBugBashImportURLCharacters(t *testing.T) {
	for source, want := range map[string]string{
		"./hi#1.vibe":    "./hi%231.js",
		"./hi%1.vibe":    "./hi%251.js",
		"./hi%23.vibe":   "./hi%2523.js",
		"../a b/file.ts": "../a%20b/file.js",
		"effect":         "effect",
	} {
		got, _ := outputSpecifierText(source)
		if got != want {
			t.Errorf("%q: got %q, want %q", source, got, want)
		}
	}
}

// A file emitted as CommonJS names its imports by file path for require,
// which decodes nothing, so the rewrite changes only the extension (#437).
func TestImportSpecifierCommonJSUnescaped(t *testing.T) {
	for source, want := range map[string]string{
		"./hi#1.vibe":         "./hi#1.js",
		"./hi%1.vibe":         "./hi%1.js",
		"../a b/file.ts":      "../a b/file.js",
		"./[id].vibe":         "./[id].js",
		"./(group)/page.vibe": "./(group)/page.js",
		"./caf\u00e9.vibe":    "./caf\u00e9.js",
		"effect":              "effect",
	} {
		got, _ := outputSpecifierTextForFormat(source, core.JsxEmitNone, true /*commonJS*/)
		if got != want {
			t.Errorf("%q: got %q, want %q", source, got, want)
		}
		esm, _ := outputSpecifierTextForFormat(source, core.JsxEmitNone, false /*commonJS*/)
		if wantESM, _ := outputSpecifierText(source); esm != wantESM {
			t.Errorf("%q: ES module got %q, want %q", source, esm, wantESM)
		}
	}
}

func TestImportSpecifierJSXModes(t *testing.T) {
	for _, mode := range []core.JsxEmit{core.JsxEmitNone, core.JsxEmitPreserve, core.JsxEmitReact, core.JsxEmitReactNative, core.JsxEmitReactJSX, core.JsxEmitReactJSXDev} {
		suffix := ".js"
		if mode == core.JsxEmitPreserve { // react-native emits .js, as outputpaths.GetOutputExtension and tsc do
			suffix = ".jsx"
		}
		for _, source := range []string{"./token.tsx", "../a b/token.tsx"} {
			got, changed := outputSpecifierTextWithJSX(source, mode)
			prefix := "./token"
			if source[1] == '.' {
				prefix = "../a%20b/token"
			}
			if !changed || got != prefix+suffix {
				t.Errorf("mode %v, %s: got %s (%v), want %s", mode, source, got, changed, prefix+suffix)
			}
		}
	}
}

func TestImportSpecifierNativeFileKinds(t *testing.T) {
	for _, mode := range []core.JsxEmit{core.JsxEmitNone, core.JsxEmitPreserve, core.JsxEmitReact, core.JsxEmitReactNative, core.JsxEmitReactJSX, core.JsxEmitReactJSXDev} {
		for _, row := range []struct{ source, want string }{
			{"./token.vibe", "./token.js"},
			{"./token.ts", "./token.js"},
			{"./token.mts", "./token.mjs"},
			{"./token.cts", "./token.cjs"},
		} {
			got, changed := outputSpecifierTextWithJSX(row.source, mode)
			if !changed || got != row.want {
				t.Errorf("mode %v, %s: got %s (%v), want %s", mode, row.source, got, changed, row.want)
			}
		}
	}
}
