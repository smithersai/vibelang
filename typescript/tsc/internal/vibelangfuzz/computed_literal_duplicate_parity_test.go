package vibelangfuzz

import "testing"

// D266 requires ordinary TypeScript diagnostics to agree with the pinned
// TypeScript compiler, including literal computed duplicate names.
func TestComputedLiteralDuplicateParity(t *testing.T) {
	w := NewWorkspace(t)
	stock := StockTypeScript(t)
	for _, test := range []struct{ name, fields string }{
		{"string-compatible", `["x"]: number; ["x"]: number`},
		{"string-incompatible", `["x"]: number; ["x"]: string`},
		{"number-compatible", `[1]: number; [1]: number`},
		{"number-incompatible", `[1]: number; [1]: string`},
		{"alias-compatible", `[slot]: number; ["x"]: number`},
		{"readonly-alias", `readonly [slot]: number; readonly ["x"]: string`},
		{"alias-incompatible", `[slot]: number; ["x"]: string`},
	} {
		t.Run(test.name, func(t *testing.T) {
			files := map[string]string{"main.ts": "const slot = x as const;\ntype Row = {" + test.fields + "};\nexport {}\n", "tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"Bundler","types":[],"skipLibCheck":true},"files":["main.ts"]}`}
			CheckParity(t, w, stock, "FuzzTypeScriptParity", Archive(files))
		})
	}
}
