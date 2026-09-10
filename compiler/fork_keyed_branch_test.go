package compiler

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func TestPinnedForkKeyedBranch(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`return n>0 ? Work.run(1) : Work.run(2)`,
		`const selected=n>0 ? Work.run(1)! : Work.run(2)!;return Work.run(selected)`,
		`return n>0 ? (n>1 ? Work.run(1)! : Work.run(2)!) : Work.run(3)!`,
		`const shared=Work.run(n)!;return n>0?Work.run(shared+1):Work.run(shared+2)`,
		`const unused=n>0?Work.run(1)!:Work.run(2)!;return 0`,
		`const chosen=n>0?true:false;return chosen?Work.run(1):Work.run(2)`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("complete conditional graph: %+v %v", got, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			branches := 0
			for _, node := range plan.Nodes {
				if node.Material.Body["operation"] != "branch" {
					continue
				}
				branches++
				control := node.Material.Body["control"].(map[string]any)
				for _, key := range []string{"condition", "whenTrue", "whenFalse"} {
					if !slices.Contains(node.DependsOn, control[key].(string)) {
						t.Fatalf("missing branch dependency: %s", got.PlanJSON)
					}
				}
			}
			if branches == 0 {
				t.Fatalf("conditional became unconditional work: %s", got.PlanJSON)
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
				t.Fatalf("branch reconstruction: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedBranchEffects(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, effects := range []struct {
		name, body, reads, writes string
		ok                        bool
	}{
		{"cross arm writes", `return n>0?Work.run(1):Work.run(2)`, `[]`, `["shared"]`, false},
		{"outside bypass", `const chosen=n>0?Work.run(1)!:Work.run(2)!;return Work.run(3)`, `[]`, `["shared"]`, false},
		{"read only", `return n>0?Work.run(1):Work.run(2)`, `["shared"]`, `[]`, true},
	} {
		t.Run(effects.name, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + effects.body + `});`)
			r.ProvidersJSON = strings.Replace(r.ProvidersJSON, `"reads":[],"writes":[]`, `"reads":`+effects.reads+`,"writes":`+effects.writes, 1)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK != effects.ok {
				t.Fatalf("conditional effect boundary: %+v %v", got, err)
			}
			if !got.OK && (got.PlanJSON != "" || len(got.Diagnostics) == 0 || !strings.Contains(got.Diagnostics[0].Message, "conditional arm")) {
				t.Fatalf("conflicting branch published or refused for the wrong reason: %+v", got)
			}
		})
	}
}
