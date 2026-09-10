package compiler

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestPinnedForkKeyedComputation(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, item := range []struct{ expression, operator, kind string }{
		{"n+2", "add", "number"}, {"n-2", "subtract", "number"}, {"n*2", "multiply", "number"},
		{"n/2", "divide", "number"}, {"n%2", "remainder", "number"}, {"n**2", "power", "number"},
		{"n&2", "bit-and", "number"}, {"n|2", "bit-or", "number"}, {"n^2", "bit-xor", "number"},
		{"n<<2", "shift-left", "number"}, {"n>>2", "shift-right", "number"}, {"n>>>2", "shift-unsigned", "number"},
		{"n===2", "equal", "boolean"}, {"n!==2", "not-equal", "boolean"},
		{"n==2", "loose-equal", "boolean"}, {"n!=2", "loose-not-equal", "boolean"},
		{"n<2", "less", "boolean"}, {"n<=2", "less-equal", "boolean"},
		{"n>2", "greater", "boolean"}, {"n>=2", "greater-equal", "boolean"},
		{"-n", "negative", "number"}, {"+n", "positive", "number"}, {"~n", "bit-not", "number"}, {"!n", "not", "boolean"},
	} {
		t.Run(item.operator, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{return ` + item.expression + `});`)
			r.ProvidersJSON = "[]"
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !got.OK {
				t.Fatalf("computation: %+v %v", got, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			body := plan.Nodes[0].Material.Body
			expression := body["expression"].(map[string]any)
			if len(plan.Nodes) != 1 || expression["kind"] != "compute" || expression["operator"] != item.operator ||
				body["successSchema"].(map[string]any)["descriptor"].(map[string]any)["kind"] != item.kind {
				t.Fatalf("operator or checked output contract missing: %s", got.PlanJSON)
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
				t.Fatalf("reconstruction: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedComputationRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`const o={n};return o===o`, `const o={n};return o+""`, `n++;return n`,
		`return null??Work.run(n)!`, // TypeScript's always-nullish source diagnostic remains.
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || got.OK || got.PlanJSON != "" || len(got.Diagnostics) == 0 {
				t.Fatalf("partial/accepted graph: %+v %v", got, err)
			}
		})
	}
}

func TestPinnedForkKeyedComputationAliasBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{const v0=n;`
	for i := 1; i <= 18; i++ {
		source += fmt.Sprintf("const v%d=v%d+v%d;", i, i-1, i-1)
	}
	source += `return v18});`
	r := keyedSourceTestRequest(source)
	r.ProvidersJSON = "[]"
	got, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
	if err != nil || got.OK || got.PlanJSON != "" || !slices.ContainsFunc(got.Diagnostics, func(d Diagnostic) bool { return strings.Contains(d.Message, "serialization budget") }) {
		t.Fatalf("arithmetic alias DAG escaped the bound: %+v %v", got, err)
	}
}
