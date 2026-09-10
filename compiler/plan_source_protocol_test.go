package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPlanSourceProtocolAtomicity(t *testing.T) {
	request := PlanSourceRequest{Source: "class Work {}", FileName: "source.vibe", FlowID: "test/Flow", FlowVersion: 2, Mode: "plan"}
	artifact := `{"flowId":"test/Flow","flowVersion":2}`
	base := func() map[string]any {
		return map[string]any{"status": "plan", "diagnostics": []any{}, "planJson": artifact, "manifestJson": artifact, "manifestFailure": "",
			"derivedActions": []any{map[string]any{"name": "Work", "id": "source.vibe#Work", "start": 0, "end": len(request.Source)}}}
	}
	decode := func(value map[string]any, input PlanSourceRequest) error {
		encoded, err := json.Marshal(value)
		if err != nil {
			t.Fatal(err)
		}
		_, err = decodePlanSource(encoded, input)
		return err
	}
	if err := decode(base(), request); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name string
		edit func(map[string]any)
	}{
		{"extra", func(v map[string]any) { v["extra"] = true }},
		{"missing", func(v map[string]any) { delete(v, "diagnostics") }},
		{"null", func(v map[string]any) { v["derivedActions"] = nil }},
		{"status", func(v map[string]any) { v["status"] = "unchecked" }},
		{"mode", func(v map[string]any) { v["status"] = "manifest" }},
		{"leaked refused", func(v map[string]any) { v["status"] = "refused" }},
		{"leaked unrepresentable", func(v map[string]any) { v["status"] = "unrepresentable" }},
		{"missing Plan", func(v map[string]any) { v["planJson"] = "" }},
		{"missing Manifest outcome", func(v map[string]any) { v["manifestJson"] = "" }},
		{"two Manifest outcomes", func(v map[string]any) { v["manifestFailure"] = "failed" }},
		{"bad JSON", func(v map[string]any) { v["planJson"] = "null" }},
		{"foreign identity", func(v map[string]any) { v["planJson"] = strings.Replace(artifact, "test/Flow", "other", 1) }},
		{"version", func(v map[string]any) { v["planJson"] = strings.Replace(artifact, ":2", ":3", 1) }},
		{"declaration boundary", func(v map[string]any) {
			v["derivedActions"].([]any)[0].(map[string]any)["end"] = len(request.Source) + 1
		}},
		{"declaration identity", func(v map[string]any) { v["derivedActions"].([]any)[0].(map[string]any)["id"] = "wrong" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := base()
			tc.edit(value)
			if decode(value, request) == nil {
				t.Fatal("inconsistent protocol accepted")
			}
		})
	}
	value := base()
	value["status"], value["planJson"], value["manifestJson"], value["derivedActions"] = "unrepresentable", "", "", []any{}
	if err := decode(value, request); err != nil {
		t.Fatal(err)
	}
	request.Mode = "manifest"
	if decode(value, request) == nil {
		t.Fatal("manifest-only request cannot return Plan representability")
	}
}
