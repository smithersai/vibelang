package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkProjectQueryForeignPropertyEvaluation(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`export const value=foreign.width`,
		`export const value=foreign["width"]`,
		`const KEY="width";export const value=foreign[KEY]`,
		`export const {width}=foreign`,
		`export class Box{static value=foreign.width}`,
		`export class Box{static {const value=foreign.width;void value}}`,
		`export const box={ [String(foreign.width)]:42 }`,
		`export function main(){return foreign.width}`,
		`export function main(value=foreign.width){return value}`,
		`export function main({width}=foreign){return width}`,
	} {
		t.Run(body, func(t *testing.T) {
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{
					{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import {foreign} from "./foreign.ts";` + body},
					{Path: "foreign.ts", Kind: FileKindTypeScript, Text: "/** @module @throws {never} */\nexport const foreign={get width():number{throw new Error('getter')}}"},
				}})
			if err != nil {
				t.Fatal(err)
			}
			message := "foreign property/accessor"
			if strings.Contains(body, "{width}") {
				message = "destructuring a foreign value"
			}
			requireDiagnostic(t, result, "VIBE1506", "main.vibe", message)
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("an untyped getter escaped the foreign boundary")
			}
		})
	}
	for _, source := range []string{
		`import type {Data} from "./foreign.ts";const value:Data={width:42};export const width=value.width`,
		`import * as namespace from "./foreign.ts";export const foreign=namespace.foreign`,
		`const foreign={width:42};export const {width}=foreign`,
	} {
		result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source},
				{Path: "foreign.ts", Kind: FileKindTypeScript, Text: "/** @module @throws {never} */\nexport interface Data{width:number};export const foreign={width:42}"}}})
		if err != nil || result.EmitSkipped {
			t.Fatalf("refused ordinary value/namespace selection: %s\n%+v %v", source, result, err)
		}
	}
}

func TestPinnedForkProjectQueryGenericRowRequiresSpelledTemplate(t *testing.T) {
	for _, prefix := range []string{"", "export "} {
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
			Text: prefix + `function leak<E extends Error>(error:E){throw error}`}})
		requireDiagnostic(t, result, "VIBE1803", "main.vibe", "no Result contract")
		if !result.EmitSkipped || len(result.Artifacts) != 0 {
			t.Fatal("uninstantiable inferred generic row emitted")
		}
	}
}

func TestPinnedForkProjectQueryErrorMatchNamesResolvedModule(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "a.vibe", Kind: FileKindVibeLang, Text: `export class Boom extends Error{}`},
		{Path: "nested/b.vibe", Kind: FileKindVibeLang, Text: `export class Boom extends Error{}`},
		{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import {Boom as A} from './a.vibe';import {Boom as B} from './nested/b.vibe';export function describe(error:A|B):string{return error.match({A:()=>"a"})}`},
	})
	found := false
	for _, issue := range result.Diagnostics {
		if issue.Code == "VIBE1253" {
			found = strings.Contains(issue.Message, "Boom@nested/b")
		}
	}
	if !found || !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("missing Error identity lost its module: %+v", result)
	}
}

func TestPinnedForkProjectQueryErrorMatchOverrideKeepsNominalRule(t *testing.T) {
	for _, member := range []string{"match", "matchPartial"} {
		for _, selection := range []string{"." + member, "[\"" + member + "\"]"} {
			source := `class E extends Error { ` + member + `():string{return "ordinary"} }
export function main():string{return new E()` + selection + `()}`
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}})
			requireDiagnostic(t, result, "VIBE1251", "main.vibe", "object literal")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("an Error override escaped nominal match validation")
			}
		}
	}
	for _, source := range []string{
		`class E{match():string{return "ordinary"}};export function main():string{return new E().match()}`,
		`const value={name:"Error",message:"ordinary",match:()=>"ordinary"};export function main():string{return value.match()}`,
	} {
		result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}})
		requireClean(t, result)
	}
}

func TestPinnedForkProjectQueryIndexedCallbackKeepsFunctionIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const prefix = `import {Context} from "vibelang/context";
abstract class Db extends Context {abstract read():string}
class Boom extends Error{}
function hof(callback:()=>unknown):string {return String(callback())}
const capability=():string=>{if(Db.context().read()==="")throw new Boom();return "v"};
const list=[capability];`
	for _, argument := range []string{
		`list[0]`, `(list[0])`, `list[0] as ()=>unknown`, `<()=>unknown>list[0]`,
		`list[0] satisfies unknown`, `((list[0] as unknown) as ()=>unknown)`,
	} {
		t.Run(argument, func(t *testing.T) {
			files := []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: prefix + `export function f():string{return hof(` + argument + `)}`}}
			result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: files})
			if err != nil || result.Checked {
				t.Fatalf("callback contract was not refused: %+v %v", result, err)
			}
			foundDiagnostic, foundRequirement := false, false
			for _, issue := range result.Diagnostics {
				foundDiagnostic = foundDiagnostic || issue.Code == "VIBE1303"
			}
			for _, file := range result.Files {
				for _, fn := range file.Functions {
					if fn.Name == "f" {
						foundRequirement = strings.Join(fn.Requirements, ",") == "Db"
					}
				}
			}
			if !foundDiagnostic || !foundRequirement {
				t.Fatalf("indexed callback lost its contract or capability: %+v", result)
			}
		})
	}
	// An authored optional element is not the option-added undefined branch.
	// Its presence cannot be proven by removing noUncheckedIndexedAccess's effect.
	result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
		Text: `const list:Array<(()=>number)|undefined>=[undefined];export function main():number{return list[0]()}`}})
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("authored optional callback became callable: %+v", result)
	}
}
