package modulespecifiers

import (
	"fmt"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// Exercise the module-specifier consumers, which used to panic for .vibex.
func TestVibexModuleSpecifierJSOutputEndings(t *testing.T) {
	for _, mode := range []struct {
		name string
		jsx  core.JsxEmit
	}{
		{"none", core.JsxEmitNone}, {"preserve", core.JsxEmitPreserve},
		{"react", core.JsxEmitReact}, {"react-native", core.JsxEmitReactNative},
		{"react-jsx", core.JsxEmitReactJSX}, {"react-jsxdev", core.JsxEmitReactJSXDev},
	} {
		for _, stem := range []string{"App", "nested/View", "space dir/View", "日本語/表示", "folder.vibex/View", "View.component"} {
			t.Run(fmt.Sprintf("%s/%s", mode.name, stem), func(t *testing.T) {
				defer func() {
					if value := recover(); value != nil {
						t.Fatalf("module-specifier generation must support .vibex: %v", value)
					}
				}()
				options := &core.CompilerOptions{Jsx: mode.jsx}
				want := getJSExtensionForFile(stem+".tsx", options)
				if got := getJSExtensionForFile(stem+".vibex", options); got != want {
					t.Errorf("module-specifier extension = %q, native TSX = %q", got, want)
				}
				path := tspath.RootedFilePathFromNormalized("/project/" + stem + ".vibex")
				if got := getJSExtensionForFileName(path, options); got != want {
					t.Errorf("rooted module-specifier extension = %q, native TSX = %q", got, want)
				}
			})
		}
	}
}
