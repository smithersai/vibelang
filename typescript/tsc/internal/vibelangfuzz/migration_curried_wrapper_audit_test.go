package vibelangfuzz

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

var curriedWrapperKeys = []string{"staged", "staged-alias", "nested", "returned-local", "direct", "simple-iife", "lost-value", "lost-branch", "local-function", "passthrough-identity"}

func TestMigrationCurriedWrapperAuditQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", "an Effect, not yet run")
	chapterSays(t, "007-tooling.md", "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite.")
	text, err := os.ReadFile(filepath.Join(Root(), ".smithers/flows/migrate/README.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(text), "no migrated function lost an Effect wrapper in the emitted JavaScript") {
		t.Fatal("the migration wrapper contract changed")
	}
}

func curriedWrapperSources(t *testing.T, key string, mode uint8) (string, string, string) {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(repoTestdata(), "corpus", "t3code-curried-pipeline-iife.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture struct{ Original, Native string }
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	if key == "passthrough-identity" {
		raw, err = os.ReadFile(filepath.Join(repoTestdata(), "corpus", "t3code-passthrough-identity-stage.json"))
		if err != nil {
			t.Fatal(err)
		}
		if err = json.Unmarshal(raw, &fixture); err != nil {
			t.Fatal(err)
		}
	}
	original, native := fixture.Original, fixture.Native
	header := "import * as Effect from \"effect/Effect\";\n"
	body := "const program = descriptor(); const stage = withSpan(\"check\"); return program |> stage(%);"
	if key == "staged-alias" {
		body = "const first = descriptor(); const program = first; const stage = withSpan(\"check\"); return program |> stage(%);"
	}
	iife := "(() => { " + body + " })()"
	switch key {
	case "staged-alias":
		native = header + "const descriptor = effect () => { return 1 };\nexport const factory = () => " + iife + ";\n"
	case "nested":
		native = header + "const descriptor = effect () => { return 1 };\nexport const factory = () => (() => " + iife + ")();\n"
	case "returned-local":
		native = header + "const descriptor = effect () => { return 1 };\nexport const factory = () => { const value = " + iife + "; return value; };\n"
	case "direct", "simple-iife", "lost-value":
		original = header + "export const factory = () => Effect.succeed(1);\n"
		expr := "Effect.succeed(1)"
		if key == "simple-iife" {
			expr = "(() => Effect.succeed(1))()"
		}
		if key == "lost-value" {
			expr = "1"
		}
		native = header + "export const factory = () => " + expr + ";\n"
	case "lost-branch":
		original = header + "export const factory = (bad: boolean = false) => bad ? Effect.succeed(1) : Effect.succeed(2);\n"
		native = header + "export const factory = (bad: boolean = false) => bad ? 1 : Effect.succeed(2);\n"
	case "local-function":
		original = header + "export const factory = () => { const build = Effect.fnUntraced(function* () { return 1; }); return build; };\n"
		native = header + "export const factory = () => { const build = effect () => { return 1 }; return build; };\n"
	}
	name := "factory"
	if mode&1 != 0 {
		original = strings.ReplaceAll(strings.ReplaceAll(original, "Effect.", "Fx."), "import * as Effect from", "import * as Fx from")
		native = strings.ReplaceAll(strings.ReplaceAll(native, "Effect.", "Fx."), "import * as Effect from", "import * as Fx from")
	}
	if mode&4 != 0 {
		name = "factoryΔ"
		original = "// Keep the returned program as data.\n" + strings.ReplaceAll(original, "factory", name)
		native = "// Keep the returned program as data.\n" + strings.ReplaceAll(native, "factory", name)
	}
	if mode&8 != 0 {
		for _, namespace := range []string{"Effect", "Fx"} {
			original = strings.ReplaceAll(original, namespace+".succeed(1)", namespace+".succeed(\"value\")")
			native = strings.ReplaceAll(native, namespace+".succeed(1)", namespace+".succeed(\"value\")")
		}
		original = strings.ReplaceAll(original, "return 1", "return \"value\"")
		native = strings.ReplaceAll(native, "return 1", "return \"value\"")
		if key == "lost-value" {
			native = strings.ReplaceAll(native, "=> 1;", "=> \"value\";")
		}
	}
	if mode&2 != 0 {
		original = strings.ReplaceAll(original, "\n", "\r\n")
		native = strings.ReplaceAll(native, "\n", "\r\n")
	}
	return original, native, name
}

// This target checks the static migration audit on actual compiler output.
// It does not execute or compare runtime Exits.
func checkCurriedWrapperAudit(t *testing.T, w *Workspace, key string, mode uint8) {
	t.Helper()
	original, native, name := curriedWrapperSources(t, key, mode&15)
	compile := func(file, text string) *Result {
		r, err := w.Compile(t.Context(), Project{Files: map[string]string{file: text, "package.json": "{\"type\":\"module\"}\n"}})
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(r.Remove)
		if HasError(r.Diagnostics) {
			t.Fatalf("invalid %s source: %v\n%s", file, SortedKeys(Keys(r.Dir, r.Diagnostics)), text)
		}
		return r
	}
	compile("main.ts", original)
	emitted := compile("main.vibe", native).Outputs["out/main.js"]
	if emitted == "" {
		t.Fatal("native compiler emitted no JavaScript")
	}
	input, err := json.Marshal(map[string]string{"original": original, "emitted": emitted})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(t.Context(), HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, "node", filepath.Join(repoTestdata(), "oracles", "migration_curried_wrapper_audit.mjs"))
	cmd.Dir = Root()
	cmd.Stdin = strings.NewReader(string(input))
	output, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("actual wrapper audit: %v; context=%v\n%s", err, ctx.Err(), output)
	}
	var model struct {
		StockCodes []int
		Flags      []struct {
			Function                            string
			EffectReturns, EmittedEffectReturns int
		}
		Unpaired                                       []json.RawMessage
		NegativeFlags, IdentityFlags, IdentityUnpaired int
	}
	if err = json.Unmarshal(output, &model); err != nil {
		t.Fatalf("invalid wrapper audit result: %v\n%s", err, output)
	}
	if len(model.StockCodes) != 0 || model.NegativeFlags != 1 || model.IdentityFlags != 0 || model.IdentityUnpaired != 0 {
		t.Fatalf("invalid independent audit controls: %s", output)
	}
	if len(model.Unpaired) != 0 {
		t.Fatalf("an original function was not paired: %s\n%s", output, emitted)
	}
	wantLoss := key == "lost-value" || key == "lost-branch"
	if wantLoss {
		if len(model.Flags) != 1 || model.Flags[0].Function != "/"+name || model.Flags[0].EmittedEffectReturns >= model.Flags[0].EffectReturns {
			t.Fatalf("a genuine wrapper loss must remain blocking: %s\n%s", output, emitted)
		}
	} else if len(model.Flags) > 0 {
		for _, flag := range model.Flags {
			if flag.Function != "/"+name {
				t.Fatalf("unexpected wrapper flag: %s", output)
			}
		}
		Gap(t, "FuzzMigrationCurriedWrapperAudit", "wrapper:"+key, "Chapter 1: calling an effect function gives an Effect, not yet run; the compiler-produced IIFE still returns that program\n%s\n%s", output, emitted)
	}
	ExpectPending(t, "FuzzMigrationCurriedWrapperAudit", "wrapper:"+key)
	ExpectPending(t, "FuzzMigrationCurriedWrapperAudit", specCorpusKey(t))
}

func TestMigrationIdentityStageNeighborhood(t *testing.T) {
	TestMigrationCurriedWrapperAuditQuoted(t)
	w := NewWorkspace(t)
	for mode := range 16 {
		t.Run(strconv.Itoa(mode), func(t *testing.T) {
			checkCurriedWrapperAudit(t, w, "passthrough-identity", uint8(mode))
		})
	}
}

func FuzzMigrationCurriedWrapperAudit(f *testing.F) {
	startShortBudget(f)
	w := NewWorkspace(f)
	f.Add("staged", uint8(0))
	f.Add("direct", uint8(15))
	f.Add("lost-value", uint8(0))
	f.Fuzz(func(t *testing.T, key string, mode uint8) {
		TestMigrationCurriedWrapperAuditQuoted(t)
		if !slices.Contains(curriedWrapperKeys, key) {
			if key == "" {
				key = curriedWrapperKeys[0]
			} else {
				key = curriedWrapperKeys[int(key[0])%len(curriedWrapperKeys)]
			}
		}
		t.Logf("wrapper audit key=%s mode=%d", key, mode&15)
		checkCurriedWrapperAudit(t, w, key, mode)
	})
}
