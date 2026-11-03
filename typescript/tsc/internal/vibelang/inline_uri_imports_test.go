package vibelang

import (
	"strconv"
	"testing"
)

func TestInlineURIModuleImports(t *testing.T) {

	const source = `import value from "data:sample"
import "blob:sample"
export { default as upper } from "DATA:sample"
export const data = import("data:sample")
export const blob = import("blob:sample")
export const upperBlob = import("BLOB:sample")
export const computed = import("data:" + "sample")
export type DataModule = typeof import("data:sample")
export const checked = value
`
	program := computedKeyProgram(t, map[string]string{
		"/workspace/x/src/package.json":  `{"name":"inline-uri","type":"module"}`,
		"/workspace/x/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","skipLibCheck":true,"noEmit":true,"types":[]},"files":["main.vibe","uris.d.ts"]}`,
		"/workspace/x/src/main.vibe":     source,
		"/workspace/x/src/uris.d.ts": `declare module "data:*" { const value: number; export default value }
declare module "blob:*" { const value: number; export default value }
declare module "DATA:*" { const value: number; export default value }
declare module "BLOB:*" { const value: number; export default value }
`,
	})
	count := 0
	for _, d := range program.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Source() != diagnosticSource || d.Code() != 107 {
			t.Errorf("unexpected diagnostic: %s", d.String())
		} else {
			count++
		}
	}
	if count != 6 {
		t.Fatalf("want six EK0107 module imports, got %d", count)
	}
}

// These are native URL spellings of the same data scheme, confirmed by the
// Node counterpart. Check through the compiler, not just a prefix helper.
func TestNormalizedInlineURIModules(t *testing.T) {
	for _, prefix := range []string{"data:", "DATA:", " data:", "\tdata:", "da\nta:", "da\tta:", "\u0000data:", "blob:", "BLOB:"} {
		t.Run(strconv.Quote(prefix), func(t *testing.T) {
			uri := prefix + "text/javascript,export default 1"
			literal := strconv.Quote(uri)
			program := computedKeyProgram(t, map[string]string{
				"/workspace/x/src/package.json":  `{"name":"normalized-uri","type":"module"}`,
				"/workspace/x/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","skipLibCheck":true,"noEmit":true,"types":[]},"files":["main.vibe","uri.d.ts"]}`,
				"/workspace/x/src/main.vibe":     "export const loaded = import(" + literal + ")",
				"/workspace/x/src/uri.d.ts":      "declare module " + literal + " { const value: number; export default value }",
			})
			diagnostics := program.GetSemanticDiagnostics(t.Context(), nil)
			if len(diagnostics) != 1 || diagnostics[0].Source() != diagnosticSource || diagnostics[0].Code() != 107 {
				t.Fatalf("want one EK0107, got %v", diagnostics)
			}
		})
	}
}
