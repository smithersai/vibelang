package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkKeyedStatements(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`if(n>0)return Work.run(n);return Work.run(-n)`,
		`if(n>0){return Work.run(n)!}else{return Work.run(-n)!}`,
		`if(n>0){Work.run(1)!}else{Work.run(2)!}return Work.run(n)`,
		`if(n>0)Work.run(1)!;return Work.run(n)`,
		`if(n>0)return 1;else if(n<0)return 2;else return 3`,
		`const value=n;if(n>0){const value=Work.run(n)!;if(value>0)return value}return Work.run(value)`,
		`if(n>0){const value=Work.run(n)!;return value>0?Work.run(value)!:0}return 0`,
		`if(n>0){const value=Work.run(n)!;return value>0&&Work.run(value+1)!}return 0`,
		`if(n>0){const value=Work.run(n)!;if(n>1){if(n>2)return Work.run(value+1)!}return value}return 0`,
		`if(const value=Work.run(n)!;value>0){return value}else{return Work.run(n)}`,
		`const value=n;if(const value=Work.run(n)!;value>0){Work.run(value)!}else{Work.run(2)!}return value`,
		`const value=n;{const value=Work.run(1)!;Work.run(value)!}return Work.run(value)`,
		`Work.run(n)!;return n`,
		`if(n>0)return n;{const value=Work.run(n)!;return value}`,
		`if(n)return Work.run(1);return Work.run(2)`,
		`sequential(Work.run(1),Work.run(2));if(n>0){Work.run(3)!}return Work.run(4)`,
		`if(n>0){sequential(Work.run(1),Work.run(2));if(n>1)return 9}return Work.run(3)`,
		`if(n>0){sequential(Work.run(1),Work.run(2))}return Work.run(3)`,
		`if(n>0){}else{}return n`,
		`if(n>0){if(n>1)return 1}else{if(n<0)return 2}return Work.run(n)`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable,sequential} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			if !strings.Contains(body, "Work.run") {
				r.ProvidersJSON = "[]"
			}
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !result.OK {
				t.Fatalf("statement graph: %+v %v", result, err)
			}
			var plan keyedFanOutPlan
			if err := json.Unmarshal([]byte(result.PlanJSON), &plan); err != nil {
				t.Fatal(err)
			}
			if len(plan.Nodes) == 0 || plan.Nodes[len(plan.Nodes)-1].ID != "result" {
				t.Fatalf("missing complete Flow result: %s", result.PlanJSON)
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: result.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != result.PlanJSON {
				t.Fatalf("statement reconstruction: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedStatementRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`if(n>0)return n`,
		`if(n>0){const value=Work.run(n)!}`,
		`if(n>0){return Work.run(1)}else{return Work.run(2)}Work.run(3)!`,
		`{return n}return n`,
		`if(n>0){const lost=Work.run(n);return 0}return 1`,
		`if(n>0){Work.run(n)}return 1`,
		`if(n>0){let value=n;return value}return 0`,
		`if(let value=n;value>0){return value}else{return 0}`,
		`if(n>0){const value=n}return value`,
		`if(const value=n;value>0){return value}return value`,
		`if(n>0){while(true){}}return 1`,
		`if(n>0){try{return n}finally{Work.run(n)!}}return 0`,
		`if(n>0){n++}return n`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			if !strings.Contains(body, "Work.run") {
				r.ProvidersJSON = "[]"
			}
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || result.OK || result.PlanJSON != "" || len(result.Diagnostics) == 0 {
				t.Fatalf("unsupported or incomplete statement graph escaped: %+v %v", result, err)
			}
		})
	}
}

func TestPinnedForkKeyedStatementNarrowing(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ kind, body, input string }{
		{"number|null", `if(n===null)return 0;return Work.run(n)`, "null"},
		{"number|null", `if(n===null)return 0;return Work.run(n)`, "2"},
		{"number|null", `if(n!==null)return Work.run(n);return 0`, "null"},
		{"number|null", `if(n!==null)return Work.run(n);return 0`, "2"},
		{"number|null", `const value=n;if(value===null)return 0;return Work.run(value)`, "null"},
		{"number|null", `const value=n;if(value===null)return 0;return Work.run(value)`, "2"},
		{`{kind:"a";x:number}|{kind:"b";y:number}`, `if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)`, `{"kind":"a","x":2}`},
		{`{kind:"a";x:number}|{kind:"b";y:number}`, `if(n.kind==="a")return Work.run(n.x);return Work.run(n.y)`, `{"kind":"b","y":3}`},
	} {
		t.Run(tc.body+"/"+tc.input, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number,never>>{};export const Flow=durable((n:` + tc.kind + `)=>{` + tc.body + `});`)
			r.InputJSON = tc.input
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !result.OK {
				t.Fatalf("checked narrowing: %+v %v", result, err)
			}
			if strings.Contains(result.PlanJSON, `"kind":"checked"`) {
				t.Fatal("private native narrowing proof escaped into the wire Plan")
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: result.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != result.PlanJSON {
				t.Fatalf("narrowed reconstruction: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedStatementBudgets(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for name, body := range map[string]string{
		"deep syntax":             strings.Repeat("if(n>0){", 70) + "return n" + strings.Repeat("}", 70) + "return 0",
		"expanding continuations": strings.Repeat("if(n>0){if(n>1)return 1}", 20) + "return 0",
	} {
		t.Run(name, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {durable} from "vibelang:flows";export const Flow=durable((n:number)=>{` + body + `});`)
			r.ProvidersJSON = "[]"
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || result.OK || result.PlanJSON != "" || len(result.Diagnostics) == 0 {
				t.Fatalf("over-budget statements published a partial graph: %+v %v", result, err)
			}
			if !strings.Contains(result.Diagnostics[0].Message, "budget") {
				t.Fatalf("expected a bounded refusal, got %+v", result.Diagnostics)
			}
		})
	}
}
