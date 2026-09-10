package compiler

import (
	"encoding/json"
	"testing"
)

func TestPinnedForkKeyedLogicalWork(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`return n>0&&Work.run(n)!`, `return n>0||Work.run(n)!`,
		`return n&&Work.run(2)!`, `return n||Work.run(2)!`,
		`return Work.run(n)!&&Work.run(2)!`, `return Work.run(n)!||Work.run(2)!`,
		`const result=n>0&&Work.run(2)!;return result`,
		`return (n>0&&Work.run(2)!)||Work.run(3)!`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("logical graph: %+v %v", got, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			branches := 0
			for _, node := range plan.Nodes {
				if node.Material.Body["operation"] == "branch" {
					branches++
				}
			}
			if branches == 0 {
				t.Fatalf("conditional work became eager: %s", got.PlanJSON)
			}
			checked, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !checked.OK || checked.PlanJSON != got.PlanJSON {
				t.Fatalf("logical reconstruction: %+v %v", checked, err)
			}
		})
	}
}
