package vibelangfuzz

import (
	"maps"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// legacyMarkQuote is the rule FuzzVIPLegacyMarks checks (chapter 7, the VIP-1
// migration).
const legacyMarkQuote = "The VIP-1 migration writes `try` before each call that ran where it stood before VIP-1 and keeps that call's run phase"

func TestLegacyMarksRuleQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), legacyMarkQuote) {
		t.Fatal(legacyMarkQuote)
	}
}

// legacyMark is one program as VibeLang before VIP-1 wrote it, and as it reads
// with its runs and its form explicit. Both give run, an expression in main.
type legacyMark struct{ declare, legacy, explicit, run string }

// legacyMarks are the forms the old compiler ran or lifted without saying so,
// each from a Smithers module. --fix-vip-only must turn legacy into a program
// that ends as explicit does (RULES 1: two inputs the spec says end alike).
var legacyMarks = map[string]legacyMark{
	"suspend/subtype-call": {
		legacy: "const f = () => Effect.suspend(effect () => Exit.succeed(7))", explicit: "const f = () => Effect.suspend(effect () => try Exit.succeed(7))", run: "f()",
	},
	"suspend/subtype-block": {
		legacy: "const f = () => Effect.suspend(effect () => { return Exit.succeed(7) })", explicit: "const f = () => Effect.suspend(effect () => { return try Exit.succeed(7) })", run: "f()",
	},
	"suspend/subtype-value": {
		declare: "const held = Exit.succeed(7)\n",
		legacy:  "const f = () => Effect.suspend(effect () => held)", explicit: "const f = () => Effect.suspend(effect () => try held)", run: "f()",
	},
	"suspend/subtype-arms": {
		declare: "const held = Exit.succeed(7)\nconst no = (): boolean => false\n",
		legacy:  "const f = () => Effect.suspend(effect () => no() ? Exit.succeed(1) : held)", explicit: "const f = () => Effect.suspend(effect () => no() ? try Exit.succeed(1) : try held)", run: "f()",
	},
	"suspend/plain-subtype-thunk": {
		legacy: "const f = () => Effect.suspend(() => Exit.succeed(7))", explicit: "const f = () => Effect.suspend(() => Exit.succeed(7))", run: "f()",
	},
	"suspend/plain-subtype-value": {
		declare: "const held = Exit.succeed(7)\n",
		legacy:  "const f = () => Effect.suspend(() => held)", explicit: "const f = () => Effect.suspend(() => held)", run: "f()",
	},
	"catch/plain-subtype-handler": {
		legacy: `const f = (e: number!string) => Effect.catch(e, () => Exit.succeed(7))`, explicit: `const f = (e: number!string) => Effect.catch(e, () => Exit.succeed(7))`, run: `f(Effect.fail("x"))`,
	},
	"suspend/subtype-failing": {
		legacy: `const f = () => Effect.suspend(effect () => Exit.fail("gone"))`, explicit: `const f = () => Effect.suspend(effect () => try Exit.fail("gone"))`, run: "f()",
	},
}

// legacyMarkInput reads an input: "key:<key>", or a byte that picks a key.
func legacyMarkInput(data []byte) (string, bool) {
	if key, ok := strings.CutPrefix(string(data), "key:"); ok {
		_, known := legacyMarks[key]
		return key, known
	}
	if len(data) == 0 {
		return "", false
	}
	keys := slices.Sorted(maps.Keys(legacyMarks))
	return keys[int(data[0])%len(keys)], true
}

// FuzzVIPLegacyMarks runs --fix-vip-only on each legacyMarks program and
// compares its Exit with the explicit program's, with VIPCompare.
func FuzzVIPLegacyMarks(f *testing.F) {
	startShortBudget(f)
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, ok := legacyMarkInput(data)
		if !ok {
			t.Skip("the input names no key")
		}
		mark := legacyMarks[key]
		program := func(body string) map[string]string {
			return map[string]string{"main.vibe": mark.declare + body + "\n\nexport effect function main() {\n  return try " + mark.run + "\n}\n"}
		}
		explicit := legacyCompile(t, env, program(mark.explicit))
		defer explicit.Remove()
		if errors := legacyErrors(explicit); len(errors) > 0 {
			t.Fatalf("the explicit program does not compile: %s", errors[0])
		}
		old := legacyCompile(t, env, program(mark.legacy))
		defer old.Remove()
		config := toolsConfig(env.w, old.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config of the legacy program: %v", config)
		}
		var result *vibelang.FixResult
		Within("fix", func() {
			result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		})
		if result.Err != nil {
			Gap(t, "FuzzVIPLegacyMarks", "converge/"+key, "--fix-vip-only did not reach a fixed point (%v)", result.Err)
		}
		if len(result.Refused) > 0 {
			Gap(t, "FuzzVIPLegacyMarks", "refused/"+key, "--fix-vip-only refused: %+v", result.Refused)
		}
		if mark.legacy == mark.explicit && len(result.Files) > 0 {
			// A program the old compiler ran as written needs no edit: a
			// rewrite here marks a plain function for a value it never lifted.
			for _, file := range result.Files {
				Gap(t, "FuzzVIPLegacyMarks", "edit/"+key, "--fix-vip-only rewrote a program that needs no edit:\n%s", file.Text)
			}
		}
		fixed := program(mark.legacy)
		for _, file := range result.Files {
			fixed["main.vibe"] = file.Text
		}
		after := legacyCompile(t, env, fixed)
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzVIPLegacyMarks", "compile/"+key, "the migrated program does not compile: %s\n%s", strings.Join(errors, "\n"), fixed["main.vibe"])
		}
		want := env.node.RunVIP(explicit, "out/main.js")
		if want.Kind != "exit" {
			t.Fatalf("the explicit program ended %s: %s", want.Kind, want.Log)
		}
		got := env.node.RunVIP(after, "out/main.js")
		if aspect, diff := VIPCompare(want, got); aspect != "" {
			Gap(t, "FuzzVIPLegacyMarks", "exit:"+aspect+"/"+key, "the migrated program ends differently: %s\nmigrated:\n%s\n%s", diff, fixed["main.vibe"], got.Log)
		}
	})
}
