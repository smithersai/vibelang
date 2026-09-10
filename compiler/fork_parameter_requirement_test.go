package compiler

import (
	"strings"
	"testing"
)

const parameterRequirementPrelude = `import {Context} from "vibelang/context";
import {Layer} from "vibelang/provider";
abstract class Db extends Context {abstract read():number}
function get():number{return Db.context().read()}
`

func TestPinnedForkParameterDefaultsChargeTheirOwner(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, declaration, call string }{
		{"direct", `function read(value=Db.context().read()){return value}`, `read()`},
		{"through helper", `function read(value=get()){return value}`, `read()`},
		{"destructured default", `function read({value=Db.context().read()}:{value?:number}={}){return value}`, `read()`},
		{"nested destructuring", `function read({box:{value=get()}={}}:{box?:{value?:number}}={}){return value}`, `read()`},
		{"array default", `function read([value=get()]:[number?]=[]){return value}`, `read()`},
		{"arrow", `const read=(value=get())=>value`, `read()`},
		{"method", `const reader={read(value=get()){return value}}`, `reader.read()`},
		{"constructor", `class Reader{constructor(readonly value=get()){}}`, `new Reader().value`},
		{"higher order default", `function read(value=[0].map(()=>get())[0]){return value}`, `read()`},
		{"default getter", `const box={get value(){return get()}};function read(value=box.value){return value}`, `read()`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := parameterRequirementPrelude + tc.declaration + `;export const answer=` + tc.call
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}})
			if err != nil {
				t.Fatal(err)
			}
			requireDiagnostic(t, result, "VIBE2102", "main.vibe", "Db")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("default initializer erased its capability requirement")
			}
			provided := parameterRequirementPrelude + tc.declaration +
				`;export function main(){return Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>` + tc.call + `)}`
			result, err = backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Lowering: LoweringInternal,
				Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: provided}}})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			if actual := runPublishedConsumer(t, CompileResult{}, result); actual != "42" {
				t.Fatalf("provided default computed %q", actual)
			}
		})
	}
	for _, source := range []string{
		`export function read(value=get()){return value}`,
		`export const read=(value=Db.context().read())=>value`,
	} {
		result, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, LanguageAnalysisRequest{
			Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: parameterRequirementPrelude + source}}})
		if err != nil || !result.Checked {
			t.Fatalf("a declaration alone does not read its default: %+v %v", result, err)
		}
		found := false
		for _, file := range result.Files {
			for _, fn := range file.Functions {
				if fn.Name == "read" {
					found = strings.Join(fn.Requirements, ",") == "Db"
				}
			}
		}
		if !found {
			t.Fatalf("default requirement missing from callable metadata: %+v", result)
		}
	}
}

func TestPinnedForkParameterDefaultsKeepOrdinaryAndLexicalScopes(t *testing.T) {
	for _, source := range []string{
		`function read(value=42){return value};export const answer=read()`,
		`function read(value=42, twice=value*2){return twice};export const answer=read()`,
		`function read(Db:{read():number},value=Db.read()){return value};export const answer=read({read:()=>42})`,
		`function read(callback=()=>get()){return 42};export const answer=read()`,
		`const callback=()=>get();function read(value=callback){return 42};export const answer=read()`,
		`function read(value:typeof Date|undefined=undefined){return 42};export const answer=read()`,
	} {
		t.Run(source, func(t *testing.T) {
			result := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
				Text: parameterRequirementPrelude + source}})
			requireClean(t, result)
		})
	}
}

func TestPinnedForkParameterDefaultsPreserveCrossModuleRequirements(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	seam := SourceFile{Path: "service.vibe", Kind: FileKindVibeLang, Text: `import {Context} from "vibelang/context";
export abstract class Db extends Context {abstract read():number}
export function get():number{return Db.context().read()}`}
	for _, declaration := range []string{
		`export function read(value=get()){return value}`,
		`export function read({value=get()}:{value?:number}={}){return value}`,
		`export const read=(value=get())=>value`,
	} {
		t.Run(declaration, func(t *testing.T) {
			prefix := `import {Db,get} from "./service.vibe";import {Layer} from "vibelang/provider";` + declaration + `;`
			files := []SourceFile{seam, {Path: "main.vibe", Kind: FileKindVibeLang,
				Text: prefix + `export const answer=read()`}}
			result, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: files, Lowering: LoweringInternal})
			if err != nil {
				t.Fatal(err)
			}
			requireDiagnostic(t, result, "VIBE2102", "main.vibe", "Db")
			if !result.EmitSkipped || len(result.Artifacts) != 0 {
				t.Fatal("cross-module parameter default escaped its requirement")
			}
			files[1].Text = prefix + `export function main(){return Layer.provide(Layer.succeed(Db,{read:()=>42}),()=>read())}`
			result, err = backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: files, Lowering: LoweringInternal})
			if err != nil {
				t.Fatal(err)
			}
			requireClean(t, result)
			if actual := runPublishedConsumer(t, CompileResult{}, result); actual != "42" {
				t.Fatalf("provided cross-module default computed %q", actual)
			}
		})
	}
}

func TestPinnedForkParameterDefaultsSurviveSourceFreePublication(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, source, call string }{
		{"function", `export function read(value=C.context().value()){return value}`, `lib.read()`},
		{"arrow", `export const read=(value=C.context().value())=>value`, `lib.read()`},
		{"method", `export class Reader{read(value=C.context().value()){return value}}`, `new lib.Reader().read()`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			producer := compilePublishedLibrary(t, backend, ctx, publishedContextSource+tc.source, false)
			declaration := artifactTextsByPath(t, producer.Artifacts)["library.d.vibe.ts"]
			if !strings.Contains(declaration, `"requirements":["C"]`) {
				t.Fatalf("parameter default disappeared from the published row:\n%s", declaration)
			}
			unprovided := compilePublishedConsumer(t, backend, ctx, producer,
				`import * as lib from './library.vibe';export const answer=`+tc.call+`;`)
			requireCode(t, unprovided, "VIBE2102", "C")
			if !unprovided.EmitSkipped || len(unprovided.Artifacts) != 0 {
				t.Fatal("a source-free default requirement escaped checking")
			}
			consumer := compilePublishedConsumer(t, backend, ctx, producer,
				`import * as lib from './library.vibe';import {Layer} from 'vibelang/provider';export function main(){return Layer.provide(Layer.succeed(lib.C,{value:()=>7}),()=>`+tc.call+`)}`)
			if actual := runPublishedConsumer(t, producer, consumer); actual != "7" {
				t.Fatalf("published default computed %q, expected 7", actual)
			}
		})
	}
}
