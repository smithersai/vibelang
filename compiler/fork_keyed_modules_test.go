package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func keyedModuleRequest() KeyedSourceRequest {
	r := keyedSourceTestRequest(`import {durable} from "vibelang:flows";
import {Work} from "./api";
export const Build=durable((n:number)=>{const value=Work.run(n)!;return value});`)
	r.Dependencies = []KeyedSourceDependency{
		{FileName: "api.vibe", Source: `export {Work} from "./contracts/work";`},
		{FileName: "contracts/work.vibe", Source: `import {Action} from "vibelang:flows";
export class Work extends Action<(n:number)=>Result<number,never>> {}`},
	}
	r.ProvidersJSON = strings.Replace(r.ProvidersJSON, "flow.vibe#Work", "contracts/work.vibe#Work", 1)
	return r
}

func TestPinnedForkKeyedSourceModules(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedSourceCompiler)
	r := keyedModuleRequest()
	got, err := query.CompileKeyedPlanSource(ctx, r)
	if err != nil || !got.OK {
		t.Fatalf("source modules: %+v err=%v", got, err)
	}
	var plan struct {
		Nodes []struct{ Material struct{ Body map[string]any } }
	}
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	body := plan.Nodes[0].Material.Body
	if body["contract"].(map[string]any)["id"] != "contracts/work.vibe#Work" {
		t.Fatalf("declaration identity lost: %+v", body)
	}
	evidence := body["source"].(map[string]any)
	if len(evidence["projectDigest"].(string)) != 64 || evidence["fileName"] != r.FileName {
		t.Fatalf("project identity absent: %+v", evidence)
	}
	reordered := r
	reordered.Dependencies = []KeyedSourceDependency{r.Dependencies[1], r.Dependencies[0]}
	again, err := query.CompileKeyedPlanSource(ctx, reordered)
	if err != nil || !again.OK || again.PlanJSON != got.PlanJSON {
		t.Fatalf("source list order changed graph: %+v %v", again, err)
	}
	reordered.Dependencies[0].Source += "\n// changed dependency bytes"
	changed, err := query.CompileKeyedPlanSource(ctx, reordered)
	if err != nil || !changed.OK || changed.PlanJSON == got.PlanJSON {
		t.Fatalf("dependency bytes not bound: %+v %v", changed, err)
	}
	verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
	if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
		t.Fatalf("multi-module Plan verification: %+v %v", verified, err)
	}
}

func TestPinnedForkKeyedSourceModuleBindings(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, imported, expression string }{
		{"alias", `import {Work as Renamed} from "./api";`, "Renamed"},
		{"namespace", `import * as API from "./api";`, "API.Work"},
		{"direct", `import {Work} from "./contracts/work";`, "Work"},
		{"explicit language extension", `import {Work} from "./contracts/work.vibe";`, "Work"},
		{"emitted JS extension", `import {Work} from "./contracts/work.js";`, "Work"},
		{"reexport-star", `import * as API from "./star";`, "API.Work"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedModuleRequest()
			r.Source = `import {durable} from "vibelang:flows";` + tc.imported + `export const Build=durable((n:number)=>{return ` + tc.expression + `.run(n)!});`
			r.Dependencies = append(r.Dependencies, KeyedSourceDependency{FileName: "star.vibe", Source: `export * from "./contracts/work";`})
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("module binding: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedSourceDependencyFailuresKeepTheirNominalModule(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	r := keyedModuleRequest()
	r.Dependencies[1].Source = `import {Action} from "vibelang:flows"; import {Bad} from "./errors";
export class Work extends Action<(n:number)=>Result<number,Bad>> {}`
	r.Dependencies = append(r.Dependencies, KeyedSourceDependency{FileName: "contracts/errors.vibe", Source: `export class Bad extends Error { readonly code:string="bad" }`})
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || !got.OK || !strings.Contains(got.PlanJSON, `contracts/errors.vibe@Bad@1`) {
		t.Fatalf("nominal imported failure lost: %+v %v", got, err)
	}
}

func TestPinnedForkKeyedSourceDefaultActionModules(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, name := range []string{"Work", ""} {
		t.Run("class_"+name, func(t *testing.T) {
			r := keyedModuleRequest()
			r.Source = `import {durable} from "vibelang:flows";import Renamed from "./api";export const Build=durable((n:number)=>{return Renamed.run(n)!});`
			r.Dependencies[0].Source = `export {default} from "./contracts/work";`
			r.Dependencies[1].Source = `import {Action} from "vibelang:flows";export default class ` + name + ` extends Action<(n:number)=>Result<number,never>>{}`
			r.ProvidersJSON = strings.Replace(r.ProvidersJSON, "contracts/work.vibe#Work", "contracts/work.vibe#default", 1)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK || !strings.Contains(got.PlanJSON, `contracts/work.vibe#default`) {
				t.Fatalf("default Action identity: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedSourceDependencyRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, source string }{
		{"mutation", `const state={n:1};state.n=2;`},
		{"unused value initializer", `const state=1;`},
		{"static initializer", `class State { static n=1 }`},
		{"anonymous static initializer", `export default class { static n=1 }`},
		{"static block", `class State { static { while(true){} } }`},
		{"Action override", `export class Work extends Action<(n:number)=>Result<number,never>> { static run(n:number):Result<number,never>{return n} }`},
		{"unused anonymous Action override", `import {Action} from "vibelang:flows";export default class extends Action<(n:number)=>Result<number,never>> { static run(n:number):Result<number,never>{return n} }`},
		{"decorator", `function mark<T extends abstract new(...args:any[])=>object>(value:T,context:ClassDecoratorContext<T>):T{return value} @mark class State {}`},
		{"wrong type", `// 🌋\nexport function bad():number{return "wrong"}`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedModuleRequest()
			if tc.name == "Action override" {
				r.Dependencies[1].Source = `import {Action} from "vibelang:flows";` + tc.source
			} else {
				r.Dependencies = append(r.Dependencies, KeyedSourceDependency{FileName: "extra.vibe", Source: strings.ReplaceAll(tc.source, `\n`, "\n")})
			}
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) == 0 {
				t.Fatalf("dependency refusal: %+v %v", got, err)
			}
			if tc.name == "wrong type" && got.Diagnostics[0].File != "extra.vibe" {
				t.Fatalf("dependency diagnostic relabeled: %+v", got.Diagnostics)
			}
		})
	}
}

func TestPinnedForkKeyedSourceDependencyWireRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct {
		name         string
		dependencies []KeyedSourceDependency
	}{
		{"duplicate root", []KeyedSourceDependency{{FileName: "flow.vibe", Source: ""}}},
		{"duplicate dependency", []KeyedSourceDependency{{FileName: "a.vibe", Source: ""}, {FileName: "a.vibe", Source: ""}}},
		{"escape", []KeyedSourceDependency{{FileName: "../a.vibe", Source: ""}}},
		{"absolute", []KeyedSourceDependency{{FileName: "/a.vibe", Source: ""}}},
		{"uncanonical path", []KeyedSourceDependency{{FileName: "x/../a.vibe", Source: ""}}},
		{"typescript module", []KeyedSourceDependency{{FileName: "a.ts", Source: ""}}},
		{"aggregate budget", []KeyedSourceDependency{{FileName: "a.vibe", Source: strings.Repeat(" ", 2*1024*1024)}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedModuleRequest()
			r.Dependencies = tc.dependencies
			if got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r); err == nil {
				t.Fatalf("invalid dependency envelope accepted: %+v", got)
			}
		})
	}
}
