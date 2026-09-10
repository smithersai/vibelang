package compiler

import (
	"strings"
	"testing"
)

// A Plan is data, but its source remains a fully checked VibeLang program.
// Check the complete body before erasure, with Result success-value semantics.
func TestPinnedForkKeyedSourceCheckedBodies(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct {
		name, declarations, body string
		accepted                 bool
	}{
		{"explicit Result lifts success", "", `(n:number):Result<number,never>=>{return n}`, true},
		{"explicit Result propagates Action", "", `(n:number):Result<number,never>=>{return Work.run(n)!}`, true},
		{"explicit Result returns Action", "", `(n:number):Result<number,never>=>{return Work.run(n)}`, true},
		{"typed child success", `const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});`, `(n:number):Result<number,never>=>{return Child.run(n)!}`, true},
		{"inferred child collection", `const Child=durable((n:number)=>{return [n,2]});`, `(n:number)=>{const items=Child.run(n)!;return fanOut(items,v=>v,v=>Work.run(v))}`, true},
		{"inferred nested collection", `const Child=durable((n:number)=>{return {items:[n,2]}});`, `(n:number)=>{const data=Child.run(n)!;return fanOut(data.items,v=>v,v=>Work.run(v))}`, true},
		{"constructed success collection", "", `(n:number)=>{const value=Work.run(n)!;return fanOut([value,2],v=>v,v=>Work.run(v))}`, false},
		{"wrong Result success", "", `(n:number):Result<string,never>=>{return n}`, false},
		{"wrong propagated Result success", "", `(n:number):Result<string,never>=>{return Work.run(n)!}`, false},
		{"unused incompatible annotation", "", `(n:number)=>{const ignored:string=n;return n}`, false},
		{"unused unknown name", "", `(n:number)=>{const ignored=missing;return n}`, false},
		{"wrong callback annotation", "", `(n:number)=>{return fanOut([n],(v:string)=>v,v=>Work.run(v))}`, false},
		{"wrong callback Result", "", `(n:number)=>{return fanOut([n],v=>v,(v:number):Result<string,never>=>{return v})}`, false},
		{"uninvoked bad function", `function ignored(n:number):string{return n}`, `(n:number)=>{return n}`, false},
		{"wrong nominal error", `class A extends Error{};class B extends Error{};class Fallible extends Action<(n:number)=>Result<number,A>>{};`, `(n:number):Result<number,B>=>{return Fallible.run(n)!}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};` + tc.declarations + `export const Flow=durable(` + tc.body + `);`
			request := keyedSourceTestRequest(source)
			if tc.name == "explicit Result lifts success" {
				request.ProvidersJSON = "[]"
			}
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
			if err != nil || got.OK != tc.accepted || !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0) {
				t.Fatalf("body checking: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkStaticPlanCheckingIsQueryOnly(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	request := LanguageAnalysisRequest{StaticPlanCheck: true, Files: []SourceFile{{Path: "flow.vibe", Kind: FileKindVibeLang,
		Text: `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number):Result<readonly number[],never>=>{return [n,2]});
export const Flow=durable((n:number)=>{const items=Child.run(n)!;return fanOut(items,v=>v,(v:number):Result<number,never>=>{return Work.run(v)!})});`}}}
	checked, err := backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, request)
	if err != nil || !checked.Checked {
		t.Fatalf("retained body source query: %+v %v", checked, err)
	}
	_, err = backend.(LanguageLowerer).LowerLanguage(ctx, LanguageLoweringRequest{Project: request, RuntimeImport: "vibelang/runtime"})
	if err == nil || !strings.Contains(err.Error(), "cannot authorize runtime lowering") {
		t.Fatalf("private checking profile authorized executable emission: %v", err)
	}
	request.Files[0].Text = strings.Replace(request.Files[0].Text, "return [n,2]", `const ignored:string=n;return [n,2]`, 1)
	checked, err = backend.(LanguageAnalyzer).AnalyzeLanguage(ctx, request)
	if err != nil || checked.Checked || len(checked.Diagnostics) == 0 {
		t.Fatalf("query discarded an unused type error: %+v %v", checked, err)
	}
}

func TestPinnedForkKeyedSourceFanOutFailureRows(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, declarations, row, callback string }{
		{"inferred callback cannot erase failure", "", "never", `v=>Work.run(v)`},
		{"typed callback cannot erase failure", "", "never", `(v:number):Result<number,Bad>=>{return Work.run(v)!}`},
		{"declared failure accepted", "", "Bad", `(v:number):Result<number,Bad>=>{return Work.run(v)!}`},
		{"child callback failure", `const Child=durable((n:number)=>{return fanOut([n],v=>v,v=>Work.run(v))});`, "never", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `fanOut([n],v=>v,` + tc.callback + `)`
			if tc.callback == "" {
				body = `Child.run(n)!`
			}
			source := `import {Action,durable,fanOut} from "vibelang:flows";class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};` +
				tc.declarations + `export const Flow=durable((n:number):Result<readonly number[],` + tc.row + `>=>{return ` + body + `});`
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, keyedSourceTestRequest(source))
			if err != nil || got.OK != (tc.row == "Bad") {
				t.Fatalf("fan-out failure row: accepted %t diagnostics %+v %v", got.OK, got.Diagnostics, err)
			}
			if !got.OK {
				codes := []string{}
				for _, issue := range got.Diagnostics {
					codes = append(codes, issue.Code)
				}
				if got.PlanJSON != "" || !strings.Contains(strings.Join(codes, ","), "VIBE1104") {
					t.Fatalf("expected explicit error-row refusal: %+v", got)
				}
			}
		})
	}
}

func TestPinnedForkConciseResultRows(t *testing.T) {
	for _, body := range []string{`fail()`, `{return fail()}`} {
		for _, row := range []string{"Bad", "never"} {
			got := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `class Bad extends Error{};function fail():Result<number,Bad>{throw new Bad()};const forward=()=>` + body +
				`;function main():Result<number,` + row + `>{return forward()!}`}})
			if got.EmitSkipped != (row == "never") {
				t.Fatalf("concise/block row %s: %+v", row, got.Diagnostics)
			}
			if row == "never" && (len(got.Diagnostics) == 0 || got.Diagnostics[0].Code != "VIBE1104") {
				t.Fatalf("returned Result row disappeared: %+v", got.Diagnostics)
			}
		}
	}
}

func TestPinnedForkForwardedResultCallbackABI(t *testing.T) {
	for _, tc := range []struct {
		body string
		ok   bool
	}{
		{`fail()`, true},
		{`{return fail()}`, true},
		{`{const value=fail();return value}`, true},
		{`{try{throw new Error()}catch{}return fail()}`, true},
		{`fail()!`, false},
		{`{const value=fail()!;return fail()}`, false},
		{`{if(true)throw new Bad();return fail()}`, false},
		{`{const obj={ [fail()!]() {return 1} };return fail()}`, false},
	} {
		for _, layer := range []bool{false, true} {
			header := `class Bad extends Error{};function fail():Result<number,Bad>{throw new Bad()};`
			call := `apply(()=>` + tc.body + `)`
			if layer {
				header += `import {Context} from "vibelang/context";import {Layer} from "vibelang/provider";abstract class Need extends Context{abstract n:number};const env=Layer.succeed(Need,{n:1});`
				call = `Layer.provide(env,()=>` + tc.body + `)`
			} else {
				header += `function apply(f:()=>Result<number,Bad>):Result<number,Bad>{return f()}`
			}
			got := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: header + `function main(){return ` + call + `.unwrapOr(0)}`}})
			if got.EmitSkipped == tc.ok {
				t.Fatalf("callback %s layer %t: %+v", tc.body, layer, got.Diagnostics)
			}
			if !tc.ok {
				want := "VIBE1303"
				if layer {
					want = "VIBE2105"
				}
				codes := []string{}
				for _, issue := range got.Diagnostics {
					codes = append(codes, issue.Code)
				}
				if !strings.Contains(strings.Join(codes, ","), want) {
					t.Fatalf("callback lost explicit-contract refusal %s: %+v", want, got.Diagnostics)
				}
			}
		}
	}
}

func TestPinnedForkResultCallbackDefaultIsNotForwarding(t *testing.T) {
	got := compileInternalSource(t, []SourceFile{{Path: "main.vibe", Kind: FileKindVibeLang, Text: `class Bad extends Error{};function fail():Result<number,Bad>{throw new Bad()};
const cb=(n=fail()!)=>fail();function apply(f:()=>Result<number,Bad>):Result<number,Bad>{return f()};
function main(){return apply(cb).unwrapOr(0)}`}})
	for _, issue := range got.Diagnostics {
		if issue.Code == "VIBE1303" && got.EmitSkipped {
			return
		}
	}
	t.Fatalf("callback default propagation passed as forwarding: %+v", got.Diagnostics)
}

func TestPinnedForkKeyedSourceSequentialFailureRows(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, row := range []string{"Bad", "never"} {
		for _, child := range []bool{false, true} {
			source := `import {Action,durable,sequential} from "vibelang:flows";class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};`
			callee := "Work"
			if child {
				source += `const Child=durable((n:number)=>{return Work.run(n)});`
				callee = "Child"
			}
			source += `export const Flow=durable((n:number):Result<readonly [number,number],` + row + `>=>{return sequential(` + callee + `.run(n),` + callee + `.run(2))});`
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, keyedSourceTestRequest(source))
			if err != nil || got.OK != (row == "Bad") {
				t.Fatalf("sequential row %s child %t: diagnostics %+v %v", row, child, got.Diagnostics, err)
			}
			if !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0 || got.Diagnostics[0].Code != "VIBE1104") {
				t.Fatalf("sequential row erasure: %+v", got.Diagnostics)
			}
		}
	}
}
