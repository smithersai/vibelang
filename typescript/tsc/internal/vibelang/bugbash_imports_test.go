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
