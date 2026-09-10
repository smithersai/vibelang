package compiler

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

func TestPinnedForkDurableFanOutArtifacts(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct {
		file, plan, manifest, node string
		version                    int
	}{
		{"durable-fanout", "e42fda90f8e30c473b93d668268d38f31fd4798058418ba598a70770ac77b2ff", "5311ad69eda0f6a7e7824f8c28117044baa34823d01227992a526773c22d7c96", "src-4f4c8b3c961242f26cd6cd51", 1},
		{"durable-fanout-steps", "e3d481a8154dbedd9bb3a2f372496d6dab0624244f7ac082893074c3dd0be9f1", "e43820eb54ea3a678be449192ba5e998fee1a38ce607743bb32634dba6a42a3a", "src-78ac342ecf6ca19c2906a67f", 2},
	} {
		t.Run(tc.file, func(t *testing.T) {
			source := readTextFile(t, "testdata/"+tc.file+".vibe")
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("fan-out refused: %+v", result.Diagnostics)
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
			if output.Plan.Digest != tc.plan || output.Manifest.Digest != tc.manifest || output.Plan.FormatVersion != tc.version {
				t.Fatalf("persisted fan-out encoding changed: %+v", output)
			}
			if len(output.Plan.Nodes) != 1 || output.Plan.Nodes[0]["kind"] != "fanout" || output.Plan.Nodes[0]["id"] != tc.node {
				t.Fatalf("not one pinned template: %+v", output.Plan)
			}
			if got := validateWithReferenceArtifactRules(t, result); got != tc.plan {
				t.Fatalf("invalid Plan: %s", got)
			}
			if len(output.Manifest.Actions) != tc.version || len(output.Manifest.Sites) != tc.version {
				t.Fatalf("incomplete callback reachability: %+v", output.Manifest)
			}
			shifted := compileDurableWith(t, backend, ctx, "// leading edit\n"+source)
			if shifted.EmitSkipped || len(shifted.Diagnostics) != 0 {
				t.Fatalf("line-shifted template refused: %+v", shifted.Diagnostics)
			}
			if err := json.Unmarshal([]byte(runComptimeProgram(t, shifted)), &output); err != nil {
				t.Fatal(err)
			}
			if output.Plan.Nodes[0]["id"] != tc.node {
				t.Fatal("a line edit re-keyed the fan-out")
			}
		})
	}
}

func TestPinnedForkDurableFanOutRefusals(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	base := readTextFile(t, "testdata/durable-fanout.vibe")
	for _, tc := range []struct{ name, old, replacement, message string }{
		{"constant key", "item => item.id", `item => "same"`, "direct projection"},
		{"object key", "item => item.id", "item => item", "string, number, or boolean"},
		{"captured key", "item => item.id", "item => input.items.length", "cannot capture"},
		{"async key", "item => item.id", "async item => item.id", "synchronous"},
		{"key block", "item => item.id", "item => { return item.id }", "expression arrow"},
		{"optional key", "item => item.id", "(item?: {id:string}) => item.id", "required identifier"},
		{"incompatible key annotation", "item => item.id", "(item: {id:number;value:number}) => item.id", "checked key parameter contract"},
		{"narrowed key annotation", "item => item.id", `(item: {id:"only";value:number}) => item.id`, "checked key parameter contract"},
		{"narrowed body annotation", "item => item.id, item => Read.run", `(item: {id:string;value:number}) => item.id, (item: {id:"only";value:number}) => Read.run`, "checked body parameter contract"},
		{"captured input", "value: item.value", "value: input.items.length", "cannot capture"},
		{"computed key", "item => item.id", "item => item[Object.keys(item)[0]]", "string, number, or boolean"},
		{"ordinary body", "item => Read.run({ id: item.id, value: item.value })", "item => item", "Action.run(input)"},
		{"async body", "item => Read.run", "async item => Read.run", "synchronous"},
		{"malformed Action", "Read.run({ id: item.id, value: item.value })", "Read.run()", "exactly one"},
		{"mismatched Action", "value: item.value", `value: "bad"`, "not assignable"},
		{"arithmetic input", "value: item.value", "value: item.value + 1", "unsupported fanOut template"},
		{"spread input", "{ id: item.id, value: item.value }", "{ ...item }", "spreads"},
		{"missing body return", "item => Read.run({ id: item.id, value: item.value })", "item => {}", "must return"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := strings.Replace(base, tc.old, tc.replacement, 1)
			if source == base {
				t.Fatal("test did not mutate source")
			}
			result := compileDurableWith(t, backend, ctx, source)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4117" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("missing fan-out refusal (%s): %+v", tc.message, result.Diagnostics)
		})
	}
	stepped := readTextFile(t, "testdata/durable-fanout-steps.vibe")
	for _, tc := range []struct{ name, old, replacement, message string }{
		{"mutable binding", "const id = item.id", "let id = item.id", "must use const"},
		{"destructuring", "const id = item.id", "const {id} = item", "one identifier"},
		{"unpropagated intermediate", "Read.run({ id, value: item.value })!", "Read.run({ id, value: item.value })", "unsupported fanOut template"},
		{"uninvoked helper", "Read.run({ id, value: item.value })!", "(() => Read.run({ id, value: item.value }))()!", "Action.run(input)"},
		{"after return", "return Publish.run({ id: renamed, value: read.value })", "return Publish.run({ id: renamed, value: read.value }); const after = item.id", "after the fanOut body return"},
		{"earlier step type mismatch", "value: read.value", "value: read.id", "durable input contract"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			result := compileDurableWith(t, backend, ctx, strings.Replace(stepped, tc.old, tc.replacement, 1))
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4117" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("missing stepped fan-out refusal (%s): %+v", tc.message, result.Diagnostics)
		})
	}
}

func TestPinnedForkDurableFanOutCheckedItemTypes(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, collection, key, input string }{
		{"scalar array", "readonly number[]", "item => item", "item"},
		{"empty tuple", "readonly []", "(item: number) => item", "item"},
		{"fixed tuple", "readonly [number, number]", "item => item", "item"},
		{"union of collections", "readonly number[] | readonly [1, 2]", "item => item", "item"},
		{"record annotation", "readonly {id: string;value: number}[]", "(item: {id:string}) => item.id", "item.value"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			source := `import {durable,Action,fanOut as each} from "vibelang:flows";
class Step extends Action<(n:number)=>Result<number,never>> {};
export const Build = durable((input: {items: ` + tc.collection + `}) => { return each(input.items, ` + tc.key + `, item => Step.run(` + tc.input + `)) })`
			result := compileDurableWith(t, backend, ctx, source)
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("checked collection refused: %+v", result.Diagnostics)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
}

func TestPinnedForkDurableFanOutStepBudget(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	base := readTextFile(t, "testdata/durable-fanout.vibe")
	for _, size := range []int{1, 16, 17} {
		t.Run(fmt.Sprint(size), func(t *testing.T) {
			var body strings.Builder
			body.WriteString("item => {\n")
			input := "item"
			for step := 0; step < size; step++ {
				if step == size-1 {
					fmt.Fprintf(&body, "return Read.run({id:%s.id,value:%s.value})\n", input, input)
				} else {
					fmt.Fprintf(&body, "const s%d = Read.run({id:%s.id,value:%s.value})!\n", step, input, input)
					input = fmt.Sprintf("s%d", step)
				}
			}
			body.WriteString("}")
			source := strings.Replace(base, "item => Read.run({ id: item.id, value: item.value })", body.String(), 1)
			result := compileDurableWith(t, backend, ctx, source)
			if size > 16 {
				for _, issue := range result.Diagnostics {
					if result.EmitSkipped && issue.Code == "VIBE4117" && strings.Contains(issue.Message, "at most 16") {
						return
					}
				}
				t.Fatalf("step ceiling was not enforced: %+v", result.Diagnostics)
			}
			if result.EmitSkipped || len(result.Diagnostics) != 0 {
				t.Fatalf("bounded steps refused: %+v", result.Diagnostics)
			}
			validateWithReferenceArtifactRules(t, result)
		})
	}
}

func TestPinnedForkDurableFanOutRequiresSerializableProjections(t *testing.T) {
	backend, ctx := newPinnedTestBackend(t)
	for _, tc := range []struct{ name, item, key, value, message string }{
		{"key array length", "{values:number[]}", "item.values.length", "1", "cannot project length"},
		{"input array length", "{id:string;values:number[]}", "item.id", "item.values.length", "cannot project length"},
		{"optional key", "{id?:string}", "(item: {id:string}) => item.id", "1", "cannot prove optional"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			key := "item => " + tc.key
			if strings.HasPrefix(tc.key, "(") {
				key = tc.key
			}
			source := `import {durable,Action,fanOut} from "vibelang:flows"; class Step extends Action<(n:number)=>Result<number,never>> {};
export const Build = durable((input: {items: ` + tc.item + `[]}) => { return fanOut(input.items, ` + key + `, item => Step.run(` + tc.value + `)) })`
			result := compileDurableWith(t, backend, ctx, source)
			for _, issue := range result.Diagnostics {
				if result.EmitSkipped && issue.Code == "VIBE4117" && strings.Contains(issue.Message, tc.message) {
					return
				}
			}
			t.Fatalf("unprovable fan-out projection was accepted: %+v", result.Diagnostics)
		})
	}
}
