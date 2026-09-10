package compiler

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const keyedChildSource = `import {Action,durable} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{}
const Child=durable((n:number)=>{return Work.run(n)});
export const Flow=durable((n:number)=>{const first=Child.run(n)!;return Work.run(first)});`

func TestPinnedForkKeyedSourceChildFlow(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, keyedSourceTestRequest(keyedChildSource))
	if err != nil || !got.OK {
		t.Fatalf("source child Flow: %+v %v", got, err)
	}
	var plan keyedFanOutPlan
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Nodes) != 3 || len(plan.Nodes[0].DependsOn) != 0 || len(plan.Nodes[1].DependsOn) != 1 || plan.Nodes[1].DependsOn[0] != plan.Nodes[0].ID {
		t.Fatalf("child work did not compose into its parent's data graph: %s", got.PlanJSON)
	}
}

func TestPinnedForkKeyedSourceChildFlowSelection(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct {
		name, declarations, exportName string
		accepted                       bool
	}{
		{"unique public root", `const Child=durable((n:number)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`, "", true},
		{"explicit root", `export const Child=durable((n:number)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`, "Flow", true},
		{"public child ambiguity", `export const Child=durable((n:number)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`, "", false},
		{"export alias", `const Child=durable((n:number)=>{return n});const Flow=durable((n:number)=>{return Child.run(n)!});export {Flow as Entry};`, "Entry", true},
		{"missing export", `export const Flow=durable((n:number)=>{return n});`, "Missing", false},
		{"private export", `const Flow=durable((n:number)=>{return n});`, "Flow", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {durable} from "vibelang:flows";` + tc.declarations)
			r.ExportName, r.ProvidersJSON = tc.exportName, "[]"
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK != tc.accepted || !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0) {
				t.Fatalf("entry selection: %+v %v", got, err)
			}
			if got.OK && tc.exportName != "" && !strings.Contains(got.PlanJSON, `"exportName":"`+tc.exportName+`"`) {
				t.Fatal("selected export did not bind source evidence")
			}
		})
	}
}

func TestPinnedForkKeyedSourceChildFlowRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	expanding := "const x0=[n];"
	for i := 1; i < 20; i++ {
		expanding += fmt.Sprintf("const x%d=[x%d,x%d];", i, i-1, i-1)
	}
	for _, tc := range []struct{ name, source string }{
		{"direct recursion", `const Child=durable((n:number):number=>{return Child.run(n)!});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"mutual recursion", `const A=durable((n:number):number=>{return B.run(n)!});const B=durable((n:number):number=>{return A.run(n)!});export const Flow=durable((n:number)=>{return A.run(n)!});`},
		{"wrong input", `const Child=durable((n:string)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"any input", `const Child=durable((n:any)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"opaque lookalike", `const Child={run(n:number):Result<number,never>{return n}};export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"mutable child", `let Child=durable((n:number)=>{return n});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"capture mutation", `const state={n:1};state.n=2;const Child=durable((n:number)=>{return state.n});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
		{"expanding aliases", `const Child=durable((n:number)=>{` + expanding + `return x19});export const Flow=durable((n:number)=>{return Child.run(n)!});`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {durable} from "vibelang:flows";` + tc.source)
			r.ProvidersJSON = "[]"
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) == 0 {
				t.Fatalf("invalid child graph was not cleanly refused: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkSourceFlowRunIsNotRuntimeExecution(t *testing.T) {
	for _, use := range []string{`const result=Flow.run(1);`, `const run=Flow.run;`, `function call(){return Flow.run(1)!}`,
		`const run=()=>Flow.run(1);`} {
		t.Run(use, func(t *testing.T) {
			got := compileInternalSource(t, []SourceFile{{Path: "flow.vibe", Kind: FileKindVibeLang,
				Text: `import {durable} from "vibelang:flows";const Flow=durable((n:number)=>{return n});` + use}})
			for _, issue := range got.Diagnostics {
				if issue.Code == "VIBE4120" {
					return
				}
			}
			t.Fatalf("descriptor acquired a runtime execution surface: %+v", got.Diagnostics)
		})
	}
}

func TestPinnedForkKeyedSourceChildFlowDepth(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, depth := range []int{7, 8} {
		source := `import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};const F0=durable((n:number)=>{return Work.run(n)});`
		for i := 1; i <= depth; i++ {
			if i == depth {
				source += "export "
			}
			source += fmt.Sprintf("const F%d=durable((n:number)=>{return F%d.run(n)!});", i, i-1)
		}
		got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, keyedSourceTestRequest(source))
		if err != nil || got.OK != (depth == 7) || !got.OK && got.PlanJSON != "" {
			t.Fatalf("depth %d: %+v %v", depth, got, err)
		}
		if got.OK && !strings.Contains(got.PlanJSON, strings.Repeat("flow/0/", 7)+"action/0") {
			t.Fatal("nested scope depth was truncated")
		}
	}
}

func TestPinnedForkKeyedSourceChildFlowRows(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, child, parent string }{
		{"propagated failure", `class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};const Child=durable((n:number)=>{return Work.run(n)});`, `export const Flow=durable((n:number):Result<number,never>=>{return Child.run(n)!});`},
		{"returned failure", `class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};const Child=durable((n:number)=>{return Work.run(n)});`, `export const Flow=durable((n:number):Result<number,never>=>{return Child.run(n)});`},
		{"indirect failure", `class Bad extends Error{};class Work extends Action<(n:number)=>Result<number,Bad>>{};const Inner=durable((n:number)=>{return Work.run(n)});const Child=durable((n:number)=>{return Inner.run(n)!});`, `export const Flow=durable((n:number):Result<number,never>=>{return Child.run(n)!});`},
		{"capability erasure", `import {Context} from "vibelang/context";abstract class Need extends Context{abstract value:number};function need(n:number):number{return Need.context().value};const hidden:(n:number)=>number=need;const Child=durable((n:number)=>{return hidden(n)});`, `export const Flow=durable((n:number)=>{return Child.run(n)!});`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			request := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";` + tc.child + tc.parent)
			if tc.name == "capability erasure" {
				request.ProvidersJSON = "[]"
			}
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, request)
			if err != nil || got.OK || got.PlanJSON != "" {
				t.Fatalf("child row erased: %+v %v", got, err)
			}
			codes := make([]string, len(got.Diagnostics))
			for i, issue := range got.Diagnostics {
				codes[i] = issue.Code
			}
			want := "VIBE1104"
			if tc.name == "capability erasure" {
				want = "VIBE1808"
			}
			if !strings.Contains(strings.Join(codes, ","), want) {
				t.Fatalf("child contract was not refused by its row rule %s: %+v", want, got)
			}
		})
	}
}
