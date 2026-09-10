package compiler

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

const keyedSourceExample = `import { Action, durable } from "vibelang:flows";
class Work extends Action<(input: number) => Result<number, never>> {}
export const Build = durable((input: number) => {
  const first = Work.run(input)!;
  const second = Work.run(input)!;
  return { second, first };
});`

func keyedSourceTestRequest(source string) KeyedSourceRequest {
	return KeyedSourceRequest{Source: source, FileName: "flow.vibe", FlowVersion: 1, FlowID: "example/Build", PlanID: "example/plan",
		InputJSON: "41", ProvidersJSON: `[{"actionId":"flow.vibe#Work","implementationId":"work/v1","implementationDigest":"` + strings.Repeat("a", 64) + `","tier":"sealed","effects":{"boundaryMode":"hard","reads":[],"writes":[]},"layers":[],"capabilities":[]}]`}
}

func TestPinnedForkKeyedSourceGraph(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedSourceCompiler)
	request := keyedSourceTestRequest(keyedSourceExample)
	got, err := query.CompileKeyedPlanSource(ctx, request)
	if err != nil || !got.OK {
		t.Fatalf("source compile: %+v err=%v", got, err)
	}
	verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
	if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
		t.Fatalf("source Plan failed reconstruction: %+v err=%v", verified, err)
	}
	var plan struct {
		PlanID, Flow, Digest string
		Nodes                []struct {
			ID, Key   string
			DependsOn []string
			Material  struct {
				Kind, Version string
				Body          map[string]any
				Inputs        []map[string]any
			}
		}
	}
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Nodes) != 3 || plan.Nodes[0].ID != "action/0" || plan.Nodes[1].ID != "action/1" || plan.Nodes[2].ID != "result" ||
		len(plan.Nodes[0].DependsOn) != 0 || len(plan.Nodes[1].DependsOn) != 0 || len(plan.Nodes[2].DependsOn) != 2 {
		t.Fatalf("independent nodes were sequenced or result abandoned work: %s", got.PlanJSON)
	}
	if plan.Nodes[0].Key != plan.Nodes[1].Key {
		t.Fatal("structural address leaked into equivalent Action identity")
	}
	body := plan.Nodes[0].Material.Body
	if body["operation"] != "action" || body["abi"] != "vibelang/keyed-source/v2" || body["implementationDigest"] != strings.Repeat("a", 64) ||
		body["contract"].(map[string]any)["id"] != "flow.vibe#Work" || body["source"].(map[string]any)["fileName"] != "flow.vibe" ||
		plan.Nodes[0].Material.Inputs[0]["value"] != float64(41) {
		t.Fatalf("checked contract/input/implementation binding missing: %s", got.PlanJSON)
	}
	entries := plan.Nodes[2].Material.Body["expression"].(map[string]any)["entries"].([]any)
	if entries[0].(map[string]any)["name"] != "second" || entries[1].(map[string]any)["name"] != "first" {
		t.Fatal("source object construction order was canonicalized away")
	}
	for _, change := range []struct {
		name string
		edit func(*KeyedSourceRequest)
	}{
		{"source", func(r *KeyedSourceRequest) { r.Source += "\n// changed bytes" }},
		{"input", func(r *KeyedSourceRequest) { r.InputJSON = "42" }},
		{"provider code", func(r *KeyedSourceRequest) {
			r.ProvidersJSON = strings.Replace(r.ProvidersJSON, strings.Repeat("a", 64), strings.Repeat("b", 64), 1)
		}},
		{"effects", func(r *KeyedSourceRequest) {
			r.ProvidersJSON = strings.Replace(r.ProvidersJSON, `"writes":[]`, `"writes":["shared.txt"]`, 1)
		}},
		{"tier", func(r *KeyedSourceRequest) {
			r.ProvidersJSON = strings.Replace(r.ProvidersJSON, "sealed", "irreversible", 1)
		}},
	} {
		t.Run(change.name, func(t *testing.T) {
			r := request
			change.edit(&r)
			changed, err := query.CompileKeyedPlanSource(ctx, r)
			if err != nil || !changed.OK || changed.PlanJSON == got.PlanJSON {
				t.Fatalf("changed material failed to bind: %+v err=%v", changed, err)
			}
			var next struct{ Digest string }
			_ = json.Unmarshal([]byte(changed.PlanJSON), &next)
			if next.Digest == plan.Digest {
				t.Fatal("approval digest ignored changed source/input/provider/effects")
			}
		})
	}
}

func TestPinnedForkKeyedSourceActionDataEdge(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	request := keyedSourceTestRequest(strings.Replace(keyedSourceExample, "const second = Work.run(input)!", "const second = Work.run(first)!", 1))
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
	if err != nil || !got.OK || !strings.Contains(got.PlanJSON, `"_tag":"Ref","from":"action/0","path":[]`) {
		t.Fatalf("propagated success lost its checked value type: %+v err=%v", got, err)
	}
}

func TestPinnedForkKeyedSourceEncodedProjections(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {Action,durable} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<{nested:[{z:number;a:number}]},never>>{};
export const Build=durable((n:number)=>{const value=Work.run(n)!;return {whole:value.nested[0],scalar:value.nested[0].z}})`
	request := keyedSourceTestRequest(source)
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
	if err != nil || !got.OK ||
		!strings.Contains(got.PlanJSON, `"path":["items","nested","items","0"]`) ||
		!strings.Contains(got.PlanJSON, `"path":["items","nested","items","0","items","z"]`) {
		t.Fatalf("data projection did not bind the ordered storage codec: %+v err=%v", got, err)
	}
}

func TestPinnedForkKeyedSourceCompositeActionInputs(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct {
		name, shape, input, binding string
		ok                          bool
	}{
		{"object", "{value:number}", "{value:first}", "", true},
		{"tuple", "[number,number]", "[first,first]", "", true},
		{"array", "number[]", "[first]", "", true},
		{"alias", "{value:number}", "box", "const box={value:first};", true},
		{"nested", "{outer:{value:number}}", "{outer:{value:first}}", "", true},
		{"wrong property", "{value:string}", "{value:first}", "", false},
		{"missing required", "{value:number;other:number}", "{value:first}", "", false},
		{"extra field", "{value:number}", "{value:first,other:first}", "", false},
		{"short tuple", "[number,number]", "[first]", "", false},
		{"wrong annotation", "{value:number}", "box", "const box:{value:string}={value:first};", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {Action,durable} from "vibelang:flows";
class Read extends Action<(n:number)=>Result<number,never>>{};
class Write extends Action<(n:` + tc.shape + `)=>Result<number,never>>{};
export const Build=durable((n:number)=>{const first=Read.run(n)!;` + tc.binding + `return Write.run(` + tc.input + `)})`
			request := keyedSourceTestRequest(source)
			request.ProvidersJSON = strings.Replace(request.ProvidersJSON, "flow.vibe#Work", "flow.vibe#Read", 1)
			other := strings.Replace(request.ProvidersJSON, "flow.vibe#Read", "flow.vibe#Write", 1)
			request.ProvidersJSON = strings.TrimSuffix(request.ProvidersJSON, "]") + "," + strings.TrimPrefix(other, "[")
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
			if err != nil || got.OK != tc.ok || !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0) {
				t.Fatalf("composite propagation checking: %+v err=%v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedSourceRefuses(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedSourceCompiler)
	for _, tc := range []struct{ name, source, input, providers string }{
		{"capture mutation", `const state={value:1};state.value=2;export const Build=durable((n:number)=>{return state.value})`, "41", "[]"},
		{"static module execution", `class State { static { while(true){} } };export const Build=durable((n:number)=>{return n})`, "41", "[]"},
		{"static initialization", `class State { static value=Date.now() };export const Build=durable((n:number)=>{return n})`, "41", "[]"},
		{"heritage getter", `class State { static get Base(){return Error} };class Derived extends State.Base {};export const Build=durable((n:number)=>{return n})`, "41", "[]"},
		{"unbound name", `export const Build=durable((n:number)=>{const value=missing;return value})`, "41", "[]"},
		{"bad unused function", `function bad(n:number):string{return n};export const Build=durable((n:number)=>{return n})`, "41", "[]"},
		{"bad unused local", `export const Build=durable((n:number)=>{const bad:string=n;return n})`, "41", "[]"},
		{"type alias missing", `type Bad=Missing;export const Build=durable((n:number)=>{return n})`, "41", "[]"},
		{"switch no fallback", `export const Build=durable((n:number)=>{switch(n){case 0:return 1;default:return 0}})`, "41", "[]"},
		{"loop no fallback", `export const Build=durable((n:number)=>{let total=0;for(let i=0;i<n;i++)total++;return total})`, "41", "[]"},
		{"nested declaration", `function make(){return durable((n:number)=>{return n})}`, "41", "[]"},
		{"timer unimplemented", `export const Build=durable((n:number)=>{sleep(n);return n})`, "41", "[]"},
		{"wrong input", `export const Build=durable((n:number)=>{return n})`, `"wrong"`, "[]"},
		{"negative zero", `export const Build=durable((n:number)=>{return n})`, `-0`, "[]"},
		{"nested negative zero", `export const Build=durable((n:{a:number})=>{return n})`, `{"a":-0}`, "[]"},
		{"literal negative zero", `export const Build=durable((n:0)=>{return n})`, `-0`, "[]"},
		{"extra input property", `export const Build=durable((n:{a:number})=>{return n})`, `{"a":1,"extra":2}`, "[]"},
		{"missing input property", `export const Build=durable((n:{a:number})=>{return n})`, `{}`, "[]"},
		{"null input", `export const Build=durable((n:{a:number})=>{return n})`, `null`, "[]"},
		{"duplicate input", `export const Build=durable((n:{a:number})=>{return n})`, `{"a":1,"a":2}`, "[]"},
		{"invalid unicode input", `export const Build=durable((n:string)=>{return n})`, `"\ud800"`, "[]"},
		{"missing provider", `class Work extends Action<(n:number)=>Result<number,never>>{};export const Build=durable((n:number)=>{return Work.run(n)})`, "41", "[]"},
		{"unrecognized provider", `export const Build=durable((n:number)=>{return n})`, "41", `[{"actionId":"fake"}]`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := keyedSourceTestRequest(`import {Action,durable,sleep} from "vibelang:flows";` + tc.source)
			request.InputJSON, request.ProvidersJSON = tc.input, tc.providers
			got, err := query.CompileKeyedPlanSource(ctx, request)
			if err != nil || got.OK || len(got.Diagnostics) == 0 || got.PlanJSON != "" {
				t.Fatalf("refusal failed/partial artifact leaked: %+v err=%v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedSourceEOFDiagnostics(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ source, code string }{
		{"export const", "TS1123"},
		{`import {durable} from "vibelang:flows";export const Build=durable((n:number)=>{return n;`, "VIBE1000"},
		{"/*", "VIBE1000"},
		{"// \U0001f680\n/*", "VIBE1000"},
	} {
		t.Run(tc.source, func(t *testing.T) {
			request := keyedSourceTestRequest(tc.source)
			request.ProvidersJSON = "[]"
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) != 1 {
				t.Fatalf("incomplete source became a protocol error or artifact: %+v err=%v", got, err)
			}
			issue := got.Diagnostics[0]
			if issue.Code != tc.code || issue.File != request.FileName || issue.Span == nil ||
				issue.Span.Start != utf16Extent(tc.source) || issue.Span.Length != 1 {
				t.Fatalf("authored EOF caret lost: %+v", issue)
			}
		})
	}
}

func TestPinnedForkKeyedSourceInputOrderAndProjections(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, shape, input, output string }{
		{"object", "{z:number;a:number}", `{"z":2,"a":1}`, "n"},
		{"nested", "{nested:{b:number;a:number}}", `{"nested":{"b":2,"a":1}}`, "n.nested"},
		{"tuple", "[number,string]", `[2,"a"]`, "n[1]"},
		{"union", "number|string", `"text"`, "n"},
		{"optional absent", "{a?:number}", `{}`, "n"},
		{"optional present", "{a?:number}", `{"a":2}`, "n"},
		{"null", "null", "null", "n"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := keyedSourceTestRequest(`import {durable} from "vibelang:flows";export const Build=durable((n:` + tc.shape + `)=>{return ` + tc.output + `})`)
			request.InputJSON, request.ProvidersJSON = tc.input, "[]"
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
			if err != nil || !got.OK {
				t.Fatalf("input profile: %+v err=%v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedSourceDoesNotInvokeUnusedStaticMethods(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, member := range []string{`static unused():number{while(true){}}`, `static get unused():number{while(true){}}`} {
		request := keyedSourceTestRequest(`import {durable} from "vibelang:flows";class Unused{` + member + `};export const Build=durable((n:number)=>{return n})`)
		request.ProvidersJSON = "[]"
		got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
		if err != nil || !got.OK {
			t.Fatalf("unused static declaration was invoked or crashed inspection: %+v err=%v", got, err)
		}
	}
}

func TestPinnedForkKeyedSourceProviderAndWireRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedSourceCompiler)
	request := keyedSourceTestRequest(keyedSourceExample)
	var providers []map[string]any
	if err := json.Unmarshal([]byte(request.ProvidersJSON), &providers); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		edit func(map[string]any)
	}{
		{"missing effects", func(p map[string]any) { delete(p, "effects") }},
		{"implicit tier", func(p map[string]any) { delete(p, "tier") }},
		{"unknown tier", func(p map[string]any) { p["tier"] = "repeatable" }},
		{"empty identity", func(p map[string]any) { p["implementationId"] = "" }},
		{"wrong action", func(p map[string]any) { p["actionId"] = "other.vibe#Work" }},
		{"not code digest", func(p map[string]any) { p["implementationDigest"] = "version1" }},
		{"uppercase digest", func(p map[string]any) { p["implementationDigest"] = strings.Repeat("A", 64) }},
		{"missing boundary", func(p map[string]any) { p["effects"] = map[string]any{} }},
		{"escape workspace", func(p map[string]any) {
			p["effects"] = map[string]any{"boundaryMode": "hard", "reads": []any{"../private"}, "writes": []any{}}
		}},
		{"not a capability set", func(p map[string]any) { p["capabilities"] = "Clock" }},
		{"approval claim", func(p map[string]any) { p["approved"] = true }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var copied []map[string]any
			_ = json.Unmarshal([]byte(request.ProvidersJSON), &copied)
			tc.edit(copied[0])
			r := request
			payload, _ := json.Marshal(copied)
			r.ProvidersJSON = string(payload)
			got, err := query.CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) == 0 {
				t.Fatalf("provider refusal: %+v err=%v", got, err)
			}
		})
	}
	for _, source := range []string{
		strings.Replace(keyedSourceExample, "{}", `{ static run(n:number):number{return n} }`, 1),
		strings.Replace(keyedSourceExample, "{}", `{ static value=1 }`, 1),
		strings.Replace(keyedSourceExample, "return { second, first }", `return { __proto__: first, second }`, 1),
	} {
		r := request
		r.Source = source
		got, err := query.CompileKeyedPlanSource(ctx, r)
		if err != nil || got.OK || len(got.Diagnostics) == 0 || got.PlanJSON != "" {
			t.Fatalf("runtime implementation/prototype changed source meaning: %+v err=%v", got, err)
		}
	}
	raw, _ := json.Marshal(request)
	for _, value := range []string{
		strings.Replace(string(raw), `"planId":`, `"planId":"earlier","planId":`, 1),
		strings.TrimSuffix(string(raw), "}") + `,"approved":true}`,
		string(raw) + `{}`,
	} {
		command := exec.CommandContext(ctx, backend.(*forkCompiler).executable, "--keyed-plan-source")
		command.Stdin = strings.NewReader(value)
		bytes, err := command.Output()
		if err != nil {
			t.Fatal(err)
		}
		var result struct {
			Result KeyedSourceResult
			Error  *struct{ Code string }
		}
		if json.Unmarshal(bytes, &result) != nil || result.Error == nil || result.Error.Code != "VIBELANG_GO_KEYED_SOURCE" || result.Result.OK || result.Result.PlanJSON != "" {
			t.Fatalf("outer request did not fail closed: %s", bytes)
		}
	}
}

func TestKeyedSourceResponseContract(t *testing.T) {
	request := keyedSourceTestRequest(keyedSourceExample)
	key := "key1_" + strings.Repeat("0", 64)
	plan, _ := json.Marshal(map[string]any{"planId": request.PlanID, "flow": request.FlowID, "baseDigest": key, "digest": key, "generation": 0, "nodes": []any{}})
	success := map[string]any{"ok": true, "planJson": string(plan), "diagnostics": []any{}}
	for _, edit := range []func(map[string]any){
		func(r map[string]any) { r["ok"] = false },
		func(r map[string]any) { r["planJson"] = "" },
		func(r map[string]any) { r["planJson"] = strings.Replace(string(plan), request.PlanID, "wrong", 1) },
		func(r map[string]any) { r["planJson"] = strings.Replace(string(plan), request.FlowID, "wrong", 1) },
		func(r map[string]any) { r["diagnostics"] = nil },
		func(r map[string]any) { r["approved"] = true },
		func(r map[string]any) { delete(r, "diagnostics") },
	} {
		value := map[string]any{}
		for key, item := range success {
			value[key] = item
		}
		edit(value)
		payload, _ := json.Marshal(value)
		if _, err := decodeKeyedSource(payload, request); err == nil {
			t.Fatalf("host accepted contradictory response: %s", payload)
		}
	}
	payload, _ := json.Marshal(success)
	if got, err := decodeKeyedSource(payload, request); err != nil || !got.OK {
		t.Fatalf("valid data response: %+v %v", got, err)
	}
}
