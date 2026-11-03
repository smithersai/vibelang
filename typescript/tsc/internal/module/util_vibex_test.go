package module

import (
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestVibexResolutionDiagnosticsMatchTSX(t *testing.T) {
	for _, row := range []struct {
		name string
		jsx  core.JsxEmit
	}{
		{"none", core.JsxEmitNone}, {"preserve", core.JsxEmitPreserve},
		{"react", core.JsxEmitReact}, {"react-native", core.JsxEmitReactNative},
		{"react-jsx", core.JsxEmitReactJSX}, {"react-jsxdev", core.JsxEmitReactJSXDev},
	} {
		t.Run(row.name, func(t *testing.T) {
			options := &core.CompilerOptions{Jsx: row.jsx}
			file := &ast.SourceFile{}
			want := GetResolutionDiagnostic(options, &ResolvedModule{Extension: tspath.ExtensionTsx}, file)
			got := GetResolutionDiagnostic(options, &ResolvedModule{Extension: tspath.ExtensionVibex}, file)
			if got != want {
				t.Fatalf(".vibex must use the native TSX admission diagnostic: got %v, want %v", got, want)
			}
		})
	}
}
