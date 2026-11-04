package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const explicitForkOptionsQuote = "The legacy `fork(program, options)` call becomes `try Effect.forkChild(program, options)`."
const explicitForkOptionsStableQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."

func explicitForkOptionsQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{explicitForkOptionsQuote, explicitForkOptionsStableQuote} {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing migration rule %q", quote)
		}
	}
}

func TestExplicitForkOptionsQuoted(t *testing.T) { explicitForkOptionsQuoted(t) }

// Mutate explicit effect owners, option objects/values, comments and fix modes.
// The chapter 7 oracle requires preserving the two arguments and convergence;
// it does not infer behavior from the compiler's comma-expression recovery.
func FuzzExplicitForkOptionsRepair(f *testing.F) {
	startShortBudget(f)
	explicitForkOptionsQuoted(f)
	owners := []string{"return", "initializer", "block", "arrow"}
	modes := []string{"ordinary", "VIP", "migration"}
	options := []string{"{startImmediately:true,uninterruptible:\"inherit\"}", "{startImmediately:false}", "{uninterruptible:false}", "{}", "options"}
	for _, owner := range owners {
		for _, mode := range modes {
			f.Add([]byte(owner+":"+mode), byte(0))
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte, mutation byte) {
		parts := strings.Split(string(data), ":")
		if len(parts) != 2 || !containsForkKey(owners, parts[0]) || !containsForkKey(modes, parts[1]) {
			if len(data) < 2 {
				return
			}
			parts = []string{owners[int(data[0])%len(owners)], modes[int(data[1])%len(modes)]}
		}
		key := strings.Join(parts, ":")
		option := options[int(mutation)%len(options)]
		trivia := ""
		if mutation&8 != 0 {
			trivia = "/*program*/"
		}
		call := "fork(Effect.succeed(1)" + trivia + ",/*options*/" + option + ")"
		var body string
		switch parts[0] {
		case "return":
			body = "export effect function start(){return " + call + "}"
		case "initializer":
			body = "export effect function start(){const f=" + call + ";return join f}"
		case "block":
			body = "export const start=effect {" + call + ";return 1}"
		case "arrow":
			body = "export const start=effect () => " + call
		}
		source := "const options={startImmediately:true};\n" + body
		old := legacyCompile(t, env, map[string]string{"main.vibe": source})
		defer old.Remove()
		config := toolsConfig(env.w, old.Dir)
		if config == nil || len(config.Errors) > 0 {
			t.Fatalf("config: %+v", config)
		}
		mode := vibelang.FixOptions{}
		if parts[1] == "VIP" {
			mode.VIPOnly = true
		}
		if parts[1] == "migration" {
			mode.MigrationOnly = true
		}
		result := vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, mode)
		fixed := source
		for _, file := range result.Files {
			fixed = file.Text
		}
		if result.Err != nil || len(result.Refused) > 0 || !strings.Contains(fixed, "try Effect.forkChild(") || !strings.Contains(fixed, trivia+",/*options*/"+option+")") {
			Gap(t, "FuzzExplicitForkOptionsRepair", key, "legacy options not preserved: %+v\n%s", result, fixed)
		}
		after := legacyCompile(t, env, map[string]string{"main.vibe": fixed})
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzExplicitForkOptionsRepair", key, "invalid repair: %v\n%s", errors, fixed)
		}
		if err := os.WriteFile(filepath.Join(old.Dir, "main.vibe"), []byte(fixed), 0600); err != nil {
			t.Fatal(err)
		}
		again := vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, mode)
		if again.Err != nil || len(again.Files) > 0 || len(again.Refused) > 0 {
			Gap(t, "FuzzExplicitForkOptionsRepair", key, "not idempotent: %+v", again)
		}
	})
}

func containsForkKey(keys []string, key string) bool {
	for _, candidate := range keys {
		if candidate == key {
			return true
		}
	}
	return false
}
