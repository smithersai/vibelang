package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkBodyLowering(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	lowerer := backend.(BodyLowerer)
	request := func(source string) BodyLoweringRequest {
		return BodyLoweringRequest{
			Source: source, FileName: "flows/body.vibe", FlowVersion: 1, RuntimeImport: "vibelang/runtime", OutputFileName: "/output/body.ts",
		}
	}
	const action = `import {durable, Action} from "vibelang:flows"; class Read extends Action<(n:number)=>Result<number,never>>{};`
	for _, tc := range []struct {
		name, source, contains  string
		resumable, asynchronous bool
	}{
		{"pure", `import {durable} from "vibelang:flows"; export const Flow=durable((n:number)=>n+1)`, "n + 1", false, false},
		{"captured mutation", `import {durable} from "vibelang:flows"; const state={value:1}; state.value=2; export const Flow=durable((n:number)=>state.value+n)`, "state.value = 2", false, false},
		{"action", action + `export const Flow=durable((n:number):Result<number,never>=>Read.run(n)!)`, "yield* __vsPerform", true, false},
		{"helper", action + `function read(n:number):Result<number,never>{return Read.run(n)!} export const Flow=durable((n:number):Result<number,never>=>read(n)!)`, "yield* read(n)", true, false},
		{"async", action + `export const Flow=durable(async(n:number):Promise<Result<number,never>>=>{await Promise.resolve();return Read.run(n)!})`, "async function*", true, true},
		{"async pure", `import {durable} from "vibelang:flows"; export const Flow=durable(async(n:number)=>n+1)`, "async", false, true},
		{"native Error", `import {durable} from "vibelang:flows"; export const Flow=durable((n:number):Result<number,Error>=>{throw new Error("failure")})`, "new Error", false, false},
		{"authored Error", `import {durable} from "vibelang:flows"; class Failed extends Error {}; export const Flow=durable((n:number):Result<number,Failed>=>{throw new Failed("failure")})`, "new Failed", false, false},
		{"namespace timer", `import * as Flows from "vibelang:flows"; export const Flow=Flows.durable((n:number)=>Flows.sleep(n))`, "__vsPerform<null, number>", true, false},
		{"provided", action + `import {Context} from "vibelang/context"; import {Layer} from "vibelang/provider"; abstract class Bias extends Context {abstract value:number}; export const Flow=durable((n:number)=>Layer.provide(Layer.succeed(Bias,{value:2}),():Result<number,never>=>Bias.context().value+Read.run(n)!))`, "yield* __vsProvide", true, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := lowerer.LowerBody(ctx, request(tc.source))
			if err != nil || !got.OK || got.Resumable != tc.resumable || got.Async != tc.asynchronous || !strings.Contains(got.Code, tc.contains) {
				t.Fatalf("lowering %+v err=%v", got, err)
			}
			if strings.Contains(got.Code, "__vibelang_prelude") || strings.Contains(got.Code, "durable(") {
				t.Fatal(got.Code)
			}
		})
	}
	t.Run("logical extension does not change language semantics or identities", func(t *testing.T) {
		r := request(action + `export const Flow=durable((n:number):Result<number,never>=>Read.run(n)!)`)
		r.FileName = "flows/body.ts"
		got, err := lowerer.LowerBody(ctx, r)
		if err != nil || !got.OK || len(got.DerivedActions) != 1 || got.DerivedActions[0].ID != "flows/body.ts#Read" {
			t.Fatalf("%+v %v", got, err)
		}
	})
	for _, tc := range []struct{ name, source, code string }{
		{"empty source", "", "VIBE4102"},
		{"nested", action + `function make(){const Flow=durable((n:number)=>n); return Flow}`, "VIBE4103"},
		{"arity", action + `export const Flow=durable((n:number)=>Read.run(n, 1))`, "VIBE4113"},
		{"unprovided initialization", action + `function read(n:number):Result<number,never>{return Read.run(n)!}; const initial=read(1).unwrapOr(0); export const Flow=durable((n:number)=>initial+read(n).unwrapOr(0))`, "VIBE2102"},
		{"non-finite input", `import {durable,Action} from "vibelang:flows"; class Read extends Action<(n:{value:number})=>Result<number,never>>{}; export const Flow=durable((n:number)=>Read.run({value:-1e999}))`, "VIBE4111"},
		{"undriven callback", action + `export const Flow=durable((n:number)=>[n].map(x=>Read.run(x).unwrapOr(0)).length)`, "VIBE1802"},
		{"unconsumed request", action + `export const Flow=durable((n:number)=>{Read.run(n); return n})`, "VIBE1301"},
		{"unconsumed promise", action + `export const Flow=durable((n:number)=>{Promise.resolve(n); return n})`, "VIBE1402"},
		{"opaque output", action + `export const Flow=durable((n:number):unknown=>n)`, "VIBE4110"},
		{"plain never propagation", action + `export const Flow=durable((n:number)=>Read.run(n)!)`, "VIBE1202"},
		{"conflicting intrinsic", `import {durable} from "vibelang:flows"; const durable=(f:unknown)=>f; export const Flow=durable((n:number)=>n)`, "VIBE4100"},
		{"type-only namespace", `import type * as Flows from "vibelang:flows"; export const Flow=Flows.durable((n:number)=>n)`, "VIBE4102"},
		{"ordinary helper failure", `import {durable} from "vibelang:flows"; function waitSignal<T>(name:string):T{throw new Error(name)}; export const Flow=durable((n:number)=>waitSignal<string>("ordinary"))`, "VIBE1101"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := lowerer.LowerBody(ctx, request(tc.source))
			found := false
			for _, issue := range got.Diagnostics {
				found = found || issue.Code == tc.code
			}
			if err != nil || got.OK || !found || got.Code != "" || len(got.DerivedActions) != 0 {
				t.Fatalf("refusal %+v err=%v", got, err)
			}
		})
	}
}

func TestBodyLoweringProtocol(t *testing.T) {
	request := BodyLoweringRequest{Source: "export const Flow=(n:number)=>n+1", FileName: "flow.vibe", FlowVersion: 1, OutputFileName: "/output/flow.ts"}
	valid := func() map[string]any {
		return map[string]any{
			"ok": true, "reason": "", "diagnostics": []any{}, "code": request.Source, "entry": "Flow", "entrySpan": map[string]any{"start": 0, "length": len(request.Source)},
			"functionSpan": map[string]any{"start": 18, "length": len(request.Source) - 18}, "async": false, "resumable": false, "derivedActions": []any{}, "errors": []any{},
			"sourceMap":    `{"version":3,"file":"flow.ts","sourceRoot":"","sources":["flow.vibe"],"sourcesContent":["export const Flow=(n:number)=>n+1"],"names":[],"mappings":"AAAA"}`,
			"manifestJson": `{"manifestVersion":1,"flowId":"flow.vibe#Flow","flowVersion":1,"actions":[],"requirements":[],"contracts":[],"failures":[],"sites":[],"digest":"` + strings.Repeat("a", 64) + `"}`,
		}
	}
	for _, tc := range []struct {
		name   string
		change func(map[string]any)
	}{
		{"valid", nil}, {"missing convention", func(v map[string]any) { delete(v, "resumable") }}, {"null convention", func(v map[string]any) { v["async"] = nil }},
		{"compiler object", func(v map[string]any) { v["checker"] = map[string]any{} }}, {"missing diagnostics", func(v map[string]any) { delete(v, "diagnostics") }},
		{"missing source map", func(v map[string]any) { delete(v, "sourceMap") }}, {"missing entry span", func(v map[string]any) { delete(v, "entrySpan") }},
		{"unknown reason", func(v map[string]any) { v["reason"] = "fallback" }}, {"unexplained refusal", func(v map[string]any) { v["ok"] = false }},
		{"entry span outside source", func(v map[string]any) { v["entrySpan"] = map[string]int{"start": 999, "length": 1} }},
		{"entry cannot extend past EOF", func(v map[string]any) { v["entrySpan"] = map[string]int{"start": len(request.Source), "length": 1} }},
		{"function cannot extend past EOF", func(v map[string]any) { v["functionSpan"] = map[string]int{"start": len(request.Source), "length": 1} }},
		{"changed source content", func(v map[string]any) { v["sourceMap"] = strings.ReplaceAll(v["sourceMap"].(string), "n+1", "n+2") }},
		{"wrong source identity", func(v map[string]any) {
			v["sourceMap"] = strings.ReplaceAll(v["sourceMap"].(string), "flow.vibe", "other.vibe")
		}},
		{"wrong manifest identity", func(v map[string]any) {
			v["manifestJson"] = strings.ReplaceAll(v["manifestJson"].(string), "flow.vibe#Flow", "other#Flow")
		}},
		{"invalid mapping", func(v map[string]any) { v["sourceMap"] = strings.ReplaceAll(v["sourceMap"].(string), "AAAA", "g") }},
		{"out-of-source Action", func(v map[string]any) {
			v["derivedActions"] = []any{map[string]any{"name": "Read", "id": "flow.vibe#Read", "start": 0, "end": 999}}
		}},
		{"duplicate errors", func(v map[string]any) {
			v["errors"] = []any{map[string]string{"durable": "a", "nominal": "a"}, map[string]string{"durable": "a", "nominal": "a"}}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := valid()
			if tc.change != nil {
				tc.change(value)
			}
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			_, err = decodeBodyLowering(encoded, request)
			if (err == nil) != (tc.change == nil) {
				t.Fatalf("decode err=%v", err)
			}
		})
	}
}
