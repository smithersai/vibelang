package compiler

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
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

namespace Left {
    export class Failed extends Error {
        constructor(readonly code: string) { super("left " + code) }
    }
}

namespace Right {
    export class Failed extends Error {
        constructor(readonly reason: string) { super("right " + reason) }
    }
}

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, Left.Failed | Right.Failed>> {}

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
		"Error classes Failed and Failed",
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
	// SMITHERS1150 fires here TOO, and that is not this rule failing — it is the
	// bridge's module-wide RUNTIME identity claim seeing the same two
	// declarations first. `stableErrorIdentity` is also a function of (file,
	// class name), so sibling namespaces duplicate the runtime identity as well
	// as the contract one, and the fork refuses that module-wide. The reference
	// has no module-wide equivalent and reports SMITHERS4124 alone. That is a
	// pre-existing both-closed difference in REASONING, not a fail-open, and it
	// is exactly why the corpus does not pin this family: `17-durable/…-are-…`
	// was retired to an acceptance case rather than re-pointed at namespaces.
	//
	// What is asserted is what this test is for: the durable guard is LIVE, not
	// dead code shadowed by the earlier rule.
	observed := formatDiagnosticPositions(t, []SourceFile{{Path: "main.sm", Text: durableCollidingIdentitySource}}, result)
	durableRefusals := 0
	for _, item := range observed {
		if strings.HasPrefix(item, "SMITHERS4124@") {
			durableRefusals++
		}
	}
	if durableRefusals != 1 {
		t.Fatalf("colliding failure channel diagnostics = %v, want exactly one SMITHERS4124", observed)
	}

	// The pair that used to reach this refusal through the IDENTITY rather than
	// through the name, `$Failed | _Failed`, must now compile: the fold that made
	// them one identity is gone. This is the fork's own half of the red-before
	// evidence — before 2026-08-28 this program was refused here with
	// `smithers:main.sm__Failed@1` named in the message.
	rescued := strings.ReplaceAll(durableCollidingIdentitySource, "Left.Failed | Right.Failed", "$Failed | _Failed")
	rescued = strings.Replace(rescued, `namespace Left {
    export class Failed extends Error {
        constructor(readonly code: string) { super("left " + code) }
    }
}

namespace Right {
    export class Failed extends Error {
        constructor(readonly reason: string) { super("right " + reason) }
    }
}`, `class $Failed extends Error {
    constructor(readonly code: string) { super("dollar " + code) }
}

class _Failed extends Error {
    constructor(readonly reason: string) { super("under " + reason) }
}`, 1)
	accepted := compileDurableWith(t, backend, ctx, rescued)
	if accepted.EmitSkipped || len(accepted.Diagnostics) != 0 {
		encoded, _ := json.Marshal(accepted.Diagnostics)
		t.Fatalf("names that only USED to normalize together must compile: %s", encoded)
	}
	identities := durableFailureIdentitiesByClass(t, runComptimeProgram(t, accepted))
	if identities["$Failed"] != "smithers:main.sm@+0024Failed@1" || identities["_Failed"] != "smithers:main.sm@_Failed@1" {
		t.Fatalf("rescued pair minted %v", identities)
	}
}

// TestPinnedForkDurableFailureIdentityBoundMatchesTheReference pins both sides
// of the length bound, and it is the assertion that fails if the digest fallback
// is ever dropped from the port or is made to truncate again.
//
// Until 2026-08-28 the bound was honoured by keeping a 48-hex-digit (192-bit)
// prefix of a digest of the PAIR, under a `smithers:error/...@1` spelling. It is
// now the full SHA-256 of the exact spelling, under `smithers.digest:...@1`, and
// the spelling is already injective over (file, class name) so the fallback
// inherits that.
//
// The half that matters is the DISCRIMINATOR surviving the bound: two class
// names long enough to push the identity over 256 units, differing only in their
// last character, must still mint two different identities. A port that cut the
// spelling instead of hashing it would fold them together, compile clean, and
// emit an artifact whose two failure variants cannot be told apart.
func TestPinnedForkDurableFailureIdentityBoundMatchesTheReference(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)

	// `smithers:` + `main.sm` + `@` + 261 + `@1` is 279 units, comfortably past
	// the 256-unit bound, so both of these take the digest fallback.
	longLeft := strings.Repeat("L", 260) + "A"
	longRight := strings.Repeat("L", 260) + "B"
	source := `import { durable, Action } from "smithers:flows"

class ` + longLeft + ` extends Error {
    constructor(readonly code: string) { super("left " + code) }
}

class ` + longRight + ` extends Error {
    constructor(readonly reason: string) { super("right " + reason) }
}

class Pick extends Action<(input: { key: string }) => Result<{ value: string }, ` + longLeft + ` | ` + longRight + `>> {}

export const Build = durable((input: { key: string }) => {
    return Pick.run({ key: input.key })
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`
	accepted := compileDurableWith(t, backend, ctx, source)
	if accepted.EmitSkipped || len(accepted.Diagnostics) != 0 {
		encoded, _ := json.Marshal(accepted.Diagnostics)
		t.Fatalf("two over-long class names are injective under the digest fallback and must compile: %s", encoded)
	}
	identities := durablePlanFailureIdentities(t, runComptimeProgram(t, accepted))
	if len(identities) != 2 {
		t.Fatalf("expected two failure identities, got %v", identities)
	}
	for _, identity := range identities {
		if !strings.HasPrefix(identity, "smithers.digest:") || !strings.HasSuffix(identity, "@1") {
			t.Fatalf("an over-bound identity must take the digest fallback, got %q", identity)
		}
	}
	if identities[0] == identities[1] {
		t.Fatalf("the bound folded two class names onto one identity: %q", identities[0])
	}

	// The residual is length-independent: two DIFFERENT declarations sharing
	// (file, class name) collide under any injective encoding, so making the
	// names long must not turn the refusal into an acceptance.
	long := strings.ReplaceAll(durableCollidingIdentitySource, "Failed", "Failed"+strings.Repeat("Z", 260))
	requireDurableDiagnostic(t, compileDurableWith(t, backend, ctx, long), "SMITHERS4124", strings.Index(long, "Pick.run("))
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

// ---------------------------------------------------------------------------
// The shared cross-language vectors, through the fork
// ---------------------------------------------------------------------------

// durableIdentityVector is one row of
// conformance/identity/durable-failure-identity.json.
type durableIdentityVector struct {
	Why       string `json:"why"`
	File      string `json:"file"`
	ClassName string `json:"className"`
	ViaFork   bool   `json:"viaFork"`
	Identity  string `json:"identity"`
}

func loadDurableIdentityVectors(t *testing.T) []durableIdentityVector {
	t.Helper()
	text, err := os.ReadFile("../conformance/identity/durable-failure-identity.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Vectors []durableIdentityVector `json:"vectors"`
	}
	if err := json.Unmarshal(text, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Vectors) == 0 {
		t.Fatal("the shared durable identity corpus is empty")
	}
	return corpus.Vectors
}

// durableFailureIdentitiesByClass walks an emitted Plan's JSON and answers every
// nominal failure variant it carries, keyed by the class's own name.
//
// Keyed rather than ordered on purpose: author-controlled strings may only be
// ordered by sortUTF16 (see fork_utf16_order_test.go), which lives inside the
// bridge and is not linked into this package, so nothing here sorts.
func durableFailureIdentitiesByClass(t *testing.T, planJSON string) map[string]string {
	t.Helper()
	var plan any
	if err := json.Unmarshal([]byte(planJSON), &plan); err != nil {
		t.Fatalf("undecodable Plan: %v", err)
	}
	found := map[string]string{}
	var walk func(node any)
	walk = func(node any) {
		switch value := node.(type) {
		case map[string]any:
			if kind, _ := value["kind"].(string); kind == "error" {
				identity, hasIdentity := value["identity"].(string)
				name, hasName := value["name"].(string)
				if hasIdentity && hasName {
					if prior, seen := found[name]; seen && prior != identity {
						t.Fatalf("class %s carries two identities: %q and %q", name, prior, identity)
					}
					found[name] = identity
				}
			}
			for _, child := range value {
				walk(child)
			}
		case []any:
			for _, child := range value {
				walk(child)
			}
		}
	}
	walk(plan)
	return found
}

// durablePlanFailureIdentities is the unkeyed view of the same walk, for the
// bound test, where the two class names are the thing under test.
func durablePlanFailureIdentities(t *testing.T, planJSON string) []string {
	t.Helper()
	identities := []string{}
	for _, identity := range durableFailureIdentitiesByClass(t, planJSON) {
		identities = append(identities, identity)
	}
	return identities
}

// The fork mints exactly the durable failure identities the reference does,
// measured by compiling each vector's file name and class name and reading the
// identity back out of the emitted Plan.
//
// This is the one test that stops the two implementations drifting. It is not a
// re-derivation of the algorithm in Go test code — that would be a THIRD copy —
// it is the fork's own output compared against a corpus the reference is checked
// against by poc/src/durable/durable-failure-identity.test.ts.
//
// WHY IT CANNOT BE A DIFFERENTIAL. Both backends spelled this identity the same
// wrong way, so every cross-backend comparison in the tree agreed, byte for byte,
// on the colliding answer; the conformance runner reported `0 divergent` on the
// case that exercises this very channel. Only a direct assertion against a stated
// expectation can see a defect both copies share, which is what the corpus rows
// are.
func TestPinnedForkDurableFailureIdentityMatchesTheSharedVectors(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	vectors := loadDurableIdentityVectors(t)

	// Vectors sharing one file name are compiled together, because they describe
	// several classes in one module.
	classesByFile := map[string][]durableIdentityVector{}
	order := []string{}
	skipped := 0
	for _, vector := range vectors {
		if !vector.ViaFork {
			// virtualFileName fail-closes on these names, so they are unreachable
			// input here rather than an exemption from agreement. The reference
			// still pins them.
			skipped++
			continue
		}
		if _, seen := classesByFile[vector.File]; !seen {
			order = append(order, vector.File)
		}
		classesByFile[vector.File] = append(classesByFile[vector.File], vector)
	}
	// Four rows are unreachable input: two whose file name holds a colon or is
	// empty (virtualFileName fail-closes) and two whose file name has no `.sm`
	// extension (the bridge protocol refuses the kind). They still pin the
	// algorithm on the reference. The ceiling is here so that a fifth cannot be
	// added quietly and turn agreement into a smaller and smaller claim.
	if skipped > 4 {
		t.Fatalf("%d vectors are unreachable through the fork; the corpus is drifting out of the fork's reach", skipped)
	}
	// `order` is corpus order, which is already deterministic. Nothing here sorts.

	exercised := 0
	for _, file := range order {
		group := classesByFile[file]
		declarations := ""
		channel := ""
		for index, vector := range group {
			declarations += "class " + vector.ClassName +
				" extends Error {\n    constructor(readonly code: string) { super(\"x \" + code) }\n}\n\n"
			if index > 0 {
				channel += " | "
			}
			channel += vector.ClassName
		}
		source := "import { durable, Action } from \"smithers:flows\"\n\n" + declarations +
			"class Pick extends Action<(input: { key: string }) => Result<{ value: string }, " + channel + ">> {}\n\n" +
			"export const Build = durable((input: { key: string }) => {\n    return Pick.run({ key: input.key })\n})\n\n" +
			"export function main(): string {\n    return JSON.stringify(Build.plan)\n}\n"

		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{file},
			Files:     []SourceFile{{Path: file, Kind: FileKindSmithers, Text: source}},
			Options:   Options{"noEmitOnError": true},
			Lowering:  LoweringInternal,
		})
		if err != nil {
			t.Fatal(err)
		}
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			encoded, _ := json.Marshal(result.Diagnostics)
			t.Fatalf("%q must compile clean: %s", file, encoded)
		}
		identities := durableFailureIdentitiesByClass(t, runComptimeProgramNamed(t, result, file))
		for _, vector := range group {
			got, present := identities[vector.ClassName]
			if !present {
				t.Fatalf("%s\n file %q declared no identity for class %q; saw %v", vector.Why, file, vector.ClassName, identities)
			}
			if got != vector.Identity {
				t.Fatalf("%s\n file %q class %q\n  fork      = %q\n  reference = %q",
					vector.Why, file, vector.ClassName, got, vector.Identity)
			}
			exercised++
		}
	}
	if exercised != len(vectors)-skipped {
		t.Fatalf("exercised %d of %d reachable vectors", exercised, len(vectors)-skipped)
	}
}

// runComptimeProgramNamed is runComptimeProgram for a project whose entry module
// is not `main.sm`.
//
// The vector corpus is a corpus of FILE NAMES, so the entry cannot be renamed to
// something convenient without deleting the thing under test. The import
// specifier is JSON-encoded because these names deliberately contain spaces, a
// `#`, and a non-BMP character.
func runComptimeProgramNamed(t *testing.T, result CompileResult, sourceName string) string {
	t.Helper()
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node is required to execute the emitted JavaScript")
	}
	directory := t.TempDir()
	for _, item := range result.Artifacts {
		path := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, "package.json"), []byte(`{"type":"module"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	// pathToFileURL, not a bare specifier: these names deliberately contain a
	// space, a `#`, and a non-BMP character, and a `#` in an ESM specifier is a
	// URL fragment rather than part of the path. The absolute path is handed to
	// node as JSON and encoded there, so no escaping rule is reimplemented here.
	entry, err := json.Marshal(filepath.Join(directory, filepath.FromSlash(strings.TrimSuffix(sourceName, ".sm")+".js")))
	if err != nil {
		t.Fatal(err)
	}
	harness := "import { pathToFileURL } from \"node:url\";\n" +
		"const module = await import(pathToFileURL(" + string(entry) + ").href);\n" +
		"process.stdout.write(String(module.main()));\n"
	if err := os.WriteFile(filepath.Join(directory, "harness.mjs"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(node, "harness.mjs")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("executing the emitted JavaScript failed: %v\n%s", err, output)
	}
	return string(output)
}
