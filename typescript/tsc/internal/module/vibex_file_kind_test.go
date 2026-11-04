package module

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
)

func TestVibexFileKindOutput(t *testing.T) {
	for _, mode := range []core.JsxEmit{core.JsxEmitPreserve, core.JsxEmitReact, core.JsxEmitReactJSX, core.JsxEmitReactNative, core.JsxEmitReactJSXDev} {
		options := &core.CompilerOptions{Jsx: mode}
		want := ".js"
		if mode == core.JsxEmitPreserve {
			want = ".jsx"
		}
		if got := TryGetJSExtensionForFile("src/Widget.vibex", options); got != want {
			t.Errorf("jsx %v: .vibex output %q, want %q", mode, got, want)
		}
	}
	if got := TryGetJSExtensionForFile("Widget.unsupported", &core.CompilerOptions{}); got != "" {
		t.Fatal(got)
	}
}
