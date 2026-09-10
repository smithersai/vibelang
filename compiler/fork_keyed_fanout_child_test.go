package compiler

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

// A fan-out is graph composition too: a checked source Flow must retain the
// same contracts and completion barrier when invoked once per stable item key.
func TestPinnedForkKeyedFanOutChildFlow(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, terminal := range []string{"Child.run(n)", "Child.run(n)!"} {
		t.Run(terminal, func(t *testing.T) {
			source := `import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number):Result<number,never>=>{return Work.run(n)!});
export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>` + terminal + `)});`
			r := keyedSourceTestRequest(source)
			r.InputJSON = `[2,1]`
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("fan-out source child: %+v %v", got, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			if len(plan.Nodes) != 3 || len(plan.Nodes[0].DependsOn) != 0 || len(plan.Nodes[1].DependsOn) != 0 ||
				!slices.Equal(plan.Nodes[2].DependsOn, []string{plan.Nodes[1].ID, plan.Nodes[0].ID}) {
				t.Fatalf("lost independent children or complete result join: %s", got.PlanJSON)
			}
			for i, node := range plan.Nodes[:2] {
				if node.ID != keyedFanOutAddress(0, i+1, 0)+"/action/0" || node.Material.Inputs[0]["value"] != float64(i+1) {
					t.Fatalf("child lost its key-addressed source scope: %+v", node)
				}
			}
			r.InputJSON = `[1,2]`
			reordered, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !reordered.OK {
				t.Fatalf("reordered children: %+v %v", reordered, err)
			}
			var next keyedFanOutPlan
			if err := json.Unmarshal([]byte(reordered.PlanJSON), &next); err != nil {
				t.Fatal(err)
			}
			if next.Digest == plan.Digest {
				t.Fatal("reordered output did not change the graph digest")
			}
			for i := range plan.Nodes[:2] {
				if plan.Nodes[i].ID != next.Nodes[i].ID || plan.Nodes[i].Key != next.Nodes[i].Key {
					t.Fatal("item ordering changed a child's structural address or content key")
				}
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
				t.Fatalf("child graph did not reconstruct: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedFanOutChildDepth(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, depth := range []int{7, 8} {
		source := `import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};const F0=durable((n:number)=>{return Work.run(n)});`
		for i := 1; i < depth; i++ {
			source += fmt.Sprintf("const F%d=durable((n:number)=>{return F%d.run(n)!});", i, i-1)
		}
		source += fmt.Sprintf("export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>F%d.run(n))});", depth-1)
		r := keyedSourceTestRequest(source)
		r.InputJSON = `[1]`
		got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
		if err != nil || got.OK != (depth == 7) || !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0) {
			t.Fatalf("fan-out child depth %d: %+v %v", depth, got, err)
		}
	}
}

func TestPinnedForkKeyedFanOutChildExpansionBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {Action,durable,fanOut} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};
const Child=durable((n:number)=>{const first=Work.run(n)!;return Work.run(first)});
export const Flow=durable((items:readonly number[])=>{return fanOut(items,n=>n,n=>Child.run(n))});`
	items := make([]int, 6000)
	for i := range items {
		items[i] = i
	}
	input, err := json.Marshal(items)
	if err != nil {
		t.Fatal(err)
	}
	r := keyedSourceTestRequest(source)
	r.InputJSON = string(input)
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || got.OK || got.PlanJSON != "" || !slices.ContainsFunc(got.Diagnostics, func(d Diagnostic) bool {
		return strings.Contains(d.Message, "node budget")
	}) {
		t.Fatalf("child expansion bypassed the complete graph budget: %+v %v", got, err)
	}
}
