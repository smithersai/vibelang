package compiler

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestPinnedForkDurableLoopArtifacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	source := readTextFile(t, "testdata/durable-loop.vibe")
	result := compileDurableWith(t, backend, ctx, source)
	if result.EmitSkipped || len(result.Diagnostics) != 0 {
		t.Fatalf("loop refused: %+v", result.Diagnostics)
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
	// Recorded from the shipped Plan API before replacing its implementation.
	const planDigest = "172e75eb2fa606ba95c5f7bbcec5ac631e4a3f485ace4c021a893c3f808102d2"
	const manifestDigest = "9f7711f51217a8fbc3b2f9a9a690761c9d0562850f5cc85eac02e9a71904b7a4"
	if output.Plan.Digest != planDigest || output.Manifest.Digest != manifestDigest || output.Plan.FormatVersion != 2 {
		t.Fatalf("persisted loop identity changed: %+v", output)
	}
	if got := validateWithReferenceArtifactRules(t, result); got != planDigest {
		t.Fatalf("invalid Plan digest: %s", got)
	}
	if len(output.Plan.Nodes) != 1 || output.Plan.Nodes[0]["kind"] != "loop" || output.Plan.Nodes[0]["id"] != "src-3e2671080c5c42730624ba5d" {
		t.Fatalf("loop is not one pinned bounded template: %+v", output.Plan)
	}
	if len(output.Manifest.Actions) != 1 || len(output.Manifest.Sites) != 1 || output.Manifest.Sites[0].Kind != "perform" {
		t.Fatalf("loop Action is absent from independent source reachability: %+v", output.Manifest)
	}
}

func TestPinnedForkDurableLoopTemplateExpressions(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	base := readTextFile(t, "testdata/durable-loop.vibe")
	for _, condition := range []string{
		"state.remaining === 1", "state.remaining !== 0", "state.remaining >= 0", "state.remaining < 5", "state.remaining <= 5",
		"state.remaining > 0 && state.total < 9", "state.remaining > 0 || state.total < 9", "!(state.remaining <= 0)",
		`state["remaining"] > 0`, `({n: state.remaining}).n > 0`, `[state.remaining][0] > 0`,
	} {
		t.Run(condition, func(t *testing.T) {
			source := strings.Replace(base, "state.remaining > 0", condition, 1)
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("template refused: %+v", result.Diagnostics)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
	for _, template := range []string{
		`{ remaining: state.remaining + -1, total: state.total + 1 }`,
		`{ remaining: ({n: state.remaining}).n, total: ({n: state.total}).n }`,
	} {
		t.Run(template, func(t *testing.T) {
			source := strings.Replace(base, `{ remaining: state.remaining, total: state.total }`, template, 1)
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("template refused: %+v", result.Diagnostics)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
}

func TestPinnedForkDurableLoopRequiresSerializableProjections(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, state, condition string }{
		{"present tuple element", "{items: [number]}", "state.items[0] > 0"},
		{"whole optional object", "{enabled?: boolean}", "false"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable, Action, loopWhile} from "vibelang:flows"; type State = ` + tc.state + `;
class Step extends Action<(state: State) => Result<State, never>> {};
export const Build = durable((input: State) => { return loopWhile(input, state => ` + tc.condition + `, state => Step.run(state), 2) })`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("serializable template was refused: %+v", result.Diagnostics)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
	for _, tc := range []struct{ name, state, initial, condition, argument, message string }{
		{"array length in condition", "{items: number[]}", "input", "state.items.length > 0", "1", "cannot project length from durable array"},
		{"array length in input", "{items: number[]}", "input", "true", "state.items.length", "cannot project length from durable array"},
		{"unbounded array index", "{items: number[]}", "input", "state.items[0] > 0", "1", "cannot prove durable array index"},
		{"optional property", "{enabled?: boolean}", "input", "state.enabled === true", "1", "cannot prove optional durable field"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable, Action, loopWhile} from "vibelang:flows"; class Step extends Action<(n: number) => Result<` + tc.state + `, never>> {};
export const Build = durable((input: ` + tc.state + `) => { return loopWhile(` + tc.initial + `, state => ` + tc.condition + `, state => Step.run(` + tc.argument + `), 2) })`
			result := compileDurableWith(t, backend, ctx, source)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4121" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("unprovable persisted projection was accepted: %+v", result.Diagnostics)
		})
	}
}

func TestPinnedForkDurableLoopRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	base := readTextFile(t, "testdata/durable-loop.vibe")
	for _, tc := range []struct{ name, old, replacement, message string }{
		{"captured condition", "state.remaining > 0", "input.count > 0", "cannot capture"},
		{"captured body", "remaining: state.remaining", "remaining: input.count", "cannot capture"},
		{"runtime budget", "        5\n", "        input.count\n", "static numeric literal"},
		{"zero budget", "        5\n", "        0\n", "between 1 and 1000"},
		{"excessive budget", "        5\n", "        1001\n", "between 1 and 1000"},
		{"fractional budget", "        5\n", "        1.5\n", "between 1 and 1000"},
		{"nonboolean condition", "state.remaining > 0", "state.remaining", "statically be boolean"},
		{"async condition", "state => state.remaining", "async state => state.remaining", "synchronous"},
		{"condition block", "state => state.remaining > 0", "state => { return state.remaining > 0 }", "expression arrow"},
		{"default parameter", "state => state.remaining", "(state = {remaining:0,total:0}) => state.remaining", "required identifier"},
		{"binary subtraction", "state.remaining > 0", "state.remaining - 1 > 0", "unsupported loop template operator"},
		{"dynamic property", "state.remaining > 0", "state[Object.keys(state)[0]] > 0", "projection keys must be static"},
		{"optional property", "state.remaining > 0", "state?.remaining > 0", "optional projection"},
		{"ordinary body", "Step.run({ remaining: state.remaining, total: state.total })", "state", "Action.run(input)"},
		{"body bang", "Step.run({ remaining: state.remaining, total: state.total })", "Step.run({ remaining: state.remaining, total: state.total })!", "Action.run(input)"},
		{"malformed Action input", "remaining: state.remaining", `remaining: "wrong"`, "not assignable"},
		{"incompatible state", "Result<{ remaining: number; total: number }, Error>", "Result<{ remaining: string; total: number }, Error>", "state contract"},
		{"incompatible condition parameter", "state => state.remaining > 0,\n        state => Step.run",
			"(state: {remaining: string}) => state.remaining !== \"\",\n        (state: {remaining:number;total:number}) => Step.run", "state contract"},
		{"incompatible initial value", "{ remaining: input.count, total: 0 }", "{ remaining: input.count, total: \"wrong\" }", "not assignable"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := strings.Replace(base, tc.old, tc.replacement, 1)
			if source == base {
				t.Fatal("test replacement did not change source")
			}
			result := compileDurableWith(t, backend, ctx, source)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4121" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("missing bounded-loop refusal (%s): %+v", tc.message, result.Diagnostics)
		})
	}
}

func TestPinnedForkDurableActionContractConflictsAcrossTemplates(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	const prefix = `import {durable, Action, loopWhile} from "vibelang:flows";
namespace First { export class Step extends Action<(input: {n:number})=>Result<{n:number},never>> {} }
namespace Second { export class Step extends Action<(input: {n:number})=>Result<{n:number;extra:number},never>> {} }
export const Build = durable((input:{n:number}) => { `
	const firstLoop = `loopWhile(input, state => state.n > 0, state => First.Step.run({n: state.n}), 2)`
	const secondLoop = `loopWhile(input, state => state.n > 0, state => Second.Step.run({n: state.n}), 2)`
	for _, tc := range []struct{ name, body string }{
		{"two loops", `const a = ` + firstLoop + `; return ` + secondLoop},
		{"ordinary then loop", `const a = First.Step.run(input)!; return ` + secondLoop},
		{"loop then ordinary", `const a = ` + firstLoop + `; return Second.Step.run(input)`},
		{"ordinary calls", `const a = First.Step.run(input)!; return Second.Step.run(input)`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileDurableWith(t, backend, ctx, prefix+tc.body+` })`)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4114" && strings.Contains(issue.Message, "main.vibe#Step") {
					return
				}
			}
			t.Fatalf("one Action id acquired incompatible contracts: %+v", result.Diagnostics)
		})
	}
}
