package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// vipDiagnostics checks every error and requires exactly the listed diagnostics.
// Other warnings are advisory unless this test names their code explicitly.
func vipDiagnostics(t *testing.T, r *Result, want ...string) {
	t.Helper()
	counts := make(map[string]int, len(want))
	for _, code := range want {
		counts[code]++
	}
	for _, d := range r.Diagnostics {
		code := diagnosticKey(d)
		if d.Category() != diagnostics.CategoryError && !strings.HasPrefix(code, "EK56") && !strings.HasPrefix(code, "EK57") && !strings.HasPrefix(code, "EK58") {
			continue
		}
		if (code == "EK5801" && d.Category() != diagnostics.CategoryWarning) || (code != "EK5801" && d.Category() != diagnostics.CategoryError) {
			t.Fatalf("wrong diagnostic category: %s", describe(d))
		}
		counts[code]--
	}
	for _, count := range counts {
		if count != 0 {
			t.Fatalf("wanted diagnostics %v, got %v\n%s", want, Keys(r.Dir, r.Diagnostics), Archive(r.Sources))
		}
	}
}

func vipCompile(t *testing.T, w *Workspace, project Project) *Result {
	t.Helper()
	r, err := w.Compile(t.Context(), project)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(r.Remove)
	return r
}

func vipNode(t testing.TB, w *Workspace) *Node {
	t.Helper()
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(node.Close)
	return node
}

const vip56Prelude = `schema Payment { amount: number }
const paid = Experimental.Durable.signal("paid", Payment)
const { wait: waitPaid } = paid
const pause = Experimental.Durable.sleep
const { until: waitUntil } = Experimental.Durable
const { confirm: ask } = Experimental.Human
task Ready { effect call(n: number): number!! { return n } }
task Fail { effect call(n: number): number!string { throw "failed:" + n } }
`

// The JS observer reads the actual store and then invokes the same workflow
// again against a fresh engine backed by that store.
const vip56Observer = `import { Cause, Effect, Exit, Layer } from "effect"
import { Durable } from "vibelang-runtime/experimental"
import { Run } from "./main.js"
export function observe(n) {
  const store = Durable.makeMemoryStore()
  const layer = () => Layer.provideMerge(Run.layer, Durable.layerStore(store))
  const invoke = () => Effect.provide(Effect.exit(Run(n)), layer())
  const result = exit => Exit.isSuccess(exit) ? ["ok", exit.value] :
    exit.cause.reasons.map(r => Cause.isFailReason(r) ? ["fail", r.error] : ["die", r.defect?.message])[0]
  return Effect.gen(function* () {
    const firstExit = yield* invoke()
    const first = result(firstExit)
    const deadlineTag = Exit.isFailure(firstExit)
      ? firstExit.cause.reasons.find(Cause.isDieReason)?.defect?._tag ?? null : null
    const rows = yield* store.list({})
    const journal = () => Effect.map(store.entries(rows[0].run), entries =>
      entries.filter(e => e.eventType === "DeferredDone" &&
        /^raceAll\/(?:try\.(?:race|any)\/|%24workflow|\$workflow)/.test(e.payload.name))
        .map(e => e.payload))
    const before = yield* journal()
    const again = result(yield* invoke())
    const after = yield* journal()
    return { first, again, runs: rows.length, before, after, deadlineTag }
  })
}
`

// FuzzVIP56DurableWaits checks binding-sensitive diagnostics and the complete
// path from workflow lowering to recorded winners and replay.
func FuzzVIP56DurableWaits(f *testing.F) {
	startShortBudget(f)
	for mode := byte(0); mode < 8; mode++ {
		for wait := byte(0); wait < 5; wait++ {
			if mode < 4 && wait != 0 {
				continue
			}
			f.Add(mode, wait, int16(17+mode), wait%2 == 0)
			if mode < 3 {
				f.Add(mode, wait, -int16(17+mode), false)
			}
		}
	}
	w := NewWorkspace(f)
	node := vipNode(f, w)
	f.Fuzz(func(t *testing.T, mode, wait byte, input int16, reverse bool) {
		if mode %= 8; mode >= 4 {
			operand := []string{`pause(0)`, `waitUntil(0)`, `waitPaid("second")`, `ask("approve", "Proceed?")`, `fake.wait()`}[wait%5]
			body := "if (true) { try " + operand + " }; return 1"
			if mode == 5 && wait%5 == 3 {
				body = "if (true) { try Effect.ignore(" + operand + ") }; return 1"
			}
			source := vip56Prelude + "const fake = { wait: () => Effect.succeed(1) }\n"
			switch mode {
			case 4:
				source += "export effect function outside() { " + body + " }"
			case 5:
				source += "export task Outside { effect call(): number!! { " + body + " } }"
			case 6:
				source += "export workflow Nested { effect call() { const inner = effect () => { " + body + " }; void inner; return 1 } }"
			case 7:
				source += "export const held = () => " + operand
			}
			r := vipCompile(t, w, builtinsProject(map[string]string{"main.vibe": source}))
			if wait%5 < 4 && mode < 7 {
				vipDiagnostics(t, r, "EK5601")
			} else {
				vipDiagnostics(t, r)
			}
			return
		}

		op, left, right := "race", "waitPaid()", "Ready(n)"
		body := ""
		deadline := `"1 hour"`
		want := []any{"ok", float64(input)}
		winner := 1
		switch mode {
		case 0:
			body = `const both = try.all [Ready(n), Ready(n + 1), pause(0)]
    try waitUntil(0)
    if (both[0] === n && both[1] === n + 1) { return OP }
    return -123456`
		case 1:
			op, left, right = "any", "Fail(n)", "Ready(n)"
			body = "if (n !== -123456) { if (true) { return OP } }; return -123456"
		case 2:
			left, right = "waitPaid()", "Fail(n)"
			body = "return OP"
			want = []any{"fail", fmt.Sprintf("failed:%d", input)}
		case 3:
			deadline, body = "0", "return (try waitPaid()).amount"
			want = []any{"die", "Workflow vip56/run exceeded its deadline (0)."}
		}
		if reverse {
			left, right = right, left
			winner = 0
		}
		body = strings.ReplaceAll(body, "OP", fmt.Sprintf("try.%s [%s, %s]", op, left, right))
		source := vip56Prelude + fmt.Sprintf("export workflow Run {\n  static readonly key = \"vip56/run\"\n  static readonly deadline = %s\n  effect call(n: number) {\n    %s\n  }\n}\n", deadline, body)
		r := vipCompile(t, w, builtinsProject(map[string]string{"main.vibe": source}))
		vipDiagnostics(t, r)
		js := r.Outputs["out/main.js"]
		if js == "" || (mode != 3 && strings.Count(js, ".raceSteps(") != 1) {
			t.Fatalf("expected one durable race when written:\n%s", js)
		}
		r.Outputs["out/observe.mjs"] = vip56Observer
		out := node.Run(r, "out/observe.mjs", "observe", input)
		var observed struct {
			First, Again  []any
			Runs          int
			Before, After []map[string]any
			DeadlineTag   string
		}
		if out.Kind != "success" || json.Unmarshal(out.Value, &observed) != nil {
			t.Fatalf("run did not produce a journal observation: %+v\n%s", out, source)
		}
		if (mode == 3 && observed.DeadlineTag != "DeadlineExceeded") || observed.Runs != 1 || !reflect.DeepEqual(observed.First, want) || !reflect.DeepEqual(observed.Again, want) || !reflect.DeepEqual(observed.Before, observed.After) {
			t.Fatalf("want one run with replay %v and identical journal, got %s\n%s", want, out.Value, source)
		}
		hits := 0
		for _, entry := range observed.Before {
			name, _ := entry["name"].(string)
			if mode == 3 && strings.HasSuffix(name, "%24workflow%2Frun") {
				hits++
				exit, _ := entry["exit"].(map[string]any)
				if exit["_tag"] != "Success" || !reflect.DeepEqual(exit["value"], map[string]any{"_tag": "deadline"}) {
					t.Fatalf("the deadline arm must be journaled: %v", exit)
				}
			}
			if mode != 3 && strings.HasPrefix(name, "raceAll/try."+op+"/") {
				hits++
				exit, _ := entry["exit"].(map[string]any)
				winnerValue := []any{float64(winner), want[1]}
				wantExit := map[string]any{"_tag": "Success", "value": winnerValue}
				if mode == 2 {
					wantExit = map[string]any{
						"_tag":  "Failure",
						"cause": []any{map[string]any{"_tag": "Fail", "error": winnerValue}},
					}
				}
				if !reflect.DeepEqual(exit, wantExit) {
					t.Fatalf("want journaled winner %v, got %v", wantExit, exit)
				}
			}
		}
		if hits != 1 {
			t.Fatalf("expected exactly one journaled winner, got %s", out.Value)
		}
	})
}
