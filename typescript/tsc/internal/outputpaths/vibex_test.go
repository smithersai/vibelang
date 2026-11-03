package outputpaths

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

// VIP-39: output names depend on the source extension even without JSX nodes.
func TestVibexOutputExtension(t *testing.T) {
	for _, mode := range []core.JsxEmit{core.JsxEmitNone, core.JsxEmitPreserve, core.JsxEmitReact, core.JsxEmitReactNative, core.JsxEmitReactJSX, core.JsxEmitReactJSXDev} {
		for _, stem := range []string{"main", "/src/nested/component", "/src/a b/component"} {
			for _, ext := range []string{".vibex", ".tsx", ".jsx", ".vibe", ".ts", ".js", ".mts", ".mjs", ".cts", ".cjs", ".json"} {
				want := ".js"
				switch ext {
				case ".vibex", ".tsx", ".jsx":
					if mode == core.JsxEmitPreserve {
						want = ".jsx"
					}
				case ".mts", ".mjs":
					want = ".mjs"
				case ".cts", ".cjs":
					want = ".cjs"
				case ".json":
					want = ".json"
				}
				if got := GetOutputExtension(stem+ext, mode); got != want {
					t.Errorf("GetOutputExtension(%q, %v) = %q, want %q", stem+ext, mode, got, want)
				}
			}
		}
	}
}
