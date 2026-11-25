package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

type vip58Ceiling struct {
	source string
	plan   []string
	allows uint8
}

// Bits correspond to the four requests below, in order. Omission inherits;
// the explicitly empty ceiling denies every request.
var vip58Ceilings = []vip58Ceiling{
	{"", nil, 0b1111},
	{`["*"]`, []string{"*"}, 0b1111},
	{`["fs:*:/workspace/**"]`, []string{"fs:*:/workspace/**"}, 0b0111},
	{`["fs:read:/workspace/docs/**"]`, []string{"fs:read:/workspace/docs/**"}, 0b0001},
	{`[{ action: "fs:write", resource: "/workspace/docs/**" }]`, []string{"fs:write:/workspace/docs/**"}, 0b0010},
	{"[]", []string{}, 0},
}

var vip58Requests = []string{
	"fs:read:/workspace/docs/readme.md",
	"fs:write:/workspace/docs/readme.md",
	"fs:read:/workspace/config.json",
	"fs:read:/shared/config.json",
}

const vip58Observer = `import { Cause, Effect, Exit, Layer } from "effect"
import { Capability, Durable } from "vibelang-runtime/experimental"
import { Run } from "./main.js"
export function observe(capability, caller) {
  const app = Layer.provideMerge(Run.layer, Durable.memory)
  const grants = Capability.grantStore({ allow: ["*"], attended: false })
  const call = caller === null ? Run(capability) : Capability.attenuate(caller)(Run(capability))
  return Effect.gen(function* () {
    const declared = Run.plan
    const inspected = yield* Durable.plan(Run, capability)
    const exit = yield* Effect.provide(Effect.provide(Effect.exit(call), app), grants)
    return {
      declared: JSON.parse(JSON.stringify(declared)),
      plan: JSON.parse(JSON.stringify(inspected.plan)), digest: inspected.digest,
      outcome: Exit.isSuccess(exit) ? ["ok", exit.value] :
        exit.cause.reasons.map(r => Cause.isFailReason(r) ? ["fail", r.error] : ["defect"])
    }
  })
}
`

func FuzzVIP58CapabilitiesPlan(f *testing.F) {
	startShortBudget(f)
	for i := uint8(0); i < 12; i++ {
		f.Add(uint8(0), i, i, i, i, uint16(i))
	}
	for i, seed := range [][4]uint8{
		{0, 0, 0, 3}, {1, 2, 0, 2}, {2, 3, 1, 1}, {3, 2, 1, 0},
		{4, 1, 2, 1}, {1, 4, 3, 1}, {5, 1, 0, 0}, {1, 5, 0, 0},
		{1, 1, 5, 0}, {2, 2, 2, 3}, {1, 1, 4, 1}, {1, 1, 1, 3},
	} {
		f.Add(uint8(1), seed[0], seed[1], seed[2], seed[3], uint16(i))
	}
	w := NewWorkspace(f)
	node := vipNode(f, w)
	f.Fuzz(func(t *testing.T, family, a, b, c, request uint8, id uint16) {
		tiers := []string{"sealed", "compensable", "irreversible"}
		if family%2 == 0 {
			var source, want string
			rows := []string{
				`tier = "temporary"`, `tier = 17`,
				`capabilities = ["bogus:op:/workspace/**"]`,
				`capabilities = ["fs:read"]`,
				`capabilities = [{ action: "fs:read", resource: 23 }]`,
				`effects = { reads: ["nope:action"] }`,
				`effects = ["nope:action"]`,
				`effects = { writes: [false] }`,
			}
			row := int(a) % 12
			if row < len(rows) {
				kind := "task"
				if b%2 != 0 {
					kind = "workflow"
				}
				source = fmt.Sprintf("export %s Bad%d { static readonly %s; effect call(): number!! { return %d } }", kind, id, rows[row], id)
				want = "TS2322"
			} else {
				tier, service := "", "HttpClient.HttpClient"
				if row%2 == 1 {
					service = "ChildProcessSpawner.ChildProcessSpawner"
				}
				if row >= 10 {
					tier = fmt.Sprintf("static readonly tier = %q;", tiers[c%3])
				} else {
					want = "EK5801"
				}
				source = fmt.Sprintf("export task Check%d { %s effect call(): number!! { const _service = try %s; return %d } }", id, tier, service, id)
			}
			r := vipCompile(t, w, builtinsProject(map[string]string{"main.vibe": source}))
			if want == "" {
				vipDiagnostics(t, r)
			} else {
				vipDiagnostics(t, r, want)
			}
			return
		}

		workflow, task, caller := vip58Ceilings[a%6], vip58Ceilings[b%6], vip58Ceilings[c%6]
		tier, tierDeclared := tiers[id%3], id%4 != 3
		tierField := ""
		if tierDeclared {
			tierField = fmt.Sprintf("static readonly tier = %q", tier)
		} else {
			tier = "sealed"
		}
		static := func(ceiling vip58Ceiling) string {
			if ceiling.source == "" {
				return ""
			}
			return "static readonly capabilities = " + ceiling.source
		}
		source := fmt.Sprintf(`task Step {
  static readonly key = "vip58/step"
  %s
  %s
  static readonly effects = { reads: ["fs:read"], writes: [] }
  effect call(capability: string): number!string {
    try Effect.mapError(Experimental.Capability.check(capability as Experimental.Capability.CapabilityText),
      (error) => error._tag === "PermissionDenied" ? error.reason : "permission required")
    return %d
  }
}
export workflow Run {
  static readonly key = "vip58/run"
  static readonly tier = "irreversible"
  %s
  static readonly effects = ["fs:read"]
  effect call(capability: string): number!string { return try Step(capability) }
}
`, tierField, static(task), id, static(workflow))
		r := vipCompile(t, w, builtinsProject(map[string]string{"main.vibe": source}))
		vipDiagnostics(t, r)
		r.Outputs["out/observe.mjs"] = vip58Observer
		request %= uint8(len(vip58Requests))
		out := node.Run(r, "out/observe.mjs", "observe", vip58Requests[request], caller.plan)
		var got struct {
			Declared, Plan map[string]any
			Digest         string
			Outcome        any
		}
		if err := json.Unmarshal(out.Value, &got); out.Kind != "success" || err != nil {
			t.Fatalf("expected plan and ceiling observation, got %+v (%v)\n%s", out, err, source)
		}
		wantOutcome := any([]any{"ok", float64(id)})
		if (workflow.allows&task.allows&caller.allows)&(1<<request) == 0 {
			wantOutcome = []any{[]any{"fail", "outside capability ceiling"}}
		}
		node := map[string]any{
			"key": "vip58/step", "tier": tier, "tierDeclared": tierDeclared,
			"effects": map[string]any{"reads": []any{"fs:read"}, "writes": []any{}},
		}
		plan := map[string]any{
			"workflow": "vip58/run", "tier": "irreversible", "effects": []any{"fs:read"},
			"tasks": []any{node}, "nodes": []any{node},
		}
		for _, pair := range []struct {
			fields  map[string]any
			ceiling vip58Ceiling
		}{{node, task}, {plan, workflow}} {
			if pair.ceiling.plan != nil {
				values := make([]any, len(pair.ceiling.plan))
				for i, capability := range pair.ceiling.plan {
					values[i] = capability
				}
				pair.fields["capabilities"] = values
			}
		}
		if !reflect.DeepEqual(got.Declared, plan) || !reflect.DeepEqual(got.Plan, plan) ||
			len(got.Digest) != 64 || strings.Trim(got.Digest, "0123456789abcdef") != "" ||
			!reflect.DeepEqual(got.Outcome, wantOutcome) {
			t.Fatalf("want plan %v and outcome %v, got %s\n%s", plan, wantOutcome, out.Value, source)
		}
	})
}
