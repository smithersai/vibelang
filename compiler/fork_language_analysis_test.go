package compiler

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

func TestForkLanguageAnalysisProtocol(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("shell fixture is Unix-only")
	}
	source := "function work() { return 42 }"
	request := LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}}
	valid := LanguageAnalysisResult{Checked: true, Diagnostics: []Diagnostic{}, Files: []AnalyzedFile{{Path: "main.vibe", Analyzed: true, Errors: []AnalyzedError{}, Functions: []AnalyzedFunction{{
		Name: "work", Channel: "plain", Start: 0, End: len(source), BodyStart: 16, BodyEnd: len(source), ModuleScope: true, Failures: []string{}, Requirements: []string{},
	}}}}}
	for _, tc := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"valid", nil},
		{"missing completion", func(v map[string]any) { delete(v, "checked") }},
		{"null completion", func(v map[string]any) { v["checked"] = nil }},
		{"unexplained refusal", func(v map[string]any) { v["checked"] = false }},
		{"missing file", func(v map[string]any) { v["files"] = []any{} }},
		{"extra artifact", func(v map[string]any) { v["artifacts"] = []any{} }},
		{"unknown file", func(v map[string]any) { v["files"].([]any)[0].(map[string]any)["path"] = "other.vibe" }},
		{"missing analyzed flag", func(v map[string]any) { delete(v["files"].([]any)[0].(map[string]any), "analyzed") }},
		{"wrong diagnostic category", func(v map[string]any) {
			v["diagnostics"] = []any{map[string]any{"code": "TS2304", "category": "failure", "message": "missing"}}
		}},
		{"checked error", func(v map[string]any) {
			v["diagnostics"] = []any{map[string]any{"code": "TS2304", "category": "error", "message": "missing"}}
		}},
		{"missing module scope", func(v map[string]any) {
			delete(v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any), "moduleScope")
		}},
		{"null async", func(v map[string]any) {
			v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any)["async"] = nil
		}},
		{"function AST", func(v map[string]any) {
			v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any)["node"] = map[string]any{}
		}},
		{"body escapes", func(v map[string]any) {
			v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any)["bodyEnd"] = len(source) + 1
		}},
		{"plain failure", func(v map[string]any) {
			v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any)["failures"] = []string{"Boom"}
		}},
		{"duplicate row", func(v map[string]any) {
			v["files"].([]any)[0].(map[string]any)["functions"].([]any)[0].(map[string]any)["requirements"] = []string{"Db", "Db"}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			encoded, _ := json.Marshal(valid)
			var value map[string]any
			if err := json.Unmarshal(encoded, &value); err != nil {
				t.Fatal(err)
			}
			if tc.mutate != nil {
				tc.mutate(value)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			wire := fmt.Sprintf(`{"apiVersion":%d,"compilerRevision":%q,"result":%s}`, APIVersion, PinnedTypeScriptRevision, encoded)
			executable := filepath.Join(t.TempDir(), "bridge")
			if err := os.WriteFile(executable, []byte("#!/bin/sh\nprintf '%s' '"+strings.ReplaceAll(wire, "'", "'\\''")+"'\n"), 0o755); err != nil {
				t.Fatal(err)
			}
			got, err := (&forkCompiler{executable: executable}).AnalyzeLanguage(context.Background(), request)
			if tc.mutate == nil {
				if err != nil || !reflect.DeepEqual(got, valid) {
					t.Fatalf("%+v %v", got, err)
				}
			} else if !errors.Is(err, ErrForkProtocol) {
				t.Fatalf("accepted malformed analysis: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkLanguageAnalysis(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	one := func(text string) LanguageAnalysisRequest {
		return LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: text}}}
	}
	for _, tc := range []struct {
		name, source, failures, requirements string
		checked, analyzed                    bool
	}{
		{"plain", `export function work(n: number) { return n + 1 }`, "", "", true, true},
		{"async", `export async function work(n: number): Promise<number> { return n + 1 }`, "", "", true, true},
		{"unannotated exported Error", `class Boom extends Error {} export function work() { throw new Boom() }`, "Boom", "", false, true},
		{"typed Result", `class Boom extends Error {} export function work(): Result<number, Boom> { throw new Boom() }`, "Boom", "", true, true},
		{"global Panic type", `export function work(): Result<number, Panic> { return Result.try(() => 42) }`, "Panic", "", true, true},
		{"transitive capability", `import { Context } from "vibelang/context"; abstract class Db extends Context { abstract read(): number } function helper() { return Db.context().read() } export function work() { return helper() }`, "", "Db", true, true},
		{"missing capability", `import { Context } from "vibelang/context"; abstract class Db extends Context { abstract read(): number } export function work() { return Db.context().read() } work();`, "", "Db", false, true},
		{"type error", `export function work(): number { return "wrong" }`, "", "", false, true},
		{"syntax error", `export function work( {`, "", "", false, false},
		{"native conditional", `export function work(){if(const x=42;x>0){return x}else{return x+1}}`, "", "", true, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			input := one(tc.source)
			got, err := analyzer.AnalyzeLanguage(ctx, input)
			if err != nil || got.Checked != tc.checked || len(got.Files) != 1 || got.Files[0].Analyzed != tc.analyzed {
				t.Fatalf("got=%+v err=%v", got, err)
			}
			if tc.analyzed {
				var work *AnalyzedFunction
				for i := range got.Files[0].Functions {
					if got.Files[0].Functions[i].Name == "work" {
						work = &got.Files[0].Functions[i]
					}
				}
				if work == nil || !work.ModuleScope || !work.Exported || strings.Join(work.Failures, ",") != tc.failures || strings.Join(work.Requirements, ",") != tc.requirements {
					t.Fatalf("wrong function facts: %+v", got.Files[0])
				}
			} else if len(got.Files[0].Functions)+len(got.Files[0].Errors) != 0 {
				t.Fatal("syntax-refused file invented facts", got.Files)
			}
			compiled, err := backend.Compile(ctx, CompileRequest{RootNames: []string{"main.vibe"}, Files: input.Files, Lowering: LoweringInternal})
			if err != nil || got.Checked == compiled.EmitSkipped || !reflect.DeepEqual(got.Diagnostics, compiled.Diagnostics) {
				t.Fatalf("analysis/compile disagree: %+v / %+v; %v", got, compiled.Diagnostics, err)
			}
			if !tc.checked {
				proof, err := backend.(CheckedFunctionInspector).CheckedFunction(ctx, CheckedFunctionRequest{Files: input.Files, EntryFile: "main.vibe", ExportName: "work"})
				if err != nil || proof.OK || proof.Function != nil {
					t.Fatalf("provisional metadata became a proof: %+v %v", proof, err)
				}
			}
		})
	}

	t.Run("authored UTF16 and module addressability", func(t *testing.T) {
		source := "// 😀\r\n" + `class Boom extends Error { readonly code = "a"; }
export function work(): Result<number, Boom> { throw new Boom() }
export class Box { work() { return 1 } }
export const arrow = async () => 42;
function outer() { function work() { return 2 }; return work() }
export function __proto__() { return 3 }`
		got, err := analyzer.AnalyzeLanguage(ctx, one(source))
		if err != nil || !got.Checked {
			t.Fatalf("%+v %v", got, err)
		}
		file := got.Files[0]
		if len(file.Errors) != 1 || file.Errors[0].Start != utf16Extent(source[:strings.Index(source, "class Boom")]) || file.Errors[0].FieldsSource != ` readonly code = "a";` {
			t.Fatal("lost authored Error range/member text", file.Errors)
		}
		count, module := 0, 0
		for _, fn := range file.Functions {
			if fn.Name == "work" {
				count++
				if fn.ModuleScope {
					module++
				}
			}
			if fn.Name == "arrow" && (!fn.Async || !fn.ModuleScope || !fn.Exported) {
				t.Fatal("arrow flags", fn)
			}
		}
		if count != 3 || module != 1 {
			t.Fatal("colliding names lost addressability", file.Functions)
		}
	})

	t.Run("cross-module fixed point and order", func(t *testing.T) {
		input := LanguageAnalysisRequest{Files: []SourceFile{
			{Path: "z.vibe", Kind: FileKindVibeLang, Text: `import { helper, type Boom } from "./a.vibe"; export function work(): Result<number, Boom> { return helper()! }`},
			{Path: "a.vibe", Kind: FileKindVibeLang, Text: `export class Boom extends Error {} export function helper(): Result<number, Boom> { throw new Boom() }`},
		}}
		got, err := analyzer.AnalyzeLanguage(ctx, input)
		if err != nil || !got.Checked || len(got.Files) != 2 || got.Files[0].Path != "a.vibe" || got.Files[1].Path != "z.vibe" || strings.Join(got.Files[1].Functions[0].Failures, ",") != "Boom" {
			t.Fatalf("%+v %v", got, err)
		}
	})

	for _, input := range []LanguageAnalysisRequest{
		{Files: []SourceFile{{Path: "../escape.vibe", Kind: FileKindVibeLang, Text: ""}}},
		{Files: []SourceFile{{Path: "a.vibe", Kind: FileKindVibeLang, Text: "", Lowered: &LoweredSource{Text: ""}}}},
		{Files: []SourceFile{{Path: "a.vibe", Kind: FileKindVibeLang, Text: strings.Repeat(" ", 2*1024*1024+1)}}},
		{Files: []SourceFile{{Path: "a.vibe", Kind: FileKindVibeLang}, {Path: "a.vibe", Kind: FileKindVibeLang}}},
	} {
		t.Run("refuses malformed closure", func(t *testing.T) {
			if got, err := analyzer.AnalyzeLanguage(ctx, input); err == nil {
				t.Fatal("accepted", got)
			}
		})
	}
	if got, err := analyzer.AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: []SourceFile{}}); err != nil || !got.Checked || len(got.Files) != 0 || len(got.Diagnostics) != 0 {
		t.Fatalf("empty analysis=%+v %v", got, err)
	}
}

func TestPinnedForkLanguageAnalysisDiskResolution(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	for _, tc := range []struct {
		name, source               string
		files                      map[string]string
		code, requirement, failure string
	}{
		{"authored dependency", `import {work} from "./helper.vibe";export function main(){return work()}`, map[string]string{
			"helper.vibe": `import {Context} from "vibelang/context";abstract class Db extends Context {abstract read():number};export function work(){return Db.context().read()}`,
		}, "", "Db", ""},
		{"transitive authored dependency", `import {work,type Boom} from "./helper.vibe";export function main():Result<number,Boom>{return work()!}`, map[string]string{
			"helper.vibe":      `export {work,Boom} from "./nested/leaf.vibe"`,
			"nested/leaf.vibe": `export class Boom extends Error{};export function work():Result<number,Boom>{throw new Boom()}`,
		}, "", "", "Boom"},
		{"trusted foreign", `import {read} from "./foreign.ts";export function main(){return read()}`, map[string]string{
			"foreign.ts": "/** @module @throws {never} */\n/** @throws {never} */\nexport function read(){return 42}",
		}, "", "", ""},
		{"trusted JavaScript JSDoc", `import {read} from "./foreign.js";export function main():number{return read()}`, map[string]string{
			"foreign.js": "/** @module @throws {never} */\n/** @throws {never} @returns {number} */\nexport function read(){return 42}",
		}, "", "", ""},
		{"JavaScript JSDoc failure row", `import {read} from "./foreign.js";export function main():Result<number,Panic>{return read()!}`, map[string]string{
			"foreign.js": "/** @module @throws {never} */\n/** @returns {number} */\nexport function read(){return 42}",
		}, "", "", "Panic"},
		{"untrusted foreign", `import {value} from "./foreign.ts";export const main=value`, map[string]string{
			"foreign.ts": `export const value=42`,
		}, "VIBE1510", "", ""},
		{"type dependency", `import type {Value} from "./value.d.ts";export function main(value:Value):number{return value.count}`, map[string]string{
			"value.d.ts": `export interface Value {readonly count:number}`,
		}, "", "", ""},
		{"native package resolution", `import type {Value} from "./lib";export function main(value:Value):number{return value.count}`, map[string]string{
			"lib/package.json":     `{"types":"./types/value.d.ts"}`,
			"lib/types/value.d.ts": `export interface Value {readonly count:number}`,
		}, "", "", ""},
		{"native asset staging", `import value from "./config.json" with {type:"json",mode:"const"};export function main():number{return value.count}`, map[string]string{
			"config.json": `{"count":42}`,
		}, "", "", ""},
		{"missing dependency", `import {read} from "./absent.ts";export function main(){return read()}`, nil, "VIBE1510", "", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			root := t.TempDir()
			for name, source := range tc.files {
				target := filepath.Join(root, filepath.FromSlash(name))
				if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(target, []byte(source), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			input := LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: tc.source}}, ResolutionRoot: root}
			got, err := analyzer.AnalyzeLanguage(ctx, input)
			if err != nil {
				t.Fatal(err)
			}
			if len(got.Files) != 1 || got.Files[0].Path != "main.vibe" {
				t.Fatalf("dependency replaced public file identity: %+v", got)
			}
			if tc.code != "" {
				for _, issue := range got.Diagnostics {
					if issue.Code == tc.code && !got.Checked {
						return
					}
				}
				t.Fatalf("missing %s: %+v", tc.code, got)
			}
			if !got.Checked || len(got.Diagnostics) != 0 {
				t.Fatalf("dependency resolution refused: %+v", got)
			}
			if len(got.Files[0].Functions) != 1 || strings.Join(got.Files[0].Functions[0].Requirements, ",") != tc.requirement || strings.Join(got.Files[0].Functions[0].Failures, ",") != tc.failure {
				t.Fatalf("dependency effects lost: %+v", got)
			}
		})
	}
}

func TestPinnedForkLanguageAnalysisGrammarRefusalIsNotAProof(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `class Holder {value!:string};class Boom extends Error{}
declare function lookup():Result<string,Boom>;
export function work():Result<string,Boom>{return lookup().unwrap()}
function nonNull(value:string|undefined):string{return value!}`
	files := []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: source}}
	got, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: files})
	if err != nil || got.Checked || len(got.Files) != 1 || !got.Files[0].Analyzed {
		t.Fatalf("provisional grammar view: %+v %v", got, err)
	}
	for _, code := range []string{"VIBE1001", "VIBE1206", "VIBE1207"} {
		found := false
		for _, issue := range got.Diagnostics {
			found = found || issue.Code == code
		}
		if !found {
			t.Fatalf("lost independent %s: %+v", code, got.Diagnostics)
		}
	}
	compiled, err := backend.Compile(ctx, CompileRequest{Files: files, RootNames: []string{"main.vibe"}, Lowering: LoweringInternal})
	if err != nil || !compiled.EmitSkipped || len(compiled.Artifacts) != 0 {
		t.Fatalf("grammar-refused source emitted: %+v %v", compiled, err)
	}
	proof, err := backend.(CheckedFunctionInspector).CheckedFunction(ctx, CheckedFunctionRequest{Files: files, EntryFile: "main.vibe", ExportName: "work"})
	if err != nil || proof.OK || proof.Function != nil {
		t.Fatalf("grammar facts became a proof: %+v %v", proof, err)
	}
}

func TestPinnedForkLanguageAnalysisDiskBoundaries(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "helper.vibe"), []byte(`export function work(){return 1}`), 0o600); err != nil {
		t.Fatal(err)
	}
	input := LanguageAnalysisRequest{Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import {work} from "./helper.vibe";export function main(){return work()}`}}}
	without, err := analyzer.AnalyzeLanguage(ctx, input)
	if err != nil || without.Checked {
		t.Fatalf("read disk without authority: %+v %v", without, err)
	}
	input.ResolutionRoot = root
	input.Files = append(input.Files, SourceFile{Path: "helper.vibe", Kind: FileKindVibeLang, Text: `import {Context} from "vibelang/context";abstract class Db extends Context{};export function work(){return Db.context()}`})
	got, err := analyzer.AnalyzeLanguage(ctx, input)
	if err != nil || !got.Checked || len(got.Files) != 2 || strings.Join(got.Files[1].Functions[0].Requirements, ",") != "Db" {
		t.Fatalf("disk shadowed supplied bytes: %+v %v", got, err)
	}
	for _, tc := range []struct {
		name string
		data []byte
	}{
		{"oversized", []byte(strings.Repeat(" ", 2*1024*1024+1))},
		{"invalid UTF8", []byte{0xff, 0xfe}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := os.WriteFile(filepath.Join(root, "helper.vibe"), tc.data, 0o600); err != nil {
				t.Fatal(err)
			}
			if result, err := analyzer.AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: input.Files[:1], ResolutionRoot: root}); err == nil {
				t.Fatalf("accepted bad dependency: %+v", result)
			}
		})
	}
	for _, invalidRoot := range []string{"relative", root + "\x00", filepath.Join(root, "absent")} {
		if result, err := analyzer.AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: input.Files[:1], ResolutionRoot: invalidRoot}); err == nil {
			t.Fatalf("accepted bad root %q: %+v", invalidRoot, result)
		}
	}
	if runtime.GOOS != "windows" {
		outside := t.TempDir()
		if err := os.WriteFile(filepath.Join(outside, "helper.vibe"), []byte(`export function work(){return 2}`), 0o600); err != nil {
			t.Fatal(err)
		}
		aliasRoot := t.TempDir()
		if err := os.Symlink(filepath.Join(outside, "helper.vibe"), filepath.Join(aliasRoot, "helper.vibe")); err != nil {
			t.Fatal(err)
		}
		if result, err := analyzer.AnalyzeLanguage(ctx, LanguageAnalysisRequest{Files: input.Files[:1], ResolutionRoot: aliasRoot}); err == nil || !strings.Contains(err.Error(), "symbolic-link alias") {
			t.Fatalf("accepted alias: %+v %v", result, err)
		}
	}
}

func TestPinnedForkLanguageAnalysisExplicitAuthoredSources(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	analyzer := backend.(LanguageAnalyzer)
	root := t.TempDir()
	write := func(name string, data []byte) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(root, name), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write("helper.vibe", []byte(`export function work(){return 42}`))
	write("foreign.ts", []byte("/** @module @throws {never} */\nexport const tag=1;\n/** @throws {never} */\nexport function work():number{return 42}"))
	write("relay.ts", []byte("/** @module @throws {never} */\nexport {work} from './helper.vibe'"))
	input := LanguageAnalysisRequest{ResolutionRoot: root, ExplicitVibeLangSources: true,
		Files: []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `import {work} from "./helper.vibe";export function main(){return work()}`}}}
	missing, err := analyzer.AnalyzeLanguage(ctx, input)
	if err != nil || missing.Checked {
		t.Fatalf("discovered an omitted authored file: %+v %v", missing, err)
	}
	found := false
	for _, issue := range missing.Diagnostics {
		found = found || issue.Code == "VIBE1801"
	}
	if !found {
		t.Fatalf("omitted source lost its closure diagnostic: %+v", missing)
	}
	open := input
	open.ExplicitVibeLangSources = false
	if result, err := analyzer.AnalyzeLanguage(ctx, open); err != nil || !result.Checked {
		t.Fatalf("default discovery no longer works: %+v %v", result, err)
	}

	// Invalid bytes prove that these are not reads followed by discarded facts.
	write("helper.vibe", []byte{0xff, 0xfe})
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err != nil || result.Checked {
		t.Fatalf("closed analysis read the omitted file: %+v %v", result, err)
	}
	if result, err := analyzer.AnalyzeLanguage(ctx, open); err == nil {
		t.Fatalf("ordinary discovery failed to validate dependency bytes: %+v", result)
	}
	for _, module := range []string{"foreign.ts", "relay.ts"} {
		probe := input
		probe.Files = []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang,
			Text: `import {work} from "./` + module + `";export function main(){return work()}`}}
		result, err := analyzer.AnalyzeLanguage(ctx, probe)
		if err != nil || result.Checked != (module == "foreign.ts") {
			t.Fatalf("foreign dependency policy for %s: %+v %v", module, result, err)
		}
	}
	input.Files = append(input.Files, SourceFile{Path: "helper.vibe", Kind: FileKindVibeLang, Text: `export function work(){return 42}`})
	if result, err := analyzer.AnalyzeLanguage(ctx, input); err != nil || !result.Checked || len(result.Files) != 2 {
		t.Fatalf("explicit overlay did not win over disk: %+v %v", result, err)
	}
}
