package compiler

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// Step 5 of the continuation migration, on the Go side: the Effect Manifest
// cross-check.
//
// The migration plan's own words for this step: "This validates the entire
// hybrid against a working system before anything is deleted." `PR-1` — build
// the Manifest — was adopted provisionally on the owner's behalf, and the
// Manifest is what buys back the signable pre-execution artifact and about half
// of static version-divergence detection. If it cannot reproduce what the Plan
// knows, that has to surface while the Plan still exists to disagree with it.
//
// The pinned fork emits both artifacts when a request sets
// `smithersEffectManifest`. The Manifest is derived by `effectmanifest.go` from
// the authored function; the Plan by `durable.go`'s lowerer. Neither reads the
// other. This test reads both back and compares the action set, the capability
// set, and the contract set over every `17-durable` conformance case.

const effectManifestCorpus = "../conformance/corpus/17-durable"

type forkManifest struct {
	ManifestVersion int      `json:"manifestVersion"`
	FlowID          string   `json:"flowId"`
	FlowVersion     int      `json:"flowVersion"`
	Requirements    []string `json:"requirements"`
	Failures        []string `json:"failures"`
	Digest          string   `json:"digest"`
	Error           string   `json:"error"`
	Actions         []struct {
		ID             string `json:"id"`
		Version        int    `json:"version"`
		ContractDigest string `json:"contractDigest"`
	} `json:"actions"`
	Contracts []struct {
		Kind           string `json:"kind"`
		Identity       string `json:"identity"`
		ContractDigest string `json:"contractDigest"`
	} `json:"contracts"`
	Sites []struct {
		ID     string `json:"id"`
		Kind   string `json:"kind"`
		Anchor string `json:"anchor"`
		Key    string `json:"key"`
	} `json:"sites"`
}

type forkPlanNode struct {
	Kind                 string        `json:"kind"`
	SignalID             string        `json:"signalId"`
	SignalContractDigest string        `json:"signalContractDigest"`
	Delivery             string        `json:"delivery"`
	WhenTrue             *forkPlanFrag `json:"whenTrue"`
	WhenFalse            *forkPlanFrag `json:"whenFalse"`
}

type forkPlanFrag struct {
	Nodes []forkPlanNode `json:"nodes"`
}

type forkPlan struct {
	FlowID       string   `json:"flowId"`
	FlowVersion  int      `json:"flowVersion"`
	Digest       string   `json:"digest"`
	Requirements []string `json:"requirements"`
	Actions      []struct {
		ID             string `json:"id"`
		Version        int    `json:"version"`
		ContractDigest string `json:"contractDigest"`
	} `json:"actions"`
	Nodes []forkPlanNode `json:"nodes"`
}

func forkPlanContracts(nodes []forkPlanNode, into map[string]bool) {
	for _, node := range nodes {
		switch node.Kind {
		case "signal":
			kind := "signal"
			if node.Delivery == "broadcast" {
				kind = "broadcast"
			}
			into[kind+":"+node.SignalID+"#"+node.SignalContractDigest] = true
		case "branch":
			if node.WhenTrue != nil {
				forkPlanContracts(node.WhenTrue.Nodes, into)
			}
			if node.WhenFalse != nil {
				forkPlanContracts(node.WhenFalse.Nodes, into)
			}
		}
	}
}

func sortedKeys(set map[string]bool) []string {
	out := make([]string, 0, len(set))
	for key := range set {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func TestPinnedForkEffectManifestAgreesWithThePlan(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	entries, err := os.ReadDir(effectManifestCorpus)
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".sm") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	if len(names) == 0 {
		t.Fatal("no 17-durable corpus cases were found")
	}

	compared := 0
	comparedNames := []string{}
	skipped := []string{}
	for _, name := range names {
		text, err := os.ReadFile(filepath.Join(effectManifestCorpus, name))
		if err != nil {
			t.Fatal(err)
		}
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{name},
			Files:     []SourceFile{{Path: name, Kind: FileKindSmithers, Text: string(text)}},
			Options:   Options{"noEmitOnError": true, "smithersEffectManifest": true},
			Lowering:  LoweringInternal,
		})
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		texts := artifactTextsByPath(t, result.Artifacts)
		planText, hasPlan := texts[name+".plan.json"]
		manifestText, hasManifest := texts[name+".effect-manifest.json"]
		if hasPlan != hasManifest {
			t.Fatalf("%s: the Plan and the Manifest must be emitted together, got plan=%v manifest=%v",
				name, hasPlan, hasManifest)
		}
		if !hasPlan {
			// The durable lowering refused this program, or the program has no
			// compiler-owned `durable(...)` in it at all, so there is no Plan to
			// compare against. That is the majority of this corpus: it is a
			// refusal corpus, and step 11 is what turns most of these rows into
			// programs that run.
			//
			// The one thing that must never happen is a Plan reaching the
			// emitted module without a Manifest beside it — that would be the
			// Manifest silently skipping a Flow.
			// Only this case's own module; the compiler-owned prelude names the
			// marker in a type it declares.
			emittedModule := strings.TrimSuffix(name, ".sm") + ".js"
			if strings.Contains(texts[emittedModule], "static-plan-artifact") {
				t.Fatalf("%s: %s carries a lowered Plan but no Effect Manifest was emitted", name, emittedModule)
			}
			skipped = append(skipped, name)
			continue
		}

		var manifest forkManifest
		if err := json.Unmarshal([]byte(manifestText), &manifest); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if manifest.Error != "" {
			t.Fatalf("%s: the Plan lowered but the Manifest could not be stated: %s", name, manifest.Error)
		}
		var plan forkPlan
		if err := json.Unmarshal([]byte(planText), &plan); err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		if manifest.ManifestVersion != 1 || manifest.FlowID != plan.FlowID || manifest.FlowVersion != plan.FlowVersion {
			t.Fatalf("%s: Manifest identity %d/%q/%d does not match the Plan's %q/%d",
				name, manifest.ManifestVersion, manifest.FlowID, manifest.FlowVersion, plan.FlowID, plan.FlowVersion)
		}
		if len(manifest.Digest) != 64 {
			t.Fatalf("%s: Manifest digest %q is not a sha256", name, manifest.Digest)
		}

		planActions := map[string]bool{}
		for _, action := range plan.Actions {
			planActions[action.ID+"@"+strconv.Itoa(action.Version)+"#"+action.ContractDigest] = true
		}
		manifestActions := map[string]bool{}
		for _, action := range manifest.Actions {
			manifestActions[action.ID+"@"+strconv.Itoa(action.Version)+"#"+action.ContractDigest] = true
		}
		if got, want := sortedKeys(manifestActions), sortedKeys(planActions); !equalStrings(got, want) {
			t.Fatalf("%s: action set disagrees\n  manifest %v\n  plan     %v", name, got, want)
		}

		planRequirements := append([]string(nil), plan.Requirements...)
		manifestRequirements := append([]string(nil), manifest.Requirements...)
		sort.Strings(planRequirements)
		sort.Strings(manifestRequirements)
		if !equalStrings(manifestRequirements, planRequirements) {
			t.Fatalf("%s: capability set disagrees\n  manifest %v\n  plan     %v",
				name, manifestRequirements, planRequirements)
		}

		planContracts := map[string]bool{}
		forkPlanContracts(plan.Nodes, planContracts)
		manifestContracts := map[string]bool{}
		for _, contract := range manifest.Contracts {
			manifestContracts[contract.Kind+":"+contract.Identity+"#"+contract.ContractDigest] = true
		}
		if got, want := sortedKeys(manifestContracts), sortedKeys(planContracts); !equalStrings(got, want) {
			t.Fatalf("%s: contract set disagrees\n  manifest %v\n  plan     %v", name, got, want)
		}

		// PR-1's discipline, asserted rather than trusted: "no control-flow
		// edges, no branch structure, no execution counts. The moment it
		// acquires an edge, a branch, or a count, it has started growing back
		// into a plan."
		for _, forbidden := range []string{"dependencies", "controlDependencies", "whenTrue", "whenFalse", "nodeId", "\"nodes\""} {
			if strings.Contains(manifestText, forbidden) {
				t.Fatalf("%s: the Manifest carries Plan structure %q:\n%s", name, forbidden, manifestText)
			}
		}
		compared++
		comparedNames = append(comparedNames, name)
	}

	// A cross-check that compared nothing would pass. Six of this corpus's
	// cases lower a Plan on the reference; the fork must reach at least as many
	// as it has ever reached, and never zero.
	if compared < 5 {
		t.Fatalf("only %d of %d 17-durable cases produced both artifacts; the cross-check is near-vacuous",
			compared, len(names))
	}
	t.Logf("Manifest agrees with the Plan on %d of %d 17-durable cases: %s", compared, len(names),
		strings.Join(comparedNames, ", "))
	t.Logf("no Plan to compare against on %d cases (refusals and programs with no compiler-owned durable call): %s",
		len(skipped), strings.Join(skipped, ", "))
}

// TestPinnedForkEffectManifestIsOptIn is the other half of "nothing existing
// may change": with the option absent, not one artifact moves.
func TestPinnedForkEffectManifestIsOptIn(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source, err := os.ReadFile(filepath.Join(effectManifestCorpus, "static-plan-shape-is-digest-pinned.sm"))
	if err != nil {
		t.Fatal(err)
	}
	compile := func(options Options) CompileResult {
		result, err := backend.Compile(ctx, CompileRequest{
			RootNames: []string{"main.sm"},
			Files:     []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: string(source)}},
			Options:   options,
			Lowering:  LoweringInternal,
		})
		if err != nil {
			t.Fatal(err)
		}
		return result
	}
	plain := compile(Options{"noEmitOnError": true})
	withManifest := compile(Options{"noEmitOnError": true, "smithersEffectManifest": true})

	plainTexts := artifactTextsByPath(t, plain.Artifacts)
	manifestTexts := artifactTextsByPath(t, withManifest.Artifacts)
	if len(plainTexts) == 0 {
		t.Fatalf("the control compile emitted nothing: %#v", plain.Diagnostics)
	}
	for path, text := range plainTexts {
		if manifestTexts[path] != text {
			t.Fatalf("asking for the Manifest changed the emitted artifact %q", path)
		}
	}
	if len(manifestTexts) != len(plainTexts)+2 {
		t.Fatalf("expected exactly the Plan and Manifest to be added: %v vs %v",
			artifactPaths(plain.Artifacts), artifactPaths(withManifest.Artifacts))
	}
	for _, path := range artifactPaths(plain.Artifacts) {
		if strings.HasSuffix(path, ".effect-manifest.json") || strings.HasSuffix(path, ".plan.json") {
			t.Fatalf("the Manifest was emitted without being asked for: %v", artifactPaths(plain.Artifacts))
		}
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
