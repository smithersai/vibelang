package compiler

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestPinnedForkKeyedFanOutCaptures(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{}
export const Flow=durable((input:{items:readonly number[];value:number})=>{
  const captured=Work.run(input.value)!;
  return fanOut(input.items,n=>n,n=>Work.run(captured));
});`
	r := keyedSourceTestRequest(source)
	r.InputJSON = `{"items":[2,1],"value":41}`
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || !got.OK {
		t.Fatalf("checked fan-out capture: %+v %v", got, err)
	}
	var plan keyedFanOutPlan
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Nodes) != 4 || plan.Nodes[0].ID != "action/0" {
		t.Fatalf("incomplete captured graph: %s", got.PlanJSON)
	}
	for i, node := range plan.Nodes[1:3] {
		if node.ID != keyedFanOutAddress(1, i+1, 0) || !slices.Equal(node.DependsOn, []string{"action/0"}) ||
			node.Material.Inputs[0]["_tag"] != "Ref" || node.Material.Inputs[0]["from"] != "action/0" {
			t.Fatalf("capture lost its shared data edge: %+v", node)
		}
	}
	verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
	if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
		t.Fatalf("captured graph did not reconstruct: %+v %v", verified, err)
	}
}

func TestPinnedForkKeyedFanOutCaptureAliasBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{}
export const Flow=durable((n:number)=>{const v0=n;`
	for i := 1; i <= 18; i++ {
		source += fmt.Sprintf("const v%d={a:v%d,b:v%d};", i, i-1, i-1)
	}
	source += `return fanOut([1],i=>i,i=>Work.run(v18` + strings.Repeat(".a", 18) + `))});`
	r := keyedSourceTestRequest(source)
	r.InputJSON = `41`
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || got.OK || got.PlanJSON != "" || !slices.ContainsFunc(got.Diagnostics, func(d Diagnostic) bool {
		return strings.Contains(d.Message, "serialization budget")
	}) {
		t.Fatalf("captured aliases bypassed the template budget: %+v %v", got, err)
	}
}
