package vibelang

import (
	"slices"
	"testing"
)

func TestNativeAsyncParameterAwaitBoundaries(t *testing.T) {
	for _, rule := range []struct {
		name, source  string
		want          []string
		placementOnly bool
	}{
		{"returning-earlier-default", "export async function read(first=do{return 0},value=await Effect.succeed(1)){return 1}", nil, true},
		{"returning-same-default", "export async function read(value=do{return await Effect.succeed(1)}){return 1}", nil, true},
		{"binding-return-default", "export async function read({value=do{return 0}}={},later=await Effect.succeed(1)){return 1}", nil, true},
		{"do-value", "export async function read(value=do{await Effect.succeed(1);0}){return 1}", nil, true},
		{"do-binding-value", "export async function read({value=do{await Effect.succeed(1);0}}={}){return 1}", nil, true},
		{"match-value", "export async function read(value=match(1){default:await Effect.succeed(1);}){return 1}", nil, true},
		{"nested-async-body", "export async function read(value=async()=>await Effect.succeed(1)){return 1}", []string{"EK103"}, false},
		{"nested-async-do-body", "export async function read(value=async()=>do{return await Effect.succeed(1)}){return 1}", []string{"EK103"}, false},
		{"effect-block-static-await", "export async function read(value=effect{class Value{static{await Promise.resolve(1)}};return 1}){return 1}", []string{"TS18037"}, false},
		{"nested-async-static-await", "export async function read(value=async()=>{class Value{static{await Promise.resolve(1)}};return 1}){return 1}", []string{"TS18037"}, false},
		{"effect-block-value", "export async function read(value=effect{return try Effect.succeed(1)}){return 1}", nil, false},
	} {
		t.Run(rule.name, func(t *testing.T) {
			source := "import {Effect} from \"effect\";" + rule.source
			got := asyncParameterAwaitCodes(t, source)
			good := slices.Equal(got, rule.want)
			if rule.placementOnly {
				good = slices.Contains(got, "TS2524") && !slices.Contains(got, "EK103")
				t.Logf("placement-only diagnostics=%v", got)
			}
			if !good {
				t.Fatalf("want %v placementOnly=%v;got %v\n%s", rule.want, rule.placementOnly, got, source)
			}
		})
	}
}
