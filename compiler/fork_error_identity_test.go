package compiler

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// Nominal Error identity INJECTIVITY on the Go fork, and the shared vectors that
// keep the fork's copy of the algorithm and the reference frontend's from
// drifting apart again.
//
// specification/failures.mdx, "Error Prototype": "Handler selection MUST use
// compiler-stable nominal identity, not a forgeable user `_tag` or
// minifier-sensitive constructor name in compiled artifacts." An identity two
// distinct classes can share is not an identity, and on this backend the failure
// was a fail-OPEN: the fork compiled the program with zero diagnostics, emitted a
// plausible artifact, and `smithersRegisterError` threw
// `stable Error identity ... is already registered` out of the emitted prelude
// while the module was still loading.
//
// Measured on the fork on 2026-08-28, BEFORE the fix, by compiling and reading
// the emitted `__smithersRegisterError` calls back out:
//
//	"a".repeat(250)+".sm", classes Left and Right
//	  -> __smithersRegisterError(Left,  "smithers:aaa…a")   (256 units)
//	  -> __smithersRegisterError(Right, "smithers:aaa…a")   (the same 256 units)
//	  diagnostics: none
//	files "a b.sm" and "a_b.sm", each declaring Boom
//	  -> __smithersRegisterError(Boom, "smithers:a_b.sm:Boom")  in BOTH
//	  diagnostics: none
//
// So the fork reproduced both mechanisms independently; this was not inferred
// from reading `stableErrorIdentity`. The tests below are written against the
// shape of the mistake: the vector test pins the fork's whole algorithm against
// the reference's through one shared corpus rather than through two separately
// maintained expectations, and the reproduction tests fail on the exact inputs
// that shipped.
//
// Nothing here is asserted from emitted text where execution can speak. The
// defect's defining property is that the program COMPILES, so a diagnostics-only
// test would have passed against the broken bridge; `TestPinnedForkNominal…Load`
// runs the emitted module.

// identityVector is one row of conformance/identity/nominal-error-identity.json.
type identityVector struct {
	Why       string `json:"why"`
	File      string `json:"file"`
	ClassName string `json:"className"`
	ViaFork   bool   `json:"viaFork"`
	Identity  string `json:"identity"`
}

func loadIdentityVectors(t *testing.T) []identityVector {
	t.Helper()
	text, err := os.ReadFile("../conformance/identity/nominal-error-identity.json")
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Vectors []identityVector `json:"vectors"`
	}
	if err := json.Unmarshal(text, &corpus); err != nil {
		t.Fatal(err)
	}
	if len(corpus.Vectors) == 0 {
		t.Fatal("the shared identity corpus is empty")
	}
	return corpus.Vectors
}

// `\w` in Go's regexp is ASCII-only, and an Error class name may be any
// TypeScript identifier — `Café` and `\u{1D401}oom` are both in the corpus — so the
// class is captured as "everything before the comma" instead.
var registerErrorCall = regexp.MustCompile(`__smithersRegisterError\(([^,]+), (".*?[^\\]")\);`)

// emittedIdentities maps class name -> registered identity across every artifact
// of one compilation, decoding the emitted string literal rather than comparing
// escaped text.
func emittedIdentities(t *testing.T, artifacts []Artifact) map[string]string {
	t.Helper()
	found := map[string]string{}
	for _, item := range artifacts {
		if strings.HasSuffix(item.Path, "__smithers_prelude.js") {
			continue
		}
		for _, match := range registerErrorCall.FindAllStringSubmatch(string(item.Content), -1) {
			var identity string
			if err := json.Unmarshal([]byte(match[2]), &identity); err != nil {
				t.Fatalf("undecodable emitted identity %s: %v", match[2], err)
			}
			key := item.Path + "#" + match[1]
			if prior, seen := found[key]; seen {
				t.Fatalf("%s registered twice: %q then %q", key, prior, identity)
			}
			found[key] = identity
		}
	}
	return found
}

// ---------------------------------------------------------------------------
// The shared cross-language vectors, through the fork
// ---------------------------------------------------------------------------

// The fork mints exactly the identities the reference does, measured by compiling
// each vector's file name and reading the identity back out of the emit.
//
// This is the one test that stops the two implementations drifting. It is not a
// re-derivation of the algorithm in Go test code — that would be a THIRD copy —
// it is the fork's own output compared against a corpus the reference is checked
// against by poc/src/language/nominal-error-identity.test.ts.
func TestPinnedForkNominalErrorIdentityMatchesTheSharedVectors(t *testing.T) {
	vectors := loadIdentityVectors(t)

	// Vectors sharing one file name are compiled together, because they describe
	// two classes in one module.
	classesByFile := map[string][]identityVector{}
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
	if skipped > 2 {
		t.Fatalf("%d vectors are unreachable through the fork; the corpus is drifting out of the fork's reach", skipped)
	}
	// `order` is corpus order, which is already deterministic. Nothing here sorts:
	// author-controlled strings may only be ordered by sortUTF16 (see
	// fork_utf16_order_test.go), which lives inside the bridge and is not linked
	// into this package.

	exercised := 0
	for _, file := range order {
		group := classesByFile[file]
		declarations := make([]string, 0, len(group))
		for _, vector := range group {
			declarations = append(declarations, "export class "+vector.ClassName+" extends Error {}")
		}
		result := compileInternalSource(t, []SourceFile{
			{Path: file, Kind: FileKindSmithers, Text: strings.Join(declarations, "\n") + "\n"},
		})
		if result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("%q must compile clean: %#v", file, result.Diagnostics)
		}
		identities := emittedIdentities(t, result.Artifacts)
		for _, vector := range group {
			got := ""
			for key, identity := range identities {
				if strings.HasSuffix(key, "#"+vector.ClassName) {
					got = identity
				}
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

// ---------------------------------------------------------------------------
// The two reproductions, through the fork
// ---------------------------------------------------------------------------

// Two Error classes in one long-named module, which the bound used to fold onto
// one identity by cutting off the class name that discriminates them.
func TestPinnedForkNominalErrorIdentitySurvivesALongModuleName(t *testing.T) {
	file := strings.Repeat("a", 250) + ".sm"
	result := compileInternalSource(t, []SourceFile{
		{Path: file, Kind: FileKindSmithers, Text: "export class Left extends Error {}\nexport class Right extends Error {}\n"},
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("project must check clean: %#v", result.Diagnostics)
	}
	identities := emittedIdentities(t, result.Artifacts)
	if len(identities) != 2 {
		t.Fatalf("expected two registrations, got %#v", identities)
	}
	distinct := map[string]string{}
	for key, identity := range identities {
		if prior, clash := distinct[identity]; clash {
			t.Fatalf("%s and %s share the identity %q", prior, key, identity)
		}
		distinct[identity] = key
	}
}

// Two module names the normalization used to fold together, each declaring a
// class with one name.
func TestPinnedForkNominalErrorIdentitySeparatesNormalizedModuleNames(t *testing.T) {
	result := compileInternalSource(t, []SourceFile{
		{Path: "a b.sm", Kind: FileKindSmithers, Text: "export class Boom extends Error {}\n"},
		{Path: "a_b.sm", Kind: FileKindSmithers, Text: "export class Boom extends Error {}\n"},
		// The disambiguation prefix was itself many-to-one: `.a.sm` used to mint
		// `smithers:source_.a.sm:Boom`, which is exactly what a module literally
		// named `source_.a.sm` minted.
		{Path: ".c.sm", Kind: FileKindSmithers, Text: "export class Boom extends Error {}\n"},
		{Path: "source_.c.sm", Kind: FileKindSmithers, Text: "export class Boom extends Error {}\n"},
	})
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("project must check clean: %#v", result.Diagnostics)
	}
	identities := emittedIdentities(t, result.Artifacts)
	if len(identities) != 4 {
		t.Fatalf("expected four registrations, got %#v", identities)
	}
	// Compared as a SET, so nothing here has to order author-controlled strings —
	// byte order and UTF-16 order disagree on exactly the inputs this file is full
	// of (see fork_utf16_order_test.go), and sortUTF16 lives inside the bridge.
	want := map[string]bool{
		"smithers:a+0020b.sm:Boom":   true,
		"smithers:a_b.sm:Boom":       true,
		"smithers:+002Ec.sm:Boom":    true,
		"smithers:source_.c.sm:Boom": true,
	}
	for key, identity := range identities {
		if !want[identity] {
			t.Fatalf("%s minted the unexpected identity %q; want one of %v", key, identity, want)
		}
		delete(want, identity)
	}
	if len(want) != 0 {
		t.Fatalf("these identities were never minted: %v", want)
	}
}

// The artifact the fork said was fine must actually load. This is the assertion a
// diagnostics-only test cannot make, and it is the one that was failing.
func TestPinnedForkNominalErrorIdentityArtifactLoads(t *testing.T) {
	// 246 units of module name is the narrow window where this is both a genuine
	// reproduction and stageable. `smithers:` (9) plus 246 plus `:` is exactly the
	// old 256-unit bound, so the previous algorithm cut BOTH class names off
	// entirely and handed Left and Right one identity; and the longest emitted
	// artifact name (`<base>.d.sm.ts`, 251 bytes) still fits the filesystem's
	// 255-byte per-component limit, so the emit can be staged and executed.
	file := strings.Repeat("d", 243) + ".sm"
	result := compileInternalSource(t, []SourceFile{
		{Path: file, Kind: FileKindSmithers, Text: `export class Left extends Error {}
export class Right extends Error {}

export function main(): string[] {
    return [new Left().name, new Right().name];
}
`},
	})
	directory := stageEmitted(t, requireCleanCompileArtifacts(t, result))
	observed := runRealm(t, directory, "load.mjs", `import { smithersErrorIdentity } from "./__smithers_prelude.js";
import { Left, Right } from "./`+strings.Repeat("d", 243)+`.js";
const left = smithersErrorIdentity(new Left());
const right = smithersErrorIdentity(new Right());
console.log(JSON.stringify({ left, right, distinct: left !== right }));
`, "")
	if observed["distinct"] != any(true) {
		t.Fatalf("the two classes did not load under distinct identities: %#v", observed)
	}
}

// ---------------------------------------------------------------------------
// The defensive invariant is present
// ---------------------------------------------------------------------------

// stableErrorIdentity is injective, so SMITHERS1151 cannot fire on today's
// algorithm and no program can be written that trips it. What CAN be asserted
// without a second copy of the algorithm is that the guard is still wired into
// the emit path and still shared across the whole compilation, which is the
// property a later refactor would silently drop.
func TestForkNominalIdentityGuardIsWiredIntoTheCompileWideEmitPath(t *testing.T) {
	source, err := os.ReadFile("forkbridge/lowering.go.txt")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	for _, required := range []string{
		// The claim map is created ONCE per compilation, outside the per-file loop.
		"nominalIdentities := make(map[string]string)",
		"newLowerer(typeChecker, prelude, analysis, comptime, nominalIdentities)",
		// And every nominal Error class passes through it.
		"l.claimNominalErrorIdentity(node, logical, identity)",
		`l.report(node, "SMITHERS1151"`,
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("the compile-wide nominal identity guard lost %q", required)
		}
	}
	// The bound must never be honoured by cutting the identity, and the path must
	// never be folded onto a prefix: those two lines ARE the defect, and either is
	// a one-line regression to reintroduce.
	body := identityFunctionBody(t, text)
	for _, forbidden := range []string{"units[:256]", "source_"} {
		if strings.Contains(body, forbidden) {
			t.Fatalf("stableErrorIdentity reintroduced %q", forbidden)
		}
	}
}

// identityFunctionBody is the text of stableErrorIdentity, comments excluded, so
// the forbidden-token check above reads the code rather than the prose that
// explains why the code no longer does it.
func identityFunctionBody(t *testing.T, text string) string {
	t.Helper()
	start := strings.Index(text, "func stableErrorIdentity(")
	if start < 0 {
		t.Fatal("stableErrorIdentity is gone")
	}
	end := strings.Index(text[start:], "\n}\n")
	if end < 0 {
		t.Fatal("stableErrorIdentity is unterminated")
	}
	body := []string{}
	for _, line := range strings.Split(text[start:start+end], "\n") {
		if trimmed := strings.TrimSpace(line); !strings.HasPrefix(trimmed, "//") {
			body = append(body, line)
		}
	}
	return strings.Join(body, "\n")
}
