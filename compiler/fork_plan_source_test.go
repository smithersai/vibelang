package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkPlanSourceArtifacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(PlanSourceCompiler)
	for _, fixture := range []string{"durable-inputs", "durable-loop", "durable-fanout", "durable-fanout-steps"} {
		t.Run(fixture, func(t *testing.T) {
			source := readTextFile(t, "testdata/"+fixture+".vibe")
			request := PlanSourceRequest{Source: source, FileName: "main.vibe", FlowVersion: 1, Mode: "plan"}
			got, err := query.CompilePlanSource(ctx, request)
			if err != nil || got.Status != "plan" || len(got.Diagnostics) != 0 || got.ManifestFailure != "" {
				t.Fatalf("Plan source: %+v err=%v", got, err)
			}
			compiled := compileDurableWith(t, backend, ctx, source)
			if compiled.EmitSkipped || len(compiled.Diagnostics) != 0 {
				t.Fatalf("standalone compile: %+v", compiled.Diagnostics)
			}
			var emitted struct{ Plan, Manifest json.RawMessage }
			if err := json.Unmarshal([]byte(runComptimeProgram(t, compiled)), &emitted); err != nil {
				t.Fatal(err)
			}
			if got.PlanJSON != string(emitted.Plan) || got.ManifestJSON != string(emitted.Manifest) {
				t.Fatalf("standalone query differs from language lowering\nquery: %s\nemit: %s\nquery manifest: %s\nemit manifest: %s", got.PlanJSON, emitted.Plan, got.ManifestJSON, emitted.Manifest)
			}
			validateWithReferenceArtifactRules(t, CompileResult{Artifacts: []Artifact{{Path: "main.js", Content: []byte("export const Build = {plan:" + got.PlanJSON + "}")}}})
			request.Mode = "manifest"
			independent, err := query.CompilePlanSource(ctx, request)
			if err != nil || independent.Status != "manifest" || independent.PlanJSON != "" || independent.ManifestJSON != got.ManifestJSON {
				t.Fatalf("independent Manifest: %+v err=%v", independent, err)
			}
		})
	}
}

func TestPinnedForkPlanSourceIdentitiesAndSpans(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(PlanSourceCompiler)
	source := `import * as F from "vibelang:flows";
// astral scalar before every source span: 🌋
class Unused extends F.Action<(n:number)=>Result<string,never>> {}
class Failure extends Error { readonly code: string = "bad" }
class Work extends F.Action<(n:number)=>Result<number,Failure>> {}
function body(n:number) { return Work.run(n) }
export const Build = F.durable(body)`
	request := PlanSourceRequest{Source: source, FileName: "source/__vibelang_flows.ts", FlowID: "custom/Flow", FlowVersion: 7, Mode: "plan"}
	got, err := query.CompilePlanSource(ctx, request)
	if err != nil || got.Status != "plan" || len(got.DerivedActions) != 2 {
		t.Fatalf("logical identity: %+v err=%v", got, err)
	}
	for index, name := range []string{"Unused", "Work"} {
		action := got.DerivedActions[index]
		start := strings.Index(source, "class "+name)
		if action.Name != name || action.Start != utf16Extent(source[:start]) || action.ID != request.FileName+"#"+name {
			t.Fatalf("derived declaration lost UTF-16 identity/span: %+v", action)
		}
	}
	if !strings.Contains(got.ManifestJSON, "source/__vibelang_flows.ts@Failure@1") || strings.Contains(got.ManifestJSON, "__vibelang_plan_source__") {
		t.Fatalf("staging address leaked into durable identity: %s", got.ManifestJSON)
	}
	request.Source = strings.Replace(source, "Work.run(n)", `Work.run("wrong")`, 1)
	refused, err := query.CompilePlanSource(ctx, request)
	if err != nil || refused.Status != "refused" || len(refused.Diagnostics) == 0 {
		t.Fatalf("bad Action input: %+v err=%v", refused, err)
	}
	start := strings.Index(request.Source, `"wrong"`)
	if refused.Diagnostics[0].Span.Start != utf16Extent(request.Source[:start]) {
		t.Fatalf("refusal span is not authored UTF-16: %+v", refused.Diagnostics)
	}
}

func TestPinnedForkPlanSourceRefusesAndSeparatesRepresentability(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(PlanSourceCompiler)
	for _, tc := range []struct{ name, source, status, code string }{
		{"syntax", `import {durable} from "vibelang:flows"; durable((`, "refused", "VIBE4100"},
		{"ordinary same spelling", `function durable(f:unknown){}; durable((n:number)=>n)`, "refused", "VIBE4102"},
		{"type-only namespace", `import type * as F from "vibelang:flows"; F.durable((n:number)=>{return n})`, "refused", "VIBE4102"},
		{"two declarations", `import {durable} from "vibelang:flows"; const A=durable((n:number)=>{return n}); const B=durable((n:number)=>{return n})`, "refused", "VIBE4102"},
		{"ambiguous import", `import {durable} from "vibelang:flows"; const durable=(f:unknown)=>f; const A=durable((n:number)=>{return n})`, "refused", "VIBE4100"},
		{"missing boundary", `import {durable} from "vibelang:flows"; const A=durable((n:any)=>{return n})`, "refused", "VIBE4110"},
		{"bad annotation", `import {durable} from "vibelang:flows"; const A=durable((n:number)=>{const value:string=n;return value})`, "refused", "VIBE4100"},
		{"wrong propagated member type", `import {durable,Action} from "vibelang:flows"; class Read extends Action<(n:number)=>Result<{id:string},never>>{}; class Write extends Action<(n:number)=>Result<number,never>>{}; const A=durable((n:number)=>{const read=Read.run(n)!;return Write.run(read.id)})`, "refused", "VIBE4100"},
		{"missing propagated member", `import {durable,Action} from "vibelang:flows"; class Read extends Action<(n:number)=>Result<{id:string},never>>{}; const A=durable((n:number)=>{const read=Read.run(n)!;return read.missing})`, "refused", "VIBE4100"},
		{"runtime branch", `import {durable} from "vibelang:flows"; const A=durable((n:number)=>{if(n>0)return n;return 0})`, "unrepresentable", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := PlanSourceRequest{Source: tc.source, FileName: "source.vibe", FlowVersion: 1, Mode: "plan"}
			got, err := query.CompilePlanSource(ctx, request)
			if err != nil || got.Status != tc.status || got.PlanJSON != "" || got.ManifestJSON != "" || len(got.DerivedActions) != 0 {
				t.Fatalf("refusal: %+v err=%v", got, err)
			}
			if tc.code != "" && (len(got.Diagnostics) == 0 || got.Diagnostics[0].Code != tc.code) {
				t.Fatalf("wrong refusal: %+v", got.Diagnostics)
			}
			if tc.status == "unrepresentable" {
				request.Mode = "manifest"
				manifest, err := query.CompilePlanSource(ctx, request)
				if err != nil || manifest.Status != "manifest" || manifest.PlanJSON != "" {
					t.Fatalf("runtime branch has no independent Manifest: %+v err=%v", manifest, err)
				}
			}
		})
	}
	for _, mode := range []string{"", "body", "typescript"} {
		if _, err := query.CompilePlanSource(ctx, PlanSourceRequest{Source: "", FileName: "source.vibe", FlowVersion: 1, Mode: mode}); err == nil {
			t.Fatal("invalid mode accepted")
		}
	}
}

func TestPinnedForkPlanActionInputMatchesItsWireContract(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, source, message string }{
		{"propagated member", `class Read extends Action<(n:number)=>Result<{id:string},never>>{}; class Write extends Action<(n:number)=>Result<number,never>>{};
export const A=durable((n:number)=>{const read=Read.run(n)!;return Write.run(read.id)})`, "checked input contract"},
		{"extra serialized fields", `class Write extends Action<(n:{value:number})=>Result<number,never>>{};
export const A=durable((n:{value:number;extra:string})=>{return Write.run(n)})`, "durable input contract"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {Action,durable} from "vibelang:flows";` + tc.source
			got := compileDurableWith(t, backend, ctx, source)
			for _, issue := range got.Diagnostics {
				if got.EmitSkipped && len(got.Artifacts) == 0 && issue.Code == "VIBE4100" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("Action wire mismatch survived Plan erasure: %+v", got.Diagnostics)
		})
	}
}
