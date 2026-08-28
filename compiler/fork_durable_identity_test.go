package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

// Durable failure identity, measured through the pinned fork's own durable
// lowering, prelude, and emitted JavaScript.
//
// specification/failures.mdx, "Error Classes": the compiler MUST provide
// "stable nominal identity, matching metadata, serialization evidence, and
// cross-realm transport metadata"; and "Error Prototype": "Handler selection
// MUST use compiler-stable nominal identity, not a forgeable user `_tag` or
// minifier-sensitive constructor name in compiled artifacts." Read on the
// durable persistence boundary, stability is worth nothing without INJECTIVITY:
// two Error classes arriving under one identity is a forgeable key by any other
// name, because the decoder on the far side selects a handler by that string.
//
// A durable failure identity is a function of (logical source file, class name)
// alone, and the CONTRACT spelling the reference mints —
// `smithers:<file>#<name>@1`, normalized — rewrites its own `#` separator to
// `_`, so it is not injective over class declarations. Two spellings of that
// reach authored `.sm`: two same-named classes in one module, which this bridge
// already refuses module-wide and earlier as SMITHERS1150, and two DIFFERENT
// names that normalize together. `$Failed` and `_Failed` are the smallest such
// pair. The reference refuses the second family at contract-derivation time and
// its durable source compiler surfaces the refusal as SMITHERS4124 against the
// authored `run` call site; before this test existed the fork compiled that
// program clean and ran it.
//
// Nothing here is asserted from emitted text alone where execution can speak:
// the defect's defining property is that the program COMPILES, so a
// diagnostics-only test would have passed against the broken bridge.

const durableCollidingIdentitySource = `import { durable, Action } from "smithers:flows"

class $Failed extends Error {
    constructor(readonly code: string) { super("dollar " + code) }
}

class _Failed extends Error {
    constructor(readonly reason: string) { super("under " + reason) }
}

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $Failed | _Failed>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`

const durableDistinctIdentitySource = `import { durable, Action } from "smithers:flows"

export class NotFound extends Error {
    constructor(readonly path: string) { super("missing " + path) }
}

export class Denied extends Error {
    constructor(readonly who: string) { super("denied " + who) }
}

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, NotFound | Denied>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`

// TestPinnedForkDurableFailureChannelRefusesACollidingIdentity is the refusal
// half. The code, the position, AND the sentence are the reference's, not this
// bridge's invention: the reference reports SMITHERS4124 against the authored
// `Pick.run(...)` call, because its `deriveSameFileActions` cannot derive the
// declaration's contract and carries the collision's reason out to that call.
//
// Both backends used to answer SMITHERS4112, "higher-order and dynamic calls
// are unavailable in durable source lowering". The verdict was right and the
// stated reason was false of the program: there is no higher-order call and no
// dynamic call in it, and `Pick.run({ key: input.key })` is an ordinary
// compiler-bound Action call. The reference reached that sentence only by
// falling through the generic tail of `lowerExpression`, and this bridge
// reproduced it verbatim to hold backend agreement, so the misdescription lived
// in two places. The position is unchanged; the code and the sentence now name
// the real defect.
func TestPinnedForkDurableFailureChannelRefusesACollidingIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	result := compileDurableWith(t, backend, ctx, durableCollidingIdentitySource)
	reported := requireDurableDiagnostic(t, result, "SMITHERS4124", strings.Index(durableCollidingIdentitySource, "Pick.run("))
	if len(result.Artifacts) != 0 {
		t.Fatalf("a refused durable contract must emit nothing: %v", artifactPaths(result.Artifacts))
	}
	// The payload is the promise. A code alone would let this bridge keep
	// emitting the old sentence under a new number, which is the renumbering
	// accident the code exists to avoid — so both class names are asserted.
	for _, want := range []string{
		"Error classes $Failed and _Failed",
		"share one durable failure identity",
		"cannot be told apart on the wire",
	} {
		if !strings.Contains(reported.Message, want) {
			t.Fatalf("SMITHERS4124 message = %q, want it to contain %q", reported.Message, want)
		}
	}
	// The sentence it replaced must be gone, not merely joined.
	if strings.Contains(reported.Message, "higher-order") || strings.Contains(reported.Message, "dynamic calls") {
		t.Fatalf("SMITHERS4124 still carries the swallow artifact's sentence: %q", reported.Message)
	}
	// Exactly one diagnostic: the two class declarations are not duplicates by
	// NAME, so SMITHERS1150 does not and must not fire here — this family is
	// invisible to a name-based rule, which is why it survived until now.
	observed := formatDiagnosticPositions(t, []SourceFile{{Path: "main.sm", Text: durableCollidingIdentitySource}}, result)
	if len(observed) != 1 || !strings.HasPrefix(observed[0], "SMITHERS4124@") {
		t.Fatalf("colliding failure channel diagnostics = %v, want exactly one SMITHERS4124", observed)
	}

	// The collision is a property of the CHANNEL, not of the spelling: each
	// class on its own is an ordinary nominal failure and must still compile.
	for _, only := range []string{"$Failed", "_Failed"} {
		source := strings.Replace(durableCollidingIdentitySource, "$Failed | _Failed", only, 1)
		single := compileDurableWith(t, backend, ctx, source)
		if single.EmitSkipped || len(single.Diagnostics) != 0 {
			encoded, _ := json.Marshal(single.Diagnostics)
			t.Fatalf("%s alone must still compile: %s", only, encoded)
		}
	}
}

// TestPinnedForkDurableFailureIdentityBoundMatchesTheReference pins the two
// sides of the length bound, and the over-long half is the assertion that fails
// if the digest fallback is ever dropped from the port.
//
// The reference switches to `smithers:error/<48 hex of digest(file,name)>@1`
// once the normalized identity is over 256 UTF-16 units, and that digest is
// injective — so a pair that WOULD normalize together is accepted when it is
// long enough, and refused when it is not. A port that compared only the
// normalized spelling would refuse both and would be a one-sided over-refusal
// on a program the reference compiles.
func TestPinnedForkDurableFailureIdentityBoundMatchesTheReference(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	channel := func(suffix string) string {
		return `import { durable, Action } from "smithers:flows"

class $` + suffix + ` extends Error {
    constructor(readonly code: string) { super("dollar " + code) }
}

class _` + suffix + ` extends Error {
    constructor(readonly reason: string) { super("under " + reason) }
}

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, $` + suffix + ` | _` + suffix + `>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`
	}

	// Under the bound: the normalized spellings are equal, so both classes claim
	// one identity and the channel is refused.
	short := channel(strings.Repeat("S", 40))
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, short), "SMITHERS4124", strings.Index(short, "Pick.run("))

	// Over the bound: the reference mints two different digests, so the channel
	// is injective and compiles. `smithers:` + `main.sm` + `#` + 261 + `@1` is
	// 279 units, comfortably past 256.
	long := channel(strings.Repeat("L", 260))
	accepted := compileDurableWith(t, backend, ctx, long)
	if accepted.EmitSkipped || len(accepted.Diagnostics) != 0 {
		encoded, _ := json.Marshal(accepted.Diagnostics)
		t.Fatalf("an over-long identity pair falls back to an injective digest and must compile: %s", encoded)
	}
}

// TestPinnedForkDurableDeclaredFailuresStillArrive is the other direction, and
// it is proven by EXECUTION rather than by diagnostics.
//
// An accepted two-failure durable contract must still lower to a real Plan the
// reference's own artifact rules accept, and each declared Error class must
// still reach a wire under its own compiler-minted identity and decode back to
// its own class and only its own class. That is the whole failure path: mint,
// serialize, cross a realm, select a handler by identity.
func TestPinnedForkDurableDeclaredFailuresStillArrive(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	result := compileDurableWith(t, backend, ctx, durableDistinctIdentitySource)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("a channel with two distinct identities must compile: %s", encoded)
	}

	// The Plan really was produced, and the reference's PlanArtifact validator
	// accepts it: this bridge's durable output is live input to the reference's
	// durable runtime, which is the implementation that mints the CONTRACT
	// identity. That is why a colliding channel accepted here is a fail-open
	// even though this bridge's own runtime spelling is injective.
	var plan struct {
		Digest  string `json:"digest"`
		FlowID  string `json:"flowId"`
		Actions []struct {
			ID string `json:"id"`
		} `json:"actions"`
	}
	if err := json.Unmarshal([]byte(runComptimeProgram(t, result)), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.FlowID != "main.sm#Build" || len(plan.Actions) != 1 || plan.Actions[0].ID != "main.sm#Pick" {
		t.Fatalf("unexpected durable Plan identity: %#v", plan)
	}
	if validated := validateWithReferenceArtifactRules(t, result); validated != plan.Digest {
		t.Fatalf("reference artifact validation returned %q, want %q", validated, plan.Digest)
	}

	// Both declared failures, executed: minted, encoded to the persisted
	// envelope, and decoded back in the emitted program's own runtime.
	directory := stageEmitted(t, result.Artifacts)
	observed := runRealm(t, directory, "failures.mjs", `import { smithersEncodeError, smithersDecodeError, smithersErrorIdentity } from "./__smithers_prelude.js";
import { NotFound, Denied } from "./main.js";
const missing = new NotFound("/tmp/x");
const denied = new Denied("root");
const missingWire = smithersEncodeError(missing);
const deniedWire = smithersEncodeError(denied);
const backMissing = smithersDecodeError(missingWire);
const backDenied = smithersDecodeError(deniedWire);
console.log(JSON.stringify({
  missingIdentity: smithersErrorIdentity(missing),
  deniedIdentity: smithersErrorIdentity(denied),
  distinct: smithersErrorIdentity(missing) !== smithersErrorIdentity(denied),
  missingWire,
  deniedWire,
  missingIsMissing: backMissing instanceof NotFound,
  missingIsDenied: backMissing instanceof Denied,
  deniedIsDenied: backDenied instanceof Denied,
  deniedIsMissing: backDenied instanceof NotFound,
  missingPath: backMissing.path,
  deniedWho: backDenied.who,
}));
`, "")
	expectString(t, observed, "missingIdentity", "smithers:main.sm:NotFound")
	expectString(t, observed, "deniedIdentity", "smithers:main.sm:Denied")
	expectBool(t, observed, "distinct", true)
	expectString(t, observed, "missingWire", `{"version":1,"identity":"smithers:main.sm:NotFound","payload":{"message":"missing /tmp/x","path":"/tmp/x"}}`)
	expectString(t, observed, "deniedWire", `{"version":1,"identity":"smithers:main.sm:Denied","payload":{"message":"denied root","who":"root"}}`)
	expectBool(t, observed, "missingIsMissing", true)
	expectBool(t, observed, "missingIsDenied", false)
	expectBool(t, observed, "deniedIsDenied", true)
	expectBool(t, observed, "deniedIsMissing", false)
	expectString(t, observed, "missingPath", "/tmp/x")
	expectString(t, observed, "deniedWho", "root")
}

// TestPinnedForkDurableSameNamedFailuresInTwoModulesStayDistinct is the
// permissive direction of the module half of the rule. Row identity is
// module-qualified, so the same class name in two modules is fine and must
// stay fine — a guard that keyed on the class NAME alone, or that pooled
// identities across a project rather than across one failure channel, would
// break this.
func TestPinnedForkDurableSameNamedFailuresInTwoModulesStayDistinct(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	main := `import { durable, Action } from "smithers:flows"
import { Failed as PaymentsFailed } from "./payments.sm"

export class Failed extends Error {
    constructor(readonly code: string) { super("main " + code) }
}

export { PaymentsFailed }

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, Failed>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`
	payments := `export class Failed extends Error {
    constructor(readonly code: string) { super("payments " + code) }
}
`
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm", "payments.sm"},
		Files: []SourceFile{
			{Path: "main.sm", Kind: FileKindSmithers, Text: main},
			{Path: "payments.sm", Kind: FileKindSmithers, Text: payments},
		},
		Options:  Options{"noEmitOnError": true},
		Lowering: LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("two modules each declaring Failed must compile: %s", encoded)
	}

	directory := stageEmitted(t, result.Artifacts)
	observed := runRealm(t, directory, "modules.mjs", `import { smithersEncodeError, smithersErrorIdentity } from "./__smithers_prelude.js";
import { Failed, PaymentsFailed } from "./main.js";
const local = new Failed("a");
const remote = new PaymentsFailed("b");
console.log(JSON.stringify({
  localIdentity: smithersErrorIdentity(local),
  remoteIdentity: smithersErrorIdentity(remote),
  distinct: smithersErrorIdentity(local) !== smithersErrorIdentity(remote),
  localWire: smithersEncodeError(local),
  remoteWire: smithersEncodeError(remote),
}));
`, "")
	expectString(t, observed, "localIdentity", "smithers:main.sm:Failed")
	expectString(t, observed, "remoteIdentity", "smithers:payments.sm:Failed")
	expectBool(t, observed, "distinct", true)
}

// TestPinnedForkDurableOneClassReachedTwiceIsNotACollision is the
// over-correction guard. The rule is "two DIFFERENT class declarations claim one
// identity", so every way of naming ONE class twice in a failure channel must
// still compile. A guard keyed on the identity string alone rather than on the
// declaration would refuse these.
func TestPinnedForkDurableOneClassReachedTwiceIsNotACollision(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	benign := []struct {
		name    string
		declare string
		channel string
	}{
		{"the same class twice in one union", "", "Failed | Failed"},
		{"a class and a type alias of it", "type Alias = Failed\n", "Failed | Alias"},
		{"the built-in Error as the whole channel", "", "Error"},
		{"two differently named classes", "", "Failed | Other"},
		{"a fieldless failure beside a nominal one", "class Bare extends Error {}\n", "Failed | Bare"},
	}
	for _, item := range benign {
		source := `import { durable, Action } from "smithers:flows"

class Failed extends Error {
    constructor(readonly code: string) { super("failed " + code) }
}

class Other extends Error {
    constructor(readonly why: string) { super("other " + why) }
}

` + item.declare + `
class Pick extends Action<(input: { key: string }) => Result<{ value: string }, ` + item.channel + `>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`
		result := compileDurableWith(t, backend, ctx, source)
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			encoded, _ := json.Marshal(result.Diagnostics)
			t.Fatalf("%s must still compile: %s", item.name, encoded)
		}
	}
}
