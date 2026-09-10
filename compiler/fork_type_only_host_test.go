package compiler

import "testing"

func TestPinnedForkTypeOnlyAmbientNamesHaveNoRuntimeAuthority(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, query := range []string{
		"Date", "Date.UTC", "Math", "Math.random", "Function", "eval",
		"WeakRef", "FinalizationRegistry", "Atomics", "SharedArrayBuffer",
	} {
		t.Run(query, func(t *testing.T) {
			source := `export type Host=typeof ` + query + `;
export function read(value:Host|undefined=undefined){return 42};export function main(){return read()}`
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			if actual := runPublishedConsumer(t, CompileResult{}, result); actual != "42" {
				t.Fatalf("type-only host reference changed execution: %q", actual)
			}
		})
	}
	for _, tc := range []struct{ expression, code string }{
		{"Date.now()", "VIBE1602"},
		{"Math.random()", "VIBE1603"},
		{`Function("return 1")`, "VIBE1604"},
		{"new WeakRef({})", "VIBE1605"},
	} {
		t.Run(tc.expression, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `export function main(){return ` + tc.expression + `}`}}})
			if err != nil {
				t.Fatal(err)
			}
			requireCode(t, result, tc.code, "ambient")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("runtime host authority escaped checking")
			}
		})
	}
}
