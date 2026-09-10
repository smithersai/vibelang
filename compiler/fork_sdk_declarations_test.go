package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkSDKDeclarationTarget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const runtime = "/selected/runtime/index.js"
	const published = `/** @vibelangModule {"version":2,"runtimes":["/selected/runtime/index.js"],"requirements":"requirements"} */
import { Context, type ResultType } from "/selected/runtime/index.js";
export declare abstract class Db extends Context { abstract read(): number; }
export declare class Boom extends Error {}
/** @vibelangEffects {"version":2,"failures":[],"requirements":["Db"],"convention":"eager"} */
export declare function read(): number;
/** @vibelangEffects {"version":2,"failures":["Boom"],"requirements":["Db"],"convention":"eager"} */
export declare function fallible(): ResultType<number, Boom>;
export type address = "/selected/runtime/index.js";
export type requirements = { readonly Db: typeof Db };
`
	one := func(source, declarations string) LanguageAnalysisRequest {
		return LanguageAnalysisRequest{Files: []SourceFile{
			{Path: "main.vibe", Kind: FileKindVibeLang, Text: source},
			{Path: "library.d.ts", Kind: FileKindTypeScript, Text: declarations},
		}}
	}
	const caller = `import {read} from "./library.js"; export function main(){return read()}`
	t.Run("published imports retain explicit SDK output relocation", func(t *testing.T) {
		for _, binding := range []string{`{read}`, `* as lib`} {
			call := "read()"
			if binding == `* as lib` {
				call = "lib.read()"
			}
			project := one(`import `+binding+` from "./library.js"; export const spelling="./library.js"; export function main(){return `+call+`}`, published)
			got, err := backend.(LanguageLowerer).LowerLanguage(ctx, LanguageLoweringRequest{
				Project: project, RuntimeImport: runtime,
				Outputs: []LanguageLoweringOutput{
					{Path: "main.vibe", OutputFileName: "/out/main.mjs"},
					{Path: "library.js", OutputFileName: "/out/foreign/library.mjs"},
				},
			})
			if err != nil || !got.OK || len(got.Files) != 1 {
				t.Fatalf("%s: %+v %v", binding, got, err)
			}
			if !strings.Contains(got.Files[0].Text, `from "./foreign/library.mjs"`) ||
				!strings.Contains(got.Files[0].Text, `import("./foreign/library.mjs")`) ||
				!strings.Contains(got.Files[0].Text, `spelling = "./library.js"`) ||
				strings.Contains(got.Files[0].Text, `import("./library.js")`) {
				t.Fatalf("published %s import lost relocation:\n%s", binding, got.Files[0].Text)
			}
		}
	})
	for _, tc := range []struct{ name, source, declarations, runtime, code string }{
		{"plain published call", caller, published, runtime, ""},
		{"Result published call", `import {fallible,type Boom} from "./library.js"; export function main():Result<number,Boom>{return fallible()!}`, published, runtime, ""},
		{"provided capability", `import {Db,read} from "./library.js"; import {Layer} from "vibelang/provider"; export const answer=Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>read())`, published, runtime, ""},
		{"unprovided capability", caller + `; main();`, published, runtime, "VIBE2102"},
		{"wrong runtime", caller, published, "/other/runtime/index.js", "VIBE1810"},
		{"mixed runtime claims", caller, strings.Replace(published, `["/selected/runtime/index.js"]`, `["/other/runtime/index.js","/selected/runtime/index.js"]`, 1), runtime, "VIBE1810"},
		{"malformed module", caller, strings.Replace(published, `"version":2,`, `"version":2,"version":2,`, 1), runtime, "VIBE1810"},
		{"standalone ABI cannot become SDK", caller, strings.Replace(published, `"version":2,"runtimes"`, `"version":3,"runtimeABI":"vibelang-go-eager@1","runtimes"`, 1), runtime, "VIBE1810"},
		{"ordinary string type is untouched", `import type {address} from "./library.js"; export function main():address{return "/selected/runtime/index.js"}`, published, runtime, ""},
		{"string type is not a module edge", `import type {address} from "./library.js"; export function main():address{return "/src/__vibelang_sdk_declarations.d.ts"}`, published, runtime, "TS2322"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			project := one(tc.source, tc.declarations)
			got, err := backend.(LanguageLowerer).LowerLanguage(ctx, LanguageLoweringRequest{Project: project, RuntimeImport: tc.runtime})
			if err != nil {
				t.Fatal(err)
			}
			found := false
			for _, issue := range got.Analysis.Diagnostics {
				found = found || issue.Code == tc.code
			}
			if tc.code != "" {
				if got.OK || len(got.Files) != 0 || !found {
					t.Fatalf("wanted %s, got %+v", tc.code, got)
				}
				return
			}
			if !got.OK || len(got.Files) != 1 || strings.Contains(got.Files[0].Text, "__vibelang_sdk_declarations") {
				t.Fatalf("%+v", got)
			}
			if strings.Contains(tc.name, "published call") {
				if len(got.Analysis.Files) != 1 || len(got.Analysis.Files[0].Functions) != 1 || strings.Join(got.Analysis.Files[0].Functions[0].Requirements, ",") != "Db" {
					t.Fatalf("lost published row: %+v", got.Analysis)
				}
			}
			project.SDKRuntimeImport = tc.runtime
			analysis, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, project)
			if err != nil || !analysis.Checked {
				t.Fatalf("explicit SDK query disagrees: %+v %v", analysis, err)
			}
		})
	}
	t.Run("standalone compilation cannot borrow an SDK contract", func(t *testing.T) {
		project := one(caller, published)
		got, err := backend.Compile(ctx, CompileRequest{Files: project.Files, RootNames: []string{"main.vibe"}, Lowering: LoweringInternal})
		if err != nil || !got.EmitSkipped {
			t.Fatalf("%+v %v", got, err)
		}
		for _, issue := range got.Diagnostics {
			if issue.Code == "VIBE1810" {
				return
			}
		}
		t.Fatal(got.Diagnostics)
	})
	t.Run("a source cannot occupy the private facet", func(t *testing.T) {
		project := one(caller, published)
		project.Files = append(project.Files, SourceFile{Path: "__vibelang_sdk_declarations.d.ts", Kind: FileKindTypeScript, Text: "export {}"})
		got, err := backend.(LanguageLowerer).LowerLanguage(ctx, LanguageLoweringRequest{Project: project, RuntimeImport: runtime})
		if err == nil || got.OK {
			t.Fatalf("accepted private facet injection: %+v %v", got, err)
		}
	})
}
