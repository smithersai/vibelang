package compiler

import (
	"fmt"
	"testing"
)

func TestPinnedForkReservedCompilerRuntimeExports(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, module := range []string{"vibelang/context", "vibelang/schema-runtime"} {
		for _, binding := range []string{"__vsSchema", "__vsResultSuccess", "__vsRunResult", "__vsPropagate", "RuntimeValues", "Resumable"} {
			for form, source := range []string{
				fmt.Sprintf(`import {%s as local} from %q; export const factory = local`, binding, module),
				fmt.Sprintf(`import * as ns from %q; export const factory = ns.%s`, module, binding),
				fmt.Sprintf(`import * as ns from %q; export const factory = ns[%q]`, module, binding),
				fmt.Sprintf(`import * as ns from %q; const KEY = %q; export const factory = ns[KEY]`, module, binding),
				fmt.Sprintf(`export {%s as local} from %q`, binding, module),
			} {
				t.Run(fmt.Sprintf("%s/%s/%d", module, binding, form), func(t *testing.T) {
					result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
						Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}})
					if err != nil {
						t.Fatal(err)
					}
					refused := false
					for _, diagnostic := range result.Diagnostics {
						refused = refused || diagnostic.Code == "VIBE1201"
					}
					want := module != "vibelang/schema-runtime" || binding != "__vsSchema"
					if refused != want {
						t.Fatalf("private-hook refusal = %v, want %v: %+v", refused, want, result.Diagnostics)
					}
					if want && (!result.EmitSkipped || len(result.Artifacts) != 0) {
						t.Fatal("a private runtime hook emitted an executable")
					}
				})
			}
		}
	}
}

func TestPinnedForkReservedRuntimeHooksDoNotCaptureUserNamesOrTypes(t *testing.T) {
	for _, source := range []string{
		`const ns = {__vsRunResult: 42}; export function main() {return ns.__vsRunResult}`,
		`import * as ns from "vibelang/context"; export function main(ns: {__vsRunResult: number}) {return ns["__vsRunResult"]}`,
		`import type {__vsRunResult} from "vibelang/context"`,
		`import {type __vsRunResult} from "vibelang/context"`,
		`export type {__vsRunResult} from "vibelang/context"`,
		`import * as ns from "vibelang/context"; export type Hook = typeof ns.__vsRunResult`,
		`import {__vsRunResult} from "vibelang/not-a-compiler-module"; export const hook = __vsRunResult`,
		`import * as ns from "vibelang/not-a-compiler-module"; export const hook = ns.__vsRunResult`,
	} {
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}})
		for _, diagnostic := range result.Diagnostics {
			if diagnostic.Code == "VIBE1201" {
				t.Fatalf("non-runtime or non-compiler binding reported private: %s\n%+v", source, result.Diagnostics)
			}
		}
	}
}

func TestPinnedForkPrivateNativeConstructorsUseResolvedComputedMembers(t *testing.T) {
	for _, key := range []string{`"VibeLangOk"`, `("VibeLangOk" as const)`, `("VibeLangOk" satisfies string)`, `KEY`} {
		source := `import * as ns from "vibelang/context"; const KEY = "VibeLangOk"; export const hook = ns[` + key + `]`
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}})
		requireDiagnostic(t, result, "VIBE1201", "main.vibe", "compiler-owned Result constructor")
		if !result.EmitSkipped || len(result.Artifacts) != 0 {
			t.Fatal("a computed private constructor emitted an executable")
		}
	}
}
