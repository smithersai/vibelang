package compiler

import (
	"strings"
	"testing"
)

func TestPinnedForkKeyedNullableSuccessNarrowing(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`const value=Work.run(n)!;if(value===null)return 0;return value+1`,
		`const value=Work.run(n)!;if(value!==null)return value+1;return 0`,
		`const value=Work.run(n)!;return value===null?0:value+1`,
		`const value=Work.run(n)!;const copy=value;if(copy===null)return 0;return copy+1`,
		`const value:number|null=Work.run(n)!;if(value===null)return value;return value+1`,
		`if(const value=Work.run(n)!;value===null){return 0}else{return value+1}`,
		`const value=Work.run(n)!;if(n>0){if(value===null)return 0;return value+1}return 0`,
		`const value=Work.run(n)!;if(value!==null)return Work.run(value);return 0`,
		`const value=Work.run(n)!;if(value===null)return 0;{const value=Work.run(n)!;if(value===null)return 0;return value+1}`,
		"const 値=Work.run(n)!;\nif(値===null)return 0;\nreturn 値+1",
		`const \u0076alue=Work.run(n)!;if(value===null)return 0;return \u0076alue+1`,
		`const value=Work.run(n)!;if(\u0076alue===null)return 0;return value+1`,
		"/* 🧪 */ const value = Work.run(n)!;\r\nif (value === null) return 0;\r\nreturn /* kept */ value + 1",
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !result.OK {
				t.Fatalf("nullable Action success: %+v %v", result, err)
			}
			if strings.Contains(result.PlanJSON, `"kind":"checked"`) {
				t.Fatal("private native type proof escaped into the Plan")
			}
			verified, err := backend.(KeyedPlanCompiler).KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: result.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != result.PlanJSON {
				t.Fatalf("nullable success reconstruction: %+v %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedNullableNarrowingRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`const value=Work.run(n)!;return value+1`,
		`const value=Work.run(n)!;if(value===null)return value+1;return 0`,
		`const value=Work.run(n)!;if(value!==null){Work.run(value)!}return value+1`,
		`const value=Work.run(n)!;if(value!==null){const value=Work.run(n)!;return value+1}return 0`,
		`const value=Work.run(n)!;return (value as number)+1`,
		`const value=Work.run(n)!;if(n!==null)return value+1;return 0`,
		`const value=Work.run(n)!;if(value===null)return Work.run(value);return 0`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<number|null,never>>{};export const Flow=durable((n:number)=>{` + body + `});`)
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || result.OK || result.PlanJSON != "" || len(result.Diagnostics) == 0 {
				t.Fatalf("unsafe nullable success escaped: %+v %v", result, err)
			}
		})
	}
}

func TestPinnedForkKeyedNullableRecordNarrowing(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, body := range []string{
		`if(value===null)return 0;if(value.kind==="a")return value.x+1;return value.y+1`,
		`if(value==null)return 0;if(value.kind==="a")return value.x+1;return value.y+1`,
		`if(null===value)return 0;if(value.kind==="a")return value.x+1;return value.y+1`,
		`if(value!==null){if(value.kind==="a")return value.x+1;return value.y+1}return 0`,
		`if(value!=null){if(value.kind==="a")return value.x+1;return value.y+1}return 0`,
	} {
		t.Run(body, func(t *testing.T) {
			r := keyedSourceTestRequest(`import {Action,durable} from "vibelang:flows";class Work extends Action<(n:number)=>Result<{kind:"a";x:number}|{kind:"b";y:number}|null,never>>{};export const Flow=durable((n:number)=>{const value=Work.run(n)!;` + body + `});`)
			result, err := backend.(KeyedSourceCompiler).CompileKeyedPlanSource(ctx, r)
			if err != nil || !result.OK {
				t.Fatalf("nullable record success: %+v %v", result, err)
			}
		})
	}
}
