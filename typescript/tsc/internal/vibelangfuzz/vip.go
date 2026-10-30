package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
)

// This file runs FuzzVIPDifferential's programs and compares them. VIP-31:
// "Compiled output gives the same `Exit` as the Effect TypeScript shown in
// each VIP: success, failure, defect or interruption, with finalizers in the
// same order." The worker's vip mode runs a module's main() under a virtual
// clock and answers its Exit and event log in a canonical encoding;
// VIPCompare compares two answers exactly, after renaming fiber ids. A
// module with no main export runs its default export instead (Chapter 1:
// "`export default effect function (p) { B }` | `export default function
// (p) { return Effect.gen(function* () { B }) }`").

// vipMaxSteps bounds how many 1 ms steps of virtual time a program may
// take before the worker reports it stuck.
const vipMaxSteps = 10000

// vipWorker is the worker's vip mode. It calls main() and records what the
// call logged (VIP-1: "Calling an `effect` function returns its Effect
// unrun"; a plain program's main runs its body when called), then runs the
// Effect under TestClock.layer(), which installs the clock's tracking
// scheduler, with References.MaxOpsBeforeYield at its maximum: two
// equivalent programs whose op counts differ would otherwise yield at
// different points. A driver advances the clock 1 ms per step
// until the program's fiber ends. The encoding keeps every reason of the
// cause in order, with its kind and payload; it drops only stacks and
// annotations, and tags what JSON cannot say: undefined, bigint, NaN, the
// infinities, -0, classes, errors and fiber ids.
//
// An Exit, Cause or cause reason anywhere inside a success value or a
// failure's payload is encoded like the top-level Exit, as {"$exit": …},
// {"$cause": [reasons]} or {"$reason": …}, so its fiber ids are tagged and
// renamed with the top-level ones (CanonicalVIPExit). It is recognized by
// Effect's own type ids, the properties "~effect/Exit", "~effect/Cause" and
// "~effect/Cause/Reason" in effect 4.1.0 (strings, not symbols), through
// Exit.isExit, Cause.isCause and Cause.isReason; an object that only has a
// _tag of "Success" stays an object. Events are labels, which ev turns into
// strings, so they hold no Exit.
const vipWorker = `
const vipEncode = (value, depth = 0, seen = new Set()) => {
  switch (typeof value) {
    case "undefined": return { $undefined: true };
    case "bigint": return { $bigint: String(value) };
    case "symbol": return { $symbol: value.description ?? "" };
    case "function": return { $function: value.name };
    case "number":
      if (Number.isNaN(value)) return { $number: "NaN" };
      if (value === Infinity || value === -Infinity) return { $number: String(value) };
      if (Object.is(value, -0)) return { $number: "-0" };
      return value;
    case "string": case "boolean": return value;
  }
  if (value === null) return null;
  if (depth > 16) return { $deep: true };
  if (seen.has(value)) return { $cycle: true };
  seen.add(value);
  try {
    const next = (v) => vipEncode(v, depth + 1, seen);
    if (Exit.isExit(value)) return { $exit: vipExit(value, next) };
    if (Cause.isCause(value)) return { $cause: value.reasons.map((r) => vipReason(r, next)) };
    if (Cause.isReason(value)) return { $reason: vipReason(value, next) };
    if (Array.isArray(value)) return { $array: value.map(next) };
    if (value instanceof Map) return { $map: [...value].map(([k, v]) => [next(k), next(v)]) };
    if (value instanceof Set) return { $set: [...value].map(next) };
    const fields = { __proto__: null };
    for (const key of Object.keys(value).sort()) {
      if (key !== "stack") fields[key] = next(value[key]);
    }
    const proto = Object.getPrototypeOf(value);
    const out = { $class: proto === null ? null : proto === Object.prototype ? "Object" : String(proto.constructor?.name), fields };
    if ("_tag" in value && !Object.hasOwn(value, "_tag")) out.tag = next(value._tag);
    if (value instanceof Error) {
      out.name = String(value.name);
      out.message = String(value.message);
      if ("cause" in value) out.cause = next(value.cause);
    }
    return out;
  } finally {
    seen.delete(value);
  }
};
const vipReason = (r, encode) =>
  Cause.isFailReason(r) ? { _tag: "Fail", error: encode(r.error) }
  : Cause.isDieReason(r) ? { _tag: "Die", defect: encode(r.defect) }
  : { _tag: "Interrupt", fiberId: r.fiberId === undefined ? { $undefined: true } : { $fiber: r.fiberId } };
const vipExit = (exit, encode = vipEncode) => Exit.isSuccess(exit)
  ? { _tag: "Success", value: encode(exit.value) }
  : { _tag: "Failure", reasons: exit.cause.reasons.map((r) => vipReason(r, encode)) };
async function vip(entry, maxSteps) {
  try {
    const { References } = await import("effect");
    const { TestClock } = await import("effect/testing");
    const events = await import("vip-events");
    const module = await import(pathToFileURL(entry).href);
    events.reset();
    const main = "main" in module ? module.main : module.default;
    const program = main();
    const called = events.events();
    if (typeof program?.then === "function") return { kind: "crash", log: "main() returned a Promise, which the worker does not await, so it cannot compare what it gives" };
    if (!Effect.isEffect(program)) return { kind: "plain", called, events: called, exit: { _tag: "Success", value: vipEncode(program) } };
    const driven = Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(program);
      for (let step = 0; step <= maxSteps; step++) {
        const exit = fiber.pollUnsafe();
        if (exit) return { exit, step };
        yield* TestClock.adjust(1);
      }
      return { step: -1 };
    }).pipe(Effect.provide(TestClock.layer()), Effect.provideService(References.MaxOpsBeforeYield, Number.MAX_SAFE_INTEGER));
    const { exit, step } = await Effect.runPromise(driven);
    if (!exit) return { kind: "stuck", called, events: events.events(), log: "main() did not end in " + maxSteps + " ms of virtual time" };
    return { kind: "exit", called, events: events.events(), steps: step, exit: vipExit(exit) };
  } catch (error) {
    return { kind: "crash", log: String(error?.stack ?? error) };
  }
}
`

// A VIPOutcome is one run of a module's main() in the worker's vip mode.
type VIPOutcome struct {
	// Kind is "exit" when the Effect ended, "plain" when main() returned no
	// Effect, "stuck" when it did not end within vipMaxSteps ms of virtual
	// time, "timeout" when it did not end within RunLimit, and "crash" when
	// the module could not run or main() returned a Promise.
	Kind string `json:"kind"`
	// Exit is the Exit in the worker's encoding: {"_tag":"Success","value":…}
	// or {"_tag":"Failure","reasons":[…]}.
	Exit json.RawMessage `json:"exit,omitempty"`
	// Called is the event log of the call main(), before the Effect ran;
	// Events is the log once the Effect ended.
	Called []string `json:"called"`
	Events []string `json:"events"`
	Steps  int      `json:"steps"`
	Log    string   `json:"log,omitempty"`
}

// RunVIP runs the export main of a module, or its default export when it
// has no main, in the result's directory, after writing the result's
// outputs there.
func (n *Node) RunVIP(result *Result, file string) VIPOutcome {
	if crash := writeOutputs(result); crash != "" {
		return VIPOutcome{Kind: "crash", Log: crash}
	}
	request, _ := json.Marshal(map[string]any{"vip": true, "entry": filepath.Join(result.Dir, filepath.FromSlash(file)), "maxSteps": vipMaxSteps})
	line, failed := n.ask(request, file)
	if failed != nil {
		return VIPOutcome{Kind: failed.Kind, Log: failed.Log}
	}
	var outcome VIPOutcome
	if err := json.Unmarshal([]byte(line), &outcome); err != nil {
		failed := n.invalid(line)
		return VIPOutcome{Kind: failed.Kind, Log: failed.Log}
	}
	if outcome.Kind == "crash" {
		outcome.Log += "\n" + n.printedText()
	}
	return outcome
}

// CanonicalVIPExit returns an encoded Exit in canonical form: object keys in
// order, and each fiber id renamed to the order of its first appearance,
// which keeps which reasons name the same fiber and nothing else (fiber ids
// count every fiber the runtime started, the driver's too). Nothing is
// sorted, so the order of reasons stays as the cause has it. An Exit, Cause
// or reason nested in a payload ($exit, $cause, $reason) must have the
// top-level shapes, and its fiber ids share the top-level Exit's renaming,
// so a fiber keeps one name across the whole value.
func CanonicalVIPExit(raw json.RawMessage) (string, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return "", fmt.Errorf("an Exit that is not JSON: %w: %s", err, raw)
	}
	if err := checkVIPExit(value); err != nil {
		return "", fmt.Errorf("%w: %s", err, raw)
	}
	fibers := map[string]int{}
	var malformed error
	var rename func(any) any
	rename = func(v any) any {
		switch v := v.(type) {
		case map[string]any:
			if len(v) == 1 {
				var err error
				if x, ok := v["$exit"]; ok {
					err = checkVIPExit(x)
				} else if x, ok := v["$cause"]; ok {
					err = checkVIPReasons(x)
				} else if x, ok := v["$reason"]; ok {
					err = checkVIPReasons([]any{x})
				}
				if err != nil && malformed == nil {
					malformed = fmt.Errorf("nested: %w", err)
				}
			}
			if id, ok := v["$fiber"]; ok && len(v) == 1 {
				key := fmt.Sprint(id)
				if _, seen := fibers[key]; !seen {
					fibers[key] = len(fibers)
				}
				return map[string]any{"$fiber": fibers[key]}
			}
			// encoding/json writes a map's keys in order, which renames
			// fibers in that order too.
			out := map[string]any{}
			for _, k := range mapKeys(v) {
				// An encoded object's fields is a source-keyed dictionary,
				// not an encoded value. Only its values can carry runtime tags.
				if _, object := v["$class"]; object && k == "fields" {
					if fields, ok := v[k].(map[string]any); ok {
						data := map[string]any{}
						for _, name := range mapKeys(fields) {
							data[name] = rename(fields[name])
						}
						out[k] = data
						continue
					}
				}
				out[k] = rename(v[k])
			}
			return out
		case []any:
			out := make([]any, len(v))
			for i, x := range v {
				out[i] = rename(x)
			}
			return out
		}
		return v
	}
	canonical := rename(value)
	if malformed != nil {
		return "", fmt.Errorf("%w: %s", malformed, raw)
	}
	data, err := json.Marshal(canonical)
	return string(data), err
}

// checkVIPExit checks an encoded Exit's shape: a Success with exactly _tag
// and value, or a Failure with exactly _tag and reasons.
func checkVIPExit(value any) error {
	exit, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("an Exit that is not an object")
	}
	switch exit["_tag"] {
	case "Success":
		if _, ok := exit["value"]; !ok || len(exit) != 2 {
			return fmt.Errorf("a Success needs exactly _tag and value")
		}
	case "Failure":
		if _, ok := exit["reasons"]; !ok || len(exit) != 2 {
			return fmt.Errorf("a Failure needs exactly _tag and reasons")
		}
		return checkVIPReasons(exit["reasons"])
	default:
		return fmt.Errorf("an Exit that is neither Success nor Failure")
	}
	return nil
}

// checkVIPReasons checks an encoded cause's reasons: each is Fail(error),
// Die(defect) or Interrupt(fiberId), with nothing else.
func checkVIPReasons(value any) error {
	reasons, ok := value.([]any)
	if !ok {
		return fmt.Errorf("reasons that are not an array")
	}
	for _, r := range reasons {
		reason, _ := r.(map[string]any)
		payload := map[any]string{"Fail": "error", "Die": "defect", "Interrupt": "fiberId"}[reason["_tag"]]
		if _, ok := reason[payload]; payload == "" || !ok || len(reason) != 2 {
			return fmt.Errorf("a reason that is not Fail(error), Die(defect) or Interrupt(fiberId)")
		}
	}
	return nil
}

// VIPCompare compares two runs of programs VIP-31 says end alike. It
// returns "" when they agree, or the first aspect that disagrees and how:
// "kind" (one did not end with an Exit), "cold" (main() ran something when
// called, which VIP-1 forbids), "exit-tag", "value", "reasons" (their
// number), "reason-tags", "payload" (a reason's payload), "events" (the
// event logs, which are compared exactly, in order), or "called" (calling a
// plain program's main, which runs its body when called, logged
// differently).
func VIPCompare(want, got VIPOutcome) (aspect, diff string) {
	if want.Kind != "exit" || got.Kind != "exit" {
		if want.Kind != got.Kind {
			return "kind", fmt.Sprintf("want %s, got %s: %s", want.Kind, got.Kind, strings.TrimSpace(got.Log+"\n"+want.Log))
		}
		if want.Kind != "plain" {
			return "kind", fmt.Sprintf("both ended %s: %s", want.Kind, strings.TrimSpace(got.Log))
		}
	}
	if len(got.Called) > 0 && len(want.Called) == 0 {
		return "cold", fmt.Sprintf("calling main() logged %q before its Effect ran", got.Called)
	}
	wantExit, err := CanonicalVIPExit(want.Exit)
	if err != nil {
		return "encoding", "want: " + err.Error()
	}
	gotExit, err := CanonicalVIPExit(got.Exit)
	if err != nil {
		return "encoding", "got: " + err.Error()
	}
	if wantExit != gotExit {
		var w, g struct {
			Tag     string            `json:"_tag"`
			Value   json.RawMessage   `json:"value"`
			Reasons []json.RawMessage `json:"reasons"`
		}
		_ = json.Unmarshal([]byte(wantExit), &w)
		_ = json.Unmarshal([]byte(gotExit), &g)
		tags := func(reasons []json.RawMessage) []string {
			var out []string
			for _, r := range reasons {
				var reason struct {
					Tag string `json:"_tag"`
				}
				_ = json.Unmarshal(r, &reason)
				out = append(out, reason.Tag)
			}
			return out
		}
		aspect := "payload"
		switch {
		case w.Tag != g.Tag:
			aspect = "exit-tag"
		case w.Tag == "Success":
			aspect = "value"
		case len(w.Reasons) != len(g.Reasons):
			aspect = "reasons"
		case !slices.Equal(tags(w.Reasons), tags(g.Reasons)):
			aspect = "reason-tags"
		}
		return aspect, fmt.Sprintf("want Exit %s\ngot  Exit %s", wantExit, gotExit)
	}
	if !slices.Equal(want.Events, got.Events) {
		return "events", fmt.Sprintf("want events %q\ngot  events %q", want.Events, got.Events)
	}
	// Last, so that a known gap in when a plain main runs its body never
	// hides a disagreement in what it ends with.
	if !slices.Equal(want.Called, got.Called) {
		return "called", fmt.Sprintf("calling main() logged %q, want %q", got.Called, want.Called)
	}
	return "", ""
}

// installVIPEvents installs testdata/vip as the package vip-events in the
// workspace's node_modules, where both prints of a program and the worker
// resolve the same module, so the worker reads the log the program wrote.
func installVIPEvents(w *Workspace) error {
	target := filepath.Join(w.Dir, "node_modules", "vip-events")
	if _, err := os.Stat(target); err == nil {
		return nil
	}
	return os.CopyFS(target, os.DirFS(filepath.Join(repoTestdata(), "vip")))
}
