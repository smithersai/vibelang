package vibelangfuzz

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// The tests in this file check FuzzVIPDifferential's comparison on Exits
// written by hand, so a bug in the encoding cannot hide behind a generator
// that never produces the Exit it gets wrong.

// runVIPModule runs a hand-written module's main() in the worker's vip mode.
func (e *vipEnv) runVIPModule(t *testing.T, name, body string) VIPOutcome {
	t.Helper()
	dir := filepath.Join(e.w.Dir, "hand", name)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	source := "import { Effect } from \"effect\"\nimport { ev } from \"vip-events\"\n" + body + "\n"
	if err := os.WriteFile(filepath.Join(dir, "main.mjs"), []byte(source), 0o600); err != nil {
		t.Fatal(err)
	}
	return e.node.RunVIP(&Result{Dir: dir, Outputs: map[string]string{}}, "main.mjs")
}

// TestVIPExitEncoding runs hand-written Exits of each kind through the
// worker and checks their canonical encoding and the comparison's verdict
// on pairs that agree and pairs that do not (VIP-31: "the same `Exit` ...:
// success, failure, defect or interruption, with finalizers in the same
// order").
func TestVIPExitEncoding(t *testing.T) {
	env := newVIPEnv(t)
	modules := map[string]struct{ body, kind, exit string }{
		// A success keeps undefined, -0, NaN and bigint apart from what JSON
		// would turn them into, and orders object keys.
		"success": {`export const main = () => Effect.sync(() => { ev("a"); return { b: 2, a: [1, undefined, -0, NaN, 10n] } })`, "exit",
			`{"_tag":"Success","value":{"$class":"Object","fields":{"a":{"$array":[1,{"$undefined":true},{"$number":"-0"},{"$number":"NaN"},{"$bigint":"10"}]},"b":2}}}`},
		"success-other-events": {`export const main = () => Effect.sync(() => { ev("b"); return { b: 2, a: [1, undefined, -0, NaN, 10n] } })`, "exit",
			`{"_tag":"Success","value":{"$class":"Object","fields":{"a":{"$array":[1,{"$undefined":true},{"$number":"-0"},{"$number":"NaN"},{"$bigint":"10"}]},"b":2}}}`},
		"undefined": {`export const main = () => Effect.void`, "exit", `{"_tag":"Success","value":{"$undefined":true}}`},
		// A typed failure keeps an error's class, name, message and own
		// fields, and drops its stack.
		"fail-error": {`export const main = () => Effect.fail(Object.assign(new TypeError("A"), { code: 3 }))`, "exit",
			`{"_tag":"Failure","reasons":[{"_tag":"Fail","error":{"$class":"TypeError","fields":{"code":3},"message":"A","name":"TypeError"}}]}`},
		"fail-a": {`export const main = () => Effect.fail("A")`, "exit", `{"_tag":"Failure","reasons":[{"_tag":"Fail","error":"A"}]}`},
		"fail-b": {`export const main = () => Effect.fail("B")`, "exit", `{"_tag":"Failure","reasons":[{"_tag":"Fail","error":"B"}]}`},
		"die":    {`export const main = () => Effect.die("D")`, "exit", `{"_tag":"Failure","reasons":[{"_tag":"Die","defect":"D"}]}`},
		// The worker's driver forks main, so the interruptor is a fiber,
		// renamed to the first one the Exit names.
		"interrupt": {`export const main = () => Effect.interrupt`, "exit", `{"_tag":"Failure","reasons":[{"_tag":"Interrupt","fiberId":{"$fiber":0}}]}`},
		// ensuring(fail(A), die(D)) ends with two reasons, in order. Effect
		// 4.0.6 reports both as Die, as the host probes of opus.md and sol.md
		// §4 found; the encoding keeps what the runtime gives.
		"ensuring": {`export const main = () => Effect.fail("A").pipe(Effect.ensuring(Effect.die("D")))`, "exit",
			`{"_tag":"Failure","reasons":[{"_tag":"Die","defect":"A"},{"_tag":"Die","defect":"D"}]}`},
		// The driver advances virtual time, so a sleep ends without waiting.
		"sleep": {`export const main = () => Effect.sleep(5).pipe(Effect.andThen(Effect.sync(() => ev("late"))), Effect.as(1))`, "exit", `{"_tag":"Success","value":1}`},
		"never": {`export const main = () => Effect.never`, "stuck", ``},
		"hot":   {`export const main = () => { ev("hot"); return Effect.void }`, "exit", `{"_tag":"Success","value":{"$undefined":true}}`},
		// A plain program's main logs when called, and its Effect logs too.
		"hot-later": {`export const main = () => { ev("hot"); return Effect.sync(() => ev("later")) }`, "exit", `{"_tag":"Success","value":{"$undefined":true}}`},
		"later":     {`export const main = () => Effect.sync(() => { ev("hot"); ev("later") })`, "exit", `{"_tag":"Success","value":{"$undefined":true}}`},
		"plain":     {`export const main = () => 1`, "plain", `{"_tag":"Success","value":1}`},
	}
	got := map[string]VIPOutcome{}
	for name, m := range modules {
		out := env.runVIPModule(t, name, m.body)
		got[name] = out
		if out.Kind != m.kind {
			t.Errorf("%s: kind %s, want %s: %s", name, out.Kind, m.kind, out.Log)
			continue
		}
		if m.exit == "" {
			continue
		}
		canonical, err := CanonicalVIPExit(out.Exit)
		if err != nil {
			t.Errorf("%s: %v", name, err)
		} else if canonical != m.exit {
			t.Errorf("%s:\n got Exit %s\nwant Exit %s", name, canonical, m.exit)
		}
	}
	if s := got["sleep"]; s.Steps != 5 || strings.Join(s.Events, ",") != "late" {
		t.Errorf("sleep(5) took %d steps and logged %q; want 5 steps and [late]", s.Steps, s.Events)
	}
	if h := got["hot"]; strings.Join(h.Called, ",") != "hot" {
		t.Errorf("a main() that logs when called reports Called %q", h.Called)
	}
	for _, c := range []struct{ want, got, aspect string }{
		{"success", "success", ""},
		{"fail-a", "fail-a", ""},
		{"ensuring", "ensuring", ""},
		{"interrupt", "interrupt", ""},
		{"success", "success-other-events", "events"},
		{"success", "fail-a", "exit-tag"},
		{"undefined", "sleep", "value"},
		{"fail-a", "fail-b", "payload"},
		{"fail-a", "die", "reason-tags"},
		{"die", "ensuring", "reasons"},
		{"fail-a", "interrupt", "reason-tags"},
		{"undefined", "hot", "cold"},
		{"hot-later", "hot-later", ""},
		{"hot-later", "later", "called"},
		{"success", "never", "kind"},
		{"plain", "success", "kind"},
	} {
		if aspect, diff := VIPCompare(got[c.want], got[c.got]); aspect != c.aspect {
			t.Errorf("VIPCompare(%s, %s) = %q, want %q: %s", c.want, c.got, aspect, c.aspect, diff)
		}
	}
}

// TestVIPCanonicalExit checks the canonical form: key order does not
// matter, fiber ids are renamed by first appearance and keep which reasons
// share a fiber, reasons are never sorted, and a malformed Exit is refused.
func TestVIPCanonicalExit(t *testing.T) {
	canonical := func(s string) string {
		t.Helper()
		c, err := CanonicalVIPExit(json.RawMessage(s))
		if err != nil {
			t.Fatalf("%s: %v", s, err)
		}
		return c
	}
	interrupts := func(ids ...string) string {
		var reasons []string
		for _, id := range ids {
			reasons = append(reasons, `{"fiberId":{"$fiber":`+id+`},"_tag":"Interrupt"}`)
		}
		return `{"reasons":[` + strings.Join(reasons, ",") + `],"_tag":"Failure"}`
	}
	if a, b := canonical(`{"value":{"$class":"Object","fields":{"b":1,"a":2}},"_tag":"Success"}`), canonical(`{"_tag":"Success","value":{"fields":{"a":2,"b":1},"$class":"Object"}}`); a != b {
		t.Errorf("key order changes the canonical form: %s and %s", a, b)
	}
	if got, want := canonical(interrupts("17", "4", "17")), `{"_tag":"Failure","reasons":[{"_tag":"Interrupt","fiberId":{"$fiber":0}},{"_tag":"Interrupt","fiberId":{"$fiber":1}},{"_tag":"Interrupt","fiberId":{"$fiber":0}}]}`; got != want {
		t.Errorf("fiber ids:\n got %s\nwant %s", got, want)
	}
	if canonical(interrupts("17", "4", "17")) != canonical(interrupts("5", "9", "5")) {
		t.Error("renaming fibers does not make the same identities equal")
	}
	if canonical(interrupts("17", "4", "17")) == canonical(interrupts("5", "9", "9")) {
		t.Error("renaming fibers equates different identities")
	}
	if canonical(`{"_tag":"Failure","reasons":[{"_tag":"Fail","error":"A"},{"_tag":"Die","defect":"D"}]}`) == canonical(`{"_tag":"Failure","reasons":[{"_tag":"Die","defect":"D"},{"_tag":"Fail","error":"A"}]}`) {
		t.Error("reasons in another order compare equal")
	}
	for _, bad := range []string{
		`[]`,
		`{"_tag":"Success"}`,
		`{"_tag":"Failure","reasons":[{"_tag":"Fail"}]}`,
		`{"_tag":"Failure","reasons":[{"_tag":"Fail","error":1,"annotations":{}}]}`,
		`{"_tag":"Failure","reasons":[{"_tag":"Sequential","error":1}]}`,
		`{"_tag":"Exit","value":1}`,
	} {
		if _, err := CanonicalVIPExit(json.RawMessage(bad)); err == nil {
			t.Errorf("%s encodes", bad)
		}
	}
}

// TestVIPReferenceDeterminism checks that a reference whose two runs end
// differently is reported as the generator's bug, and that one whose runs
// agree is not.
func TestVIPReferenceDeterminism(t *testing.T) {
	env := newVIPEnv(t)
	counter := `export const main = () => Effect.sync(() => { globalThis.vipRuns = (globalThis.vipRuns ?? 0) + 1; return globalThis.vipRuns })`
	err := vipReferenceStable(env.runVIPModule(t, "counter-1", counter), env.runVIPModule(t, "counter-2", counter), true)
	if err == nil || !strings.Contains(err.Error(), "differs across two runs") {
		t.Errorf("a reference that counts its runs: %v", err)
	}
	stable := `export const main = () => Effect.sync(() => { ev("x"); return 1 })`
	if err := vipReferenceStable(env.runVIPModule(t, "stable-1", stable), env.runVIPModule(t, "stable-2", stable), true); err != nil {
		t.Errorf("a deterministic reference: %v", err)
	}
	hot := `export const main = () => { ev("x"); return Effect.void }`
	if err := vipReferenceStable(env.runVIPModule(t, "hot-ref", hot), VIPOutcome{}, true); err == nil {
		t.Error("an effect program's reference whose main() runs when called is accepted")
	}
	// A plain program's main runs its body when called.
	if err := vipReferenceStable(env.runVIPModule(t, "hot-plain-1", hot), env.runVIPModule(t, "hot-plain-2", hot), false); err != nil {
		t.Errorf("a plain program's reference: %v", err)
	}
	if err := vipReferenceStable(env.runVIPModule(t, "never-ref", `export const main = () => Effect.never`), VIPOutcome{}, true); err == nil {
		t.Error("a reference that never ends is accepted")
	}
}

// TestPinnedEffectVersion keeps the pin readable: NewWorkspace compares the
// installed effect with it (VIP-32), so a pin it cannot read would refuse
// every install.
func TestPinnedEffectVersion(t *testing.T) {
	if !regexp.MustCompile(`^\d+\.\d+\.\d+`).MatchString(PinnedEffectVersion()) {
		t.Fatalf("cannot read PINNED_EFFECT_VERSION from packages/runtime/src/version.ts: got %q", PinnedEffectVersion())
	}
}
