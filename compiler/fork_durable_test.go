package compiler

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func compileDurableWith(t *testing.T, backend Compiler, ctx context.Context, source string) CompileResult {
	t.Helper()
	result, err := backend.Compile(ctx, CompileRequest{
		RootNames: []string{"main.sm"},
		Files: []SourceFile{{
			Path: "main.sm",
			Kind: FileKindSmithers,
			Text: source,
		}},
		Options:  Options{"noEmitOnError": true},
		Lowering: LoweringInternal,
	})
	if err != nil {
		t.Fatal(err)
	}
	return result
}

func requireDurableDiagnostic(t *testing.T, result CompileResult, code string, start int) Diagnostic {
	t.Helper()
	for _, item := range result.Diagnostics {
		if item.Code == code {
			if !result.EmitSkipped || item.Phase != PhaseLower || item.File != "main.sm" || item.Span == nil || item.Span.Start != start {
				t.Fatalf("durable diagnostic lost its authored location: %#v", item)
			}
			return item
		}
	}
	t.Fatalf("missing %s in %#v", code, result.Diagnostics)
	return Diagnostic{}
}

func validateWithReferenceArtifactRules(t *testing.T, result CompileResult) string {
	t.Helper()
	bun, err := exec.LookPath("bun")
	if err != nil {
		t.Skip("bun is required to validate the Go Plan with the TypeScript artifact rules")
	}
	directory := t.TempDir()
	for _, item := range result.Artifacts {
		name := filepath.Join(directory, filepath.FromSlash(item.Path))
		if err := os.MkdirAll(filepath.Dir(name), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(name, item.Content, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	validator, err := filepath.Abs("../poc/src/durable/artifact.ts")
	if err != nil {
		t.Fatal(err)
	}
	validatorJSON, _ := json.Marshal(filepath.ToSlash(validator))
	harness := "import { Build } from './main.js';\n" +
		"import { PlanArtifact } from " + string(validatorJSON) + ";\n" +
		"const plan = PlanArtifact.validate(Build.plan);\n" +
		"process.stdout.write(plan.digest);\n"
	if err := os.WriteFile(filepath.Join(directory, "validate.ts"), []byte(harness), 0o644); err != nil {
		t.Fatal(err)
	}
	command := exec.Command(bun, "validate.ts")
	command.Dir = directory
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("reference artifact validation rejected the Go Plan: %v\n%s", err, output)
	}
	return string(output)
}

func TestPinnedForkDurableLowersCheckedASTToAStaticPlan(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import {
    durable as compileFlow,
    Action,
    sequential,
    sleep,
    waitSignal
} from "smithers:flows"

class Lookup extends Action<(input: { key: string }) => Result<{ value: string }, Error>> {}
class Audit extends Action<(input: { value: string }) => Result<{ saved: boolean }, Error>> {}

export const Build = compileFlow((input: { key: string; live: boolean }) => {
    const found = Lookup.run({ key: input.key })!
    const selected = input.live ? found.value : "offline"
    sleep(25)
    const pair = sequential(
        Lookup.run({ key: selected }),
        Audit.run({ value: selected })
    )
    const approval = waitSignal<string>("build.approval")
    return { approval, pair, selected }
})

export function main(): string {
    return JSON.stringify(Build.plan)
}
`
	result := compileDurableWith(t, backend, ctx, source)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		encoded, _ := json.Marshal(result.Diagnostics)
		t.Fatalf("durable program must compile clean: emitSkipped=%v %s", result.EmitSkipped, encoded)
	}
	emitted := mainText(t, result)
	if strings.Contains(emitted, "compileFlow(") || strings.Contains(emitted, "=> {") {
		t.Fatalf("the durable callback must not survive lowering:\n%s", emitted)
	}
	if !strings.Contains(emitted, "static-plan-artifact") || !strings.Contains(emitted, "src-") {
		t.Fatalf("missing static Plan descriptor:\n%s", emitted)
	}

	var plan struct {
		Digest        string `json:"digest"`
		FlowID        string `json:"flowId"`
		FormatVersion int    `json:"formatVersion"`
		Nodes         []struct {
			Kind                string   `json:"kind"`
			ID                  string   `json:"id"`
			Dependencies        []string `json:"dependencies"`
			ControlDependencies []string `json:"controlDependencies"`
		} `json:"nodes"`
		Requirements []string `json:"requirements"`
	}
	if err := json.Unmarshal([]byte(runComptimeProgram(t, result)), &plan); err != nil {
		t.Fatal(err)
	}
	if plan.FlowID != "main.sm#Build" || plan.FormatVersion != 1 || len(plan.Digest) != 64 {
		t.Fatalf("unexpected Plan identity: %#v", plan)
	}
	wantKinds := []string{"action", "branch", "timer", "action", "action", "signal"}
	if len(plan.Nodes) != len(wantKinds) {
		t.Fatalf("Plan node count = %d, want %d: %#v", len(plan.Nodes), len(wantKinds), plan.Nodes)
	}
	for index, kind := range wantKinds {
		if plan.Nodes[index].Kind != kind {
			t.Fatalf("node %d kind = %q, want %q", index, plan.Nodes[index].Kind, kind)
		}
	}
	if len(plan.Nodes[1].ControlDependencies) != 1 || plan.Nodes[1].ControlDependencies[0] != plan.Nodes[0].ID {
		t.Fatalf("postfix propagation did not become the branch control edge: %#v", plan.Nodes[:2])
	}
	if len(plan.Nodes[4].ControlDependencies) != 1 || plan.Nodes[4].ControlDependencies[0] != plan.Nodes[3].ID {
		t.Fatalf("sequential did not pin the second Action: %#v", plan.Nodes[3:5])
	}
	if len(plan.Requirements) != 2 || plan.Requirements[0] >= plan.Requirements[1] {
		t.Fatalf("requirements are not canonical sorted unique ids: %#v", plan.Requirements)
	}
	if validated := validateWithReferenceArtifactRules(t, result); validated != plan.Digest {
		t.Fatalf("reference validator returned digest %q, want %q", validated, plan.Digest)
	}

	// A second compilation of byte-identical checked input must print the same
	// descriptor, including node ids and the Plan digest.
	again := compileDurableWith(t, backend, ctx, source)
	if again.EmitSkipped || len(again.Diagnostics) != 0 || mainText(t, again) != emitted {
		t.Fatal("durable lowering is not byte-deterministic")
	}
}

func TestPinnedForkDurableUsesResolvedIdentityAndFailsClosed(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	ordinary := `function durable(value: string): string {
    return value + "!"
}
export function main(): string {
    return durable("runtime")
}
`
	ordinaryResult := compileDurableWith(t, backend, ctx, ordinary)
	if ordinaryResult.EmitSkipped || len(ordinaryResult.Diagnostics) != 0 {
		t.Fatalf("same-spelled local function was treated as intrinsic: %#v", ordinaryResult.Diagnostics)
	}
	if got := runComptimeProgram(t, ordinaryResult); got != "runtime!" {
		t.Fatalf("ordinary durable function returned %q", got)
	}

	resolved := `import { durable as compileFlow, Action } from "smithers:flows"
class Echo extends Action<(input: { value: string }) => Result<string, Error>> {}
function source(input: { value: string }) {
    return Echo.run(input)
}
export const Built = compileFlow(source)
export function main(): string[] {
    const first = Built.plan.nodes[0]
    if (first === undefined) return ["the plan has no nodes"]
    return [Built.artifactSource, first.kind]
}
`
	resolvedResult := compileDurableWith(t, backend, ctx, resolved)
	if resolvedResult.EmitSkipped || len(resolvedResult.Diagnostics) != 0 {
		t.Fatalf("statically resolved durable function was rejected: %#v", resolvedResult.Diagnostics)
	}
	if got := runComptimeProgram(t, resolvedResult); got != "static-plan-artifact,action" {
		t.Fatalf("resolved source function did not become a static Action Plan: %q", got)
	}
	if emitted := mainText(t, resolvedResult); strings.Contains(emitted, "compileFlow(source)") {
		t.Fatalf("emitted Flow retained a runtime callback wrapper:\n%s", emitted)
	}

	// A runtime branch used to be SMITHERS4106 here. MIGRATION-PLAN.md step 11
	// withdrew that wall: a branch is ordinary control flow inside a Flow body,
	// so this compiles, draws NOTHING, and the descriptor it emits is built from
	// the Effect Manifest rather than from a Plan. `17-durable/statement-branch-
	// fails-closed` is the same program on the conformance corpus and observes
	// the same three facts; this row is what says the fork agrees off-corpus too.
	branch := `import { durable as build } from "smithers:flows"
export const Bad = build((input: { live: boolean }) => {
    if (input.live) return "yes"
    return "no"
})
export function main(): string[] {
    return [Bad.artifactSource, Bad.id]
}
`
	branchResult := compileDurableWith(t, backend, ctx, branch)
	if branchResult.EmitSkipped || len(branchResult.Diagnostics) != 0 {
		t.Fatalf("a runtime branch in a Flow body was refused: %#v", branchResult.Diagnostics)
	}
	if got := runComptimeProgram(t, branchResult); got != "effect-manifest,main.sm#Bad" {
		t.Fatalf("a declined body did not publish an Effect Manifest descriptor: %q", got)
	}

	unsupported := `import { durable, fanOut } from "smithers:flows"
export const Bad = durable((input: { values: string[] }) => {
    return fanOut(input.values, (value: string) => value, (value: string) => value)
})
`
	unsupportedResult := compileDurableWith(t, backend, ctx, unsupported)
	requireDurableDiagnostic(t, unsupportedResult, "SMITHERS4117", strings.Index(unsupported, "fanOut(input"))

	mismatch := `import { durable, Action } from "smithers:flows"
class Store extends Action<(input: { value: string }) => Result<boolean, Error>> {}
export const Bad = durable((input: { value: number }) => {
    return Store.run({ value: input.value })
})
`
	mismatchResult := compileDurableWith(t, backend, ctx, mismatch)
	requireDurableDiagnostic(t, mismatchResult, "SMITHERS4100", strings.Index(mismatch, "{ value: input.value }"))
}

func TestPinnedForkRetiredVibelangFlowsIsForeign(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := `import { durable } from "vibelang:flows"
export const observed = durable
`
	result := compileDurableWith(t, backend, ctx, source)
	files := []SourceFile{{Path: "main.sm", Kind: FileKindSmithers, Text: source}}
	observed := formatDiagnosticPositions(t, files, result)
	if strings.Join(observed, " ") != "SMITHERS1510@1:25" {
		t.Fatalf("retired vibelang:flows diagnostics %v, want SMITHERS1510@1:25", observed)
	}
	if !result.EmitSkipped || len(result.Artifacts) != 0 {
		t.Fatalf("retired vibelang:flows import must fail closed without emit: %v", artifactPaths(result.Artifacts))
	}
}
