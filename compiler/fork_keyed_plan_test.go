package compiler

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"reflect"
	"strings"
	"testing"
)

type keyedPlanOracleFixture struct {
	Name      string          `json:"name"`
	Operation string          `json:"operation"`
	Input     json.RawMessage `json:"input"`
	Expected  struct {
		OK        bool            `json:"ok"`
		Plan      json.RawMessage `json:"plan"`
		Key       string          `json:"key"`
		ErrorCode string          `json:"errorCode"`
	} `json:"expected"`
}

func keyedPlanOracle(t *testing.T) []keyedPlanOracleFixture {
	t.Helper()
	bytes, err := os.ReadFile("testdata/keyed-plan-oracle.json")
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Revision, EffectVersion string
		Records                 []keyedPlanOracleFixture
	}
	if err := json.Unmarshal(bytes, &file); err != nil {
		t.Fatal(err)
	}
	if file.Revision != "6bcbaa2d03a10afe8fe59934dabe262f55f012e7" || file.EffectVersion != "4.0.0-rc.112" || len(file.Records) != 141 {
		t.Fatal("unreviewed oracle identity or fixture inventory")
	}
	return file.Records
}

func keyedPlanJSON(t *testing.T, value any) string {
	t.Helper()
	data, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

func keyedPlanValue(t *testing.T, source string) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal([]byte(source), &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func TestPinnedForkKeyedPlanOracleVectors(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedPlanCompiler)
	for _, fixture := range keyedPlanOracle(t) {
		t.Run(fixture.Name, func(t *testing.T) {
			got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: fixture.Operation, InputJSON: string(fixture.Input)})
			if err != nil || got.OK != fixture.Expected.OK {
				t.Fatalf("completion: %+v, %v", got, err)
			}
			if !got.OK {
				if got.ErrorCode != fixture.Expected.ErrorCode || got.Key != "" || got.PlanJSON != "" {
					t.Fatal(got)
				}
				return
			}
			if fixture.Operation == "derive-key" {
				if got.Key != fixture.Expected.Key || got.PlanJSON != "" {
					t.Fatal(got)
				}
				return
			}
			if !reflect.DeepEqual(keyedPlanValue(t, got.PlanJSON), keyedPlanValue(t, string(fixture.Expected.Plan))) {
				t.Fatalf("Plan differs from reference\nactual: %s\nexpected: %s", got.PlanJSON, fixture.Expected.Plan)
			}
			verified, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
				t.Fatalf("round trip: %+v, %v", verified, err)
			}
		})
	}
}

func TestPinnedForkKeyedPlanRejectsForgedArtifacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedPlanCompiler)
	fixtures := map[string]string{}
	for _, fixture := range keyedPlanOracle(t) {
		if fixture.Expected.OK {
			fixtures[fixture.Name] = string(fixture.Expected.Plan)
		}
	}
	node := func(plan map[string]any) map[string]any { return plan["nodes"].([]any)[0].(map[string]any) }
	for _, tc := range []struct {
		name, base string
		change     func(map[string]any)
	}{
		{"body", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["body"] = "changed" }},
		{"tier", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["kind"] = "irreversible" }},
		{"nondeterminism", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["nondeterministic"] = true }},
		{"placement", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["placement"] = "other-worker" }},
		{"capability", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["capabilities"] = []any{"Host"} }},
		{"layer", "one", func(p map[string]any) { node(p)["material"].(map[string]any)["layers"] = []any{"unapproved"} }},
		{"material-only-effects", "one", func(p map[string]any) {
			node(p)["material"].(map[string]any)["effects"] = map[string]any{"reads": []any{}, "writes": []any{"out"}, "boundaryMode": "hard"}
		}},
		{"material-missing-effects", "one", func(p map[string]any) { delete(node(p)["material"].(map[string]any), "effects") }},
		{"declared-effects", "one", func(p map[string]any) { node(p)["effects"].(map[string]any)["writes"] = []any{"out"} }},
		{"key", "one", func(p map[string]any) { node(p)["key"] = "key1_" + strings.Repeat("0", 64) }},
		{"unknown-key-version", "one", func(p map[string]any) { node(p)["key"] = "key2_" + strings.Repeat("0", 64) }},
		{"priority", "one", func(p map[string]any) { node(p)["priority"] = float64(17) }},
		{"strategy", "one", func(p map[string]any) { node(p)["strategy"] = "lane" }},
		{"runtime", "one", func(p map[string]any) { node(p)["runtime"] = "stop-merge" }},
		{"kind", "one", func(p map[string]any) { node(p)["kind"] = "agent" }},
		{"node-address", "one", func(p map[string]any) { node(p)["id"] = "other" }},
		{"plan-address", "one", func(p map[string]any) { p["planId"] = "other" }},
		{"flow-address", "one", func(p map[string]any) { p["flow"] = "other" }},
		{"missing-node", "one", func(p map[string]any) { p["nodes"] = []any{} }},
		{"reordered-nodes", "independent", func(p map[string]any) { ns := p["nodes"].([]any); ns[0], ns[1] = ns[1], ns[0] }},
		{"invented-edge", "one", func(p map[string]any) { node(p)["dependsOn"] = []any{"missing"} }},
		{"lost-edge", "dependency-order", func(p map[string]any) { p["nodes"].([]any)[1].(map[string]any)["dependsOn"] = []any{} }},
		{"duplicate-node", "one", func(p map[string]any) { p["nodes"] = append(p["nodes"].([]any), node(p)) }},
		{"digest", "one", func(p map[string]any) { p["digest"] = "key1_" + strings.Repeat("0", 64) }},
		{"base-digest", "append-dependency", func(p map[string]any) { p["baseDigest"] = p["digest"] }},
		{"inflated-generation", "one", func(p map[string]any) { p["generation"] = float64(2) }},
		{"negative-generation", "one", func(p map[string]any) { p["generation"] = float64(-1) }},
		{"node-generation", "one", func(p map[string]any) { node(p)["generation"] = float64(1) }},
		{"lost-appended-generation", "append-dependency", func(p map[string]any) { p["nodes"].([]any)[1].(map[string]any)["generation"] = float64(0) }},
		{"generation-gap", "append-dependency", func(p map[string]any) {
			p["generation"] = float64(2)
			p["nodes"].([]any)[1].(map[string]any)["generation"] = float64(2)
		}},
		{"retroactive-conflict", "append-frozen-conflict", func(p map[string]any) { node(p)["conflicts"] = p["nodes"].([]any)[1].(map[string]any)["conflicts"] }},
		{"conflict-path", "write-serialize", func(p map[string]any) { node(p)["conflicts"].([]any)[0].(map[string]any)["paths"] = []any{"different"} }},
		{"conflict-target", "write-serialize", func(p map[string]any) { node(p)["conflicts"].([]any)[0].(map[string]any)["with"] = "missing" }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			value := keyedPlanValue(t, fixtures[tc.base])
			tc.change(value)
			got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: keyedPlanJSON(t, value)})
			if err != nil || got.OK || got.PlanJSON != "" || got.Key != "" {
				t.Fatalf("forgery: %+v, %v", got, err)
			}
			// Append must verify the old graph before adopting any new work.
			got, err = query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "append", InputJSON: keyedPlanJSON(t, map[string]any{"plan": value, "nodes": []any{}})})
			if err != nil || got.OK || got.PlanJSON != "" {
				t.Fatalf("append forgery: %+v, %v", got, err)
			}
		})
	}
	t.Run("schema-excess-does-not-grant-authority", func(t *testing.T) {
		value := keyedPlanValue(t, fixtures["one"])
		value["approved"] = true
		node(value)["execute"] = "untrusted code"
		got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: keyedPlanJSON(t, value)})
		if err != nil || !got.OK || strings.Contains(got.PlanJSON, "approved") || strings.Contains(got.PlanJSON, "untrusted code") {
			t.Fatalf("schema projection: %+v, %v", got, err)
		}
	})
}

func TestPinnedForkKeyedPlanMalformedWireAndBudgets(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedPlanCompiler)
	for _, source := range []string{
		`{"a":1,"a":2}`, `{"a":1,"\u0061":2}`, `{"nested":{"x":1,"x":2}}`, `"\ud800"`, `"\udfff"`,
		`"` + string([]byte{0xff}) + `"`, `1e400`, `null null`, ``, `[1,]`, strings.Repeat("[", 257) + "0" + strings.Repeat("]", 257),
		`"` + strings.Repeat("x", 16*1024*1024) + `"`,
	} {
		got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "derive-key", InputJSON: source})
		if err != nil {
			// Invalid UTF-8 cannot cross even the outer host transport.
			if strings.Contains(source, string([]byte{0xff})) && errors.Is(err, ErrForkProtocol) {
				continue
			}
			t.Fatal(err)
		}
		if got.OK || got.ErrorCode != "invalid_json" || got.Key != "" || got.PlanJSON != "" {
			t.Fatal(got)
		}
	}
	zero, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "derive-key", InputJSON: "-0"})
	if err != nil || !zero.OK {
		t.Fatal(zero, err)
	}
	positive, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "derive-key", InputJSON: "0"})
	if err != nil || positive.Key != zero.Key {
		t.Fatal("RFC 8785 negative-zero mismatch", positive, err)
	}
	for _, operation := range []string{"", "plan", "execute", "cache", "dispatch-key"} {
		got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: operation, InputJSON: "null"})
		if err != nil || got.OK || got.ErrorCode != "invalid_operation" {
			t.Fatal(got, err)
		}
	}
	for _, source := range []string{
		`{"operation":"verify","operation":"derive-key","inputJson":"null"}`,
		`{"operation":"derive-key","inputJson":"null","inputJson":"0"}`,
		`{"operation":"derive-key","inputJson":"null","extra":true}`,
		`{"operation":"derive-key","inputJson":"null"} {}`,
	} {
		command := exec.CommandContext(ctx, backend.(*forkCompiler).executable, "--keyed-plan")
		command.Stdin = strings.NewReader(source)
		data, err := command.Output()
		if err != nil {
			t.Fatal(err)
		}
		var wire struct {
			Result KeyedPlanResult
			Error  *struct{ Code string }
		}
		if json.Unmarshal(data, &wire) != nil || wire.Error == nil || wire.Error.Code != "VIBELANG_GO_KEYED_PLAN" || wire.Result.OK || wire.Result.PlanJSON != "" || wire.Result.Key != "" {
			t.Fatalf("outer wire: %s", data)
		}
	}
	// A long chain uses an explicit stack; an oversized graph refuses before
	// schema traversal or conflict allocation. Neither path executes source.
	for _, count := range []int{10000, 10001} {
		nodes := make([]any, 0, count)
		for index := 0; index < count; index++ {
			inputs := []any{}
			if index > 0 {
				inputs = append(inputs, map[string]any{"_tag": "Pending", "from": keyedPlanJSON(t, index-1)})
			}
			nodes = append(nodes, map[string]any{"id": keyedPlanJSON(t, index), "material": map[string]any{"version": "flows/key-material/v2", "kind": "sealed", "body": index, "inputs": inputs, "layers": []any{}, "capabilities": []any{}}, "effects": map[string]any{"reads": []any{}, "writes": []any{}, "boundaryMode": "hard"}})
		}
		got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "compile", InputJSON: keyedPlanJSON(t, map[string]any{"planId": "large", "flow": "large", "nodes": nodes})})
		if err != nil || got.OK != (count == 10000) {
			t.Fatalf("size %d: %+v, %v", count, got, err)
		}
		if !got.OK && got.ErrorCode != "graph_too_large" {
			t.Fatal(got)
		}
		if got.OK {
			verified, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
			if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
				t.Fatal("large verification", verified.ErrorCode, err)
			}
		}
	}
}

func TestKeyedPlanResponseRejectsContradictions(t *testing.T) {
	key := "key1_" + strings.Repeat("0", 64)
	valid := map[string]any{"ok": true, "planJson": "", "key": key, "errorCode": "", "message": ""}
	for _, mutation := range []func(map[string]any){
		func(v map[string]any) { delete(v, "ok") }, func(v map[string]any) { v["ok"] = nil }, func(v map[string]any) { v["ok"] = "yes" },
		func(v map[string]any) { v["extra"] = true }, func(v map[string]any) { v["planJson"] = "{}" }, func(v map[string]any) { v["key"] = "key2_" + strings.Repeat("0", 64) },
		func(v map[string]any) { v["errorCode"] = "invalid_plan" }, func(v map[string]any) { v["message"] = "refused" }, func(v map[string]any) { v["ok"] = false },
	} {
		value := keyedPlanValue(t, keyedPlanJSON(t, valid))
		mutation(value)
		_, err := decodeKeyedPlanResult(json.RawMessage(keyedPlanJSON(t, value)), KeyedPlanRequest{Operation: "derive-key"})
		if !errors.Is(err, ErrForkProtocol) {
			t.Fatalf("accepted contradiction: %+v, %v", value, err)
		}
	}
	if _, err := decodeKeyedPlanResult(json.RawMessage(keyedPlanJSON(t, valid)), KeyedPlanRequest{Operation: "derive-key"}); err != nil {
		t.Fatal(err)
	}
	// The host honors cancellation before spawning any compiler process.
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := (&forkCompiler{executable: "must-not-start"}).KeyedPlan(ctx, KeyedPlanRequest{Operation: "derive-key", InputJSON: "null"})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}

func TestPinnedForkKeyedPlanDenseEffectsHaveAnAllocationBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedPlanCompiler)
	base := map[string]any{"planId": "bounded-effects", "flow": "test/Flow"}
	nodes := []any{}
	for index := 0; index < 450; index++ {
		nodes = append(nodes, map[string]any{
			"id": keyedPlanJSON(t, index), "conflictStrategy": "lane",
			"material": map[string]any{"version": "flows/key-material/v2", "kind": "sealed", "body": index, "inputs": []any{}, "layers": []any{}, "capabilities": []any{}},
			"effects":  map[string]any{"reads": []any{}, "writes": []any{"out"}, "boundaryMode": "hard"},
		})
	}
	base["nodes"] = nodes
	got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "compile", InputJSON: keyedPlanJSON(t, base)})
	if err != nil || got.OK || got.ErrorCode != "graph_too_large" || got.PlanJSON != "" {
		t.Fatalf("dense graph: %+v, %v", got, err)
	}
}

func TestPinnedForkKeyedPlanEmptyAndRoundtrip(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	query := backend.(KeyedPlanCompiler)
	got, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "compile", InputJSON: `{"planId":"alpha-contract","flow":"example/Flow","nodes":[]}`})
	if err != nil || !got.OK || got.PlanJSON == "" {
		t.Fatalf("compile: %+v, %v", got, err)
	}
	verified, err := query.KeyedPlan(ctx, KeyedPlanRequest{Operation: "verify", InputJSON: got.PlanJSON})
	if err != nil || !verified.OK || verified.PlanJSON != got.PlanJSON {
		t.Fatalf("verify: %+v, %v", verified, err)
	}
	var plan map[string]any
	if err := json.Unmarshal([]byte(got.PlanJSON), &plan); err != nil {
		t.Fatal(err)
	}
	if plan["baseDigest"] != plan["digest"] || plan["generation"] != float64(0) {
		t.Fatal(plan)
	}
}
