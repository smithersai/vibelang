package compiler

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"
)

const keyedFanOutSource = `import {Action,durable,fanOut} from "vibelang:flows";
class Work extends Action<(n:number)=>Result<number,never>>{}
export const Build=durable((input:{items:readonly number[]})=>{
  return fanOut(input.items,item=>item,item=>Work.run(item));
});`

type keyedFanOutPlan struct {
	Digest string
	Nodes  []struct {
		ID, Key   string
		DependsOn []string
		Material  struct {
			Body   map[string]any
			Inputs []map[string]any
		}
	}
}

func keyedFanOutAddress(group, key, step int) string {
	return fmt.Sprintf("fanout/%d/key1_%x/%d", group, sha256.Sum256([]byte(strconv.Itoa(key))), step)
}

func TestPinnedForkKeyedSourceFanOut(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	r := keyedSourceTestRequest(keyedFanOutSource)
	r.InputJSON = `{"items":[3,1,2]}`
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || !got.OK {
		t.Fatalf("fan-out compilation: %+v %v", got, err)
	}
	var plan keyedFanOutPlan
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if len(plan.Nodes) != 4 {
		t.Fatalf("complete fan-out graph not published: %s", got.PlanJSON)
	}
	for i, node := range plan.Nodes[:3] {
		if len(node.DependsOn) != 0 || node.Material.Inputs[0]["value"] != float64(i+1) {
			t.Fatalf("children lost key ordering or independent readiness: %+v", node)
		}
	}
	refs := []string{}
	for _, input := range plan.Nodes[3].Material.Inputs {
		if input["_tag"] == "Ref" {
			refs = append(refs, input["from"].(string))
		}
	}
	if !slices.Equal(refs, []string{keyedFanOutAddress(0, 3, 0), keyedFanOutAddress(0, 1, 0), keyedFanOutAddress(0, 2, 0)}) {
		t.Fatalf("fan-out output lost invocation order: %v", refs)
	}
	r.InputJSON = `{"items":[2,3,1]}`
	reordered, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || !reordered.OK {
		t.Fatalf("reordered fan-out: %+v %v", reordered, err)
	}
	var next keyedFanOutPlan
	if err := json.Unmarshal([]byte(reordered.PlanJSON), &next); err != nil {
		t.Fatal(err)
	}
	for i := range plan.Nodes[:3] {
		if plan.Nodes[i].ID != next.Nodes[i].ID || plan.Nodes[i].Key != next.Nodes[i].Key {
			t.Fatal("reordering items changed a child identity")
		}
	}
	if next.Digest == plan.Digest {
		t.Fatal("reordering the result did not change the approval target")
	}
	verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
	if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
		t.Fatalf("fan-out graph failed native reconstruction: %+v %v", verified, err)
	}
}

func TestPinnedForkKeyedSourceFanOutRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	unique := make([]string, 10000)
	for i := range unique {
		unique[i] = strconv.Itoa(i)
	}
	for _, tc := range []struct{ name, source, input, reason string }{
		{"duplicate key", keyedFanOutSource, `{"items":[1,1]}`, "duplicate fan-out item key"},
		{"node budget", keyedFanOutSource, `{"items":[` + strings.Join(unique, ",") + `]}`, "node budget including the result"},
		{"unknown Action result", strings.Replace(keyedFanOutSource, "return fanOut(input.items", "const n:number=Work.run(1)!; return fanOut([n]", 1), `{"items":[1]}`, "bounded round"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			r := keyedSourceTestRequest(tc.source)
			r.InputJSON = tc.input
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) == 0 {
				t.Fatalf("unsupported fan-out published partial work: %+v %v", got, err)
			}
			if !slices.ContainsFunc(got.Diagnostics, func(diagnostic Diagnostic) bool { return strings.Contains(diagnostic.Message, tc.reason) }) {
				t.Fatalf("refusal did not reach its intended boundary %q: %+v", tc.reason, got.Diagnostics)
			}
		})
	}
}

func TestPinnedForkKeyedSourceFanOutBindingsAndExpansion(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := strings.Replace(keyedFanOutSource, "item=>Work.run(item)", "item=>{const first=Work.run(item)!;return Work.run(first)}", 1)
	for _, count := range []int{0, 1, 128} {
		t.Run(strconv.Itoa(count), func(t *testing.T) {
			items := make([]int, count)
			for i := range items {
				items[i] = count - i
			}
			input, err := json.Marshal(map[string]any{"items": items})
			if err != nil {
				t.Fatal(err)
			}
			r := keyedSourceTestRequest(source)
			r.InputJSON = string(input)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("bounded expansion failed: %+v %v", got, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			if len(plan.Nodes) != count*2+1 {
				t.Fatalf("incomplete graph: got %d nodes", len(plan.Nodes))
			}
			for i := 0; i < count*2; i += 2 {
				first, second := plan.Nodes[i], plan.Nodes[i+1]
				if len(first.DependsOn) != 0 || !slices.Equal(second.DependsOn, []string{first.ID}) {
					t.Fatalf("wrong per-item data edges: %+v %+v", first, second)
				}
			}
			if len(plan.Nodes[count*2].DependsOn) != count*2 {
				t.Fatal("result did not join all declared work")
			}
		})
	}
}
