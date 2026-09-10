package compiler

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// These digests were measured from the shipped Plan API before its compiler
// migration. They pin persisted data, not another compiler implementation.
// The SDK's data-only artifact validator independently re-derives the Plan
// digest, so merely copying an expected digest into malformed output fails.
func TestPinnedForkDurablePersistentInputArtifacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := readTextFile(t, "testdata/durable-inputs.vibe")
	result := compileDurableWith(t, backend, ctx, source)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("persistent input Plan was refused: %+v", result.Diagnostics)
	}
	var output struct {
		Plan struct {
			Digest        string           `json:"digest"`
			FormatVersion int              `json:"formatVersion"`
			Nodes         []map[string]any `json:"nodes"`
		} `json:"plan"`
		Manifest forkManifest `json:"manifest"`
	}
	if err := json.Unmarshal([]byte(runComptimeProgram(t, result)), &output); err != nil {
		t.Fatal(err)
	}
	const planDigest = "5b87d6720541a4501c18b00a3c616c809ec7e22f49a8a922c17277f84e72abb1"
	const manifestDigest = "2784d936551d6c2092d2af8c9172760c72b7945b007a8edd73420bd7e556ac46"
	if output.Plan.Digest != planDigest || output.Manifest.Digest != manifestDigest || output.Plan.FormatVersion != 3 {
		t.Fatalf("persisted Plan/Manifest identity changed: %+v", output)
	}
	if validated := validateWithReferenceArtifactRules(t, result); validated != planDigest {
		t.Fatalf("native Plan failed independent data validation: %s", validated)
	}
	if len(output.Plan.Nodes) != 5 || len(output.Manifest.Contracts) != 4 || len(output.Manifest.Sites) != 5 {
		t.Fatalf("lost a wait, repeated queue consumer, branch, or deduplicated contract: %+v", output)
	}
	for index, kind := range []string{"signal", "signal", "queue", "queue", "branch"} {
		node := output.Plan.Nodes[index]
		if node["kind"] != kind {
			t.Fatalf("node %d: %+v", index, node)
		}
		controls := node["controlDependencies"].([]any)
		if index == 0 && len(controls) != 0 || index > 0 && (len(controls) != 1 || controls[0] != output.Plan.Nodes[index-1]["id"]) {
			t.Fatalf("lost authored sequencing at node %d: %+v", index, node)
		}
	}
	// Plan keys are anchored to bindings, not physical line numbers. Source
	// debug addresses and Manifest sites deliberately do move after a line edit.
	shifted := compileDurableWith(t, backend, ctx, "// unrelated leading edit\n"+source)
	if shifted.EmitSkipped || len(shifted.Diagnostics) != 0 {
		t.Fatalf("shifted source was refused: %+v", shifted.Diagnostics)
	}
	var next struct {
		Plan struct {
			Nodes []map[string]any `json:"nodes"`
		} `json:"plan"`
	}
	if err := json.Unmarshal([]byte(runComptimeProgram(t, shifted)), &next); err != nil {
		t.Fatal(err)
	}
	for index, node := range output.Plan.Nodes {
		if next.Plan.Nodes[index]["id"] != node["id"] {
			t.Fatalf("unrelated line edit re-keyed node %d", index)
		}
	}
}

func TestPinnedForkDurablePersistentInputIdentity(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, imports, body, kind string }{
		{"queue alias", `import {durable, dequeue as take} from "vibelang:flows"`, `return take<string>("jobs")`, "queue"},
		{"broadcast alias", `import {durable, waitBroadcast as listen} from "vibelang:flows"`, `return listen<string>("news")`, "signal"},
		{"queue namespace", `import {durable} from "vibelang:flows"; import * as Flows from "vibelang:flows"`, `return Flows.dequeue<string>("jobs")`, "queue"},
		{"broadcast namespace", `import {durable} from "vibelang:flows"; import * as Flows from "vibelang:flows"`, `return Flows.waitBroadcast<string>("news")`, "signal"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := tc.imports + `; export const Build = durable((input: {}) => { ` + tc.body + ` }); export function main(): string { return Build.plan.nodes[0]?.kind ?? "missing" }`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("checked import identity was lost: %+v", result.Diagnostics)
			}
			if got := runComptimeProgram(t, result); got != tc.kind {
				t.Fatalf("kind = %q, want %q", got, tc.kind)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
}

func TestPinnedForkDurablePersistentInputRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, form := range []struct{ name, code string }{{"dequeue", "VIBE4123"}, {"waitBroadcast", "VIBE4122"}} {
		for _, tc := range []struct{ name, expr, text string }{
			{"missing type", form.name + `("jobs")`, "one explicit type argument"},
			{"missing identity", form.name + `<string>()`, "one explicit type argument"},
			{"extra argument", form.name + `<string>("jobs", "extra")`, "one explicit type argument"},
			{"dynamic identity", form.name + `<string>(input.name)`, "string literal"},
			{"invalid portable identity", form.name + `<string>("jobs pending")`, "portable characters"},
			{"empty identity", form.name + `<string>("")`, "portable characters"},
			{"oversized identity", form.name + `<string>("` + strings.Repeat("a", 129) + `")`, "portable characters"},
			{"function payload", form.name + `<() => number>("jobs")`, "not structurally encodable"},
			{"unknown payload", form.name + `<unknown>("jobs")`, "not structurally encodable"},
			{"any payload", form.name + `<any>("jobs")`, "not structurally encodable"},
			{"optional invocation", form.name + `?.<string>("jobs")`, "one explicit type argument"},
		} {
			t.Run(form.name+"/"+tc.name, func(t *testing.T) {
				source := fmt.Sprintf(`import {durable, %s} from "vibelang:flows"; export const Build = durable((input: {name: string}) => { return %s })`, form.name, tc.expr)
				result := compileDurableWith(t, backend, ctx, source)
				for _, issue := range result.Diagnostics {
					if issue.Code == form.code && strings.Contains(issue.Message, tc.text) && result.EmitSkipped {
						return
					}
				}
				t.Fatalf("missing %s (%s): %+v", form.code, tc.text, result.Diagnostics)
			})
		}
	}
	for _, tc := range []struct{ name, body, code, text string }{
		{"inconsistent queue contract", `const a=dequeue<string>("jobs"); const b=dequeue<number>("jobs"); return {a,b}`, "VIBE4123", "two different item types"},
		{"duplicate broadcast", `const a=waitBroadcast<string>("news"); const b=waitBroadcast<string>("news"); return {a,b}`, "VIBE4122", "duplicated"},
		{"unicast then broadcast", `const a=waitSignal<string>("news"); const b=waitBroadcast<string>("news"); return {a,b}`, "VIBE4122", "duplicated"},
		{"broadcast then unicast", `const a=waitBroadcast<string>("news"); const b=waitSignal<string>("news"); return {a,b}`, "VIBE4118", "duplicated"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable, waitSignal, waitBroadcast, dequeue} from "vibelang:flows"; export const Build = durable((input: {}) => { ` + tc.body + ` })`
			result := compileDurableWith(t, backend, ctx, source)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == tc.code && strings.Contains(issue.Message, tc.text) {
					return
				}
			}
			t.Fatalf("ambiguous persistent input was not refused: %+v", result.Diagnostics)
		})
	}
}
