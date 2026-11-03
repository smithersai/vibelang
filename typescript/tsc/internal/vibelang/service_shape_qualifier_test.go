package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// shapeQualifierCodes returns the error codes of source, compiled as name.
func shapeQualifierCodes(t *testing.T, name, source string) []int32 {
	t.Helper()
	files := computedKeyFiles(false)
	files["/workspace/x/src/"+name] = source
	files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext"},"files":["` + name + `"]}`
	var codes []int32
	for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
		if d.Category() == diagnostics.CategoryError {
			codes = append(codes, d.Code())
		}
	}
	slices.Sort(codes)
	return codes
}

// X.Shape is a service's shape only where X is a service. Anywhere else it
// means what TypeScript says, and a name no scope declares used to overflow
// the stack: the hook's own Type lookup carries the Enum bit that
// SymbolFlagsNamespace holds, so the hook answered itself.
func TestShapeQualifierOutsideServices(t *testing.T) {
	t.Parallel()
	for _, source := range []string{
		"export type T = Missing.Shape\n",
		"export type T = Missing.Inner.Shape\n",
		"export type T = Date.Shape\n",
		"export type T = Intl.Shape\n",
		"export function f<T>(value: T.Shape) { return value }\n",
		"enum E { A }\nexport type T = E.Shape\n",
		"type Local = number\nexport type T = Local.Shape\n",
		"class Plain {}\nexport type T = Plain.Shape\n",
	} {
		vibe, ts := shapeQualifierCodes(t, "main.vibe", source), shapeQualifierCodes(t, "main.ts", source)
		if len(ts) == 0 {
			t.Errorf("tsc accepts %q; the twin proves nothing", source)
		}
		if !slices.Equal(vibe, ts) {
			t.Errorf("%q: .vibe reports %v, tsc %v", source, vibe, ts)
		}
	}
}
