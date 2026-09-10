package compiler

import "testing"

// This declaration surface is checked by the native compiler, not by a 5.9
// parser or a facade that copies its type model. Attributes select distinct
// ambient modules even when the module specifier has exactly the same text.
func TestPinnedForkNativeAttributeSelectedModules(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const declarations = `
declare module "*.style" with { type: "css" } {
  export interface Value { kind: "css" }
}
declare module "*.style" with { type: "text" } {
  export interface Value { kind: "text" }
}
`
	const declarationsUsingAttributes = `
import type { Value as Css } from "button.style" with { type: "css" };
import type { Value as Text } from "button.style" with { type: "text" };
export type { Css, Text };
`
	for _, vector := range []struct {
		name, body, extraTypes, code string
	}{
		{
			name: "two attributes keep distinct native types",
			body: `const css: Css["kind"] = "css";
const text: Text["kind"] = "text";
export function main(): string { return css + ":" + text; }`,
		},
		{
			name: "same specifier cannot exchange the selected types",
			body: `const css: Css["kind"] = "text";
export function main(): string { return css; }`,
			code: "TS2322",
		},
		{
			name: "an unmatched attribute does not borrow another module",
			body: `export function main(): string { return "unreachable"; }`,
			extraTypes: `import type { Value } from "button.style" with { type: "missing" };
export type Missing = Value;`,
			code: "TS2307",
		},
	} {
		t.Run(vector.name, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{
				RootNames: []string{"main.vibe", "shapes.ts", "types.d.ts"},
				Lowering:  LoweringInternal,
				Options:   Options{"declaration": true, "sourceMap": true},
				Files: []SourceFile{
					{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import type { Css, Text } from "./shapes.js";` + "\n" + vector.body},
					{Path: "shapes.ts", Kind: FileKindTypeScript, Text: declarationsUsingAttributes + vector.extraTypes},
					{Path: "types.d.ts", Kind: FileKindTypeScript, Text: declarations},
				},
			})
			if err != nil {
				t.Fatal(err)
			}
			if vector.code != "" {
				requireCode(t, result, vector.code, "")
				if !result.EmitSkipped || len(result.Artifacts) != 0 {
					t.Fatal("invalid native module selection emitted artifacts")
				}
				return
			}
			requireClean(t, result)
			if got := runComptimeProgram(t, result); got != "css:text" {
				t.Fatalf("attribute-selected program returned %q", got)
			}
		})
	}
}
