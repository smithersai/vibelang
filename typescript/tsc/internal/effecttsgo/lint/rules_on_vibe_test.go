package lint

import (
	"context"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const twinHeader = "import { Effect, Schema, Data, Layer, Context } from \"effect\"\n"

// ruleWitnesses are programs that spell a rule's pattern through Effect's API,
// as a migrated file does, each valid text for .ts and .vibe alike. They name
// the rules VibeLang answers with syntax or with a build diagnostic. Keys stay
// stable: fuzz corpus files name them (fuzz RULES.md rule 11).
var ruleWitnesses = map[string]struct {
	rule, text string
}{
	"succeed-void":   {"effectSucceedWithVoid", "export const a = Effect.succeed(undefined)\n"},
	"map-void":       {"effectMapVoid", "const x = Effect.succeed(1)\nexport const a = Effect.map(x, () => undefined)\n"},
	"map-flatten":    {"effectMapFlatten", "const x = Effect.succeed(1)\nexport const b = x.pipe(Effect.map((n) => Effect.succeed(n)), Effect.flatten)\n"},
	"flat-map":       {"flatMapToMap", "const x = Effect.succeed(1)\nexport const a = Effect.flatMap(x, (n) => Effect.succeed(n + 1))\n"},
	"catch-map":      {"catchAllToMapError", "const x = Effect.fail(\"a\")\nexport const a = x.pipe(Effect.catch((e) => Effect.fail(e + \"b\")))\n"},
	"do":             {"effectDoNotation", "export const a = Effect.Do.pipe(Effect.bind(\"x\", () => Effect.succeed(1)))\n"},
	"gen-unneeded":   {"unnecessaryEffectGen", "export const a = Effect.gen(function* () { return yield* Effect.succeed(1) })\n"},
	"gen-nested":     {"nestedEffectGenYield", "export const a = Effect.gen(function* () { yield* Effect.gen(function* () { return 1 }); return 2 })\n"},
	"gen-try":        {"tryCatchInEffectGen", "export const a = Effect.gen(function* () { try { yield* Effect.succeed(1) } catch {} return 2 })\n"},
	"gen-star":       {"missingStarInYieldEffectGen", "export const a = Effect.gen(function* () { yield Effect.succeed(1); return 2 })\n"},
	"gen-adapter":    {"effectGenUsesAdapter", "export const a = Effect.gen(function* (_) { return yield* _(Effect.succeed(1)) })\n"},
	"fail-return":    {"missingReturnYieldStar", "class E extends Data.TaggedError(\"E\")<{}> {}\nexport const a = Effect.gen(function* () { yield* Effect.fail(new E()); return 2 })\n"},
	"lazy-promise":   {"lazyPromiseInEffectSync", "export const a = Effect.sync(() => Promise.resolve(1))\n"},
	"self-mismatch":  {"classSelfMismatch", "export class A extends Context.Service<B, { a: number }>()(\"A\") {}\nexport class B extends Context.Service<B, { a: number }>()(\"B\") {}\n"},
	"deterministic":  {"deterministicKeys", "export class S extends Context.Service<S, {}>()(\"wrong\") {}\n"},
	"run-inside":     {"runEffectInsideEffect", "export const b = Effect.gen(function* () { return Effect.runSync(Effect.succeed(1)) })\n"},
	"global-date":    {"globalDate", "export const a = Date.now()\n"},
	"global-random":  {"globalRandom", "export const a = Math.random()\n"},
	"global-uuid":    {"cryptoRandomUUID", "export const a = crypto.randomUUID()\n"},
	"global-console": {"globalConsole", "export function f() { console.log(1) }\n"},
	"global-timers":  {"globalTimers", "export function f() { setTimeout(() => 1, 1) }\n"},
	"global-fetch":   {"globalFetch", "export function f() { return fetch(\"u\") }\n"},
	"in-effect":      {"globalConsoleInEffect", "export const a = Effect.sync(() => { console.log(1) })\n"},
	"date-in-effect": {"globalDateInEffect", "export const a = Effect.sync(() => Date.now())\n"},
	"node-builtin":   {"nodeBuiltinImport", "import * as fs from \"node:fs\"\nexport const a = fs\n"},
	"async":          {"asyncFunction", "export async function a() { return 1 }\n"},
	"fn-iife":        {"effectFnIife", "export const a = Effect.fn(\"x\")(function* () { return 1 })()\n"},
	"fn-implicit":    {"effectFnImplicitAny", "export const a = Effect.fn(\"x\")(function* (x) { return x })\n"},
	"schema-tag":     {"redundantSchemaTagIdentifier", "export class P extends Schema.TaggedClass<P>(\"P\")(\"P\", { a: Schema.Number }) {}\n"},
	// The rules alchemy's unbuilt tree made report unknown types (toolfix-alchemy, 2026-11-03).
	"effect-error":   {"missingEffectError", "class E extends Data.TaggedError(\"E\")<{}> {}\nexport const a: Effect.Effect<number> = Effect.fail(new E())\n"},
	"effect-context": {"missingEffectContext", "class S extends Context.Service<S, {}>()(\"S\") {}\nexport const f = (x: Effect.Effect<number, never, S>): Effect.Effect<number> => x\n"},
	"layer-context":  {"missingLayerContext", "class S extends Context.Service<S, {}>()(\"S\") {}\nclass T extends Context.Service<T, {}>()(\"T\") {}\nexport const f = (l: Layer.Layer<S, never, T>): Layer.Layer<S> => l\n"},
	"catch-never":    {"catchUnfailableEffect", "export const a = Effect.succeed(1).pipe(Effect.catch(() => Effect.succeed(2)))\n"},
	"nested-calls":   {"missedPipeableOpportunity", "import * as E from \"effect/Effect\"\nexport const a = E.asVoid(E.flatten(E.succeed(E.succeed(1))))\n"},
}

// lintTwins lints each witness as a .vibe file and, through the same rules and
// configuration, as its .ts twin, and returns the imported rules each reports.
func lintTwins(t testing.TB, keys []string) (vibe, ts map[string][]string) {
	t.Helper()
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if modules == "" {
		modules = "../../../../../experiments/node_modules"
	}
	effect, err := filepath.Abs(filepath.Join(modules, "effect"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(effect, "package.json")); err != nil {
		t.Skipf("effect is not installed: %v", err)
	}
	dir := t.TempDir()
	for _, sub := range []string{"node_modules", "vibe", "ts"} {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(effect, filepath.Join(dir, "node_modules", "effect")); err != nil {
		t.Fatal(err)
	}
	var enabled []string
	for _, r := range rules.All {
		if slices.Contains(lintRuleNames, r.Name) {
			enabled = append(enabled, `"`+rulePrefix+kebabCase(r.Name)+`":"error"`)
		}
	}
	files := map[string]string{
		"package.json":   `{"private":true,"type":"module"}`,
		"tsconfig.json":  `{"compilerOptions":{"target":"es2022","lib":["es2023","dom"],"module":"nodenext","moduleResolution":"nodenext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["vibe","ts"]}`,
		".oxlintrc.json": `{"rules":{` + strings.Join(enabled, ",") + `}}`,
	}
	var sources []string
	for _, key := range keys {
		for _, kind := range []struct{ sub, ext string }{{"vibe", ".vibe"}, {"ts", ".ts"}} {
			name := filepath.Join(kind.sub, key+kind.ext)
			files[name] = twinHeader + ruleWitnesses[key].text
			sources = append(sources, filepath.Join(dir, name))
		}
	}
	for name, text := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	config, err := LoadConfig(filepath.Join(dir, ".oxlintrc.json"))
	if err != nil {
		t.Fatal(err)
	}
	sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
	diags, skipped, err := lintProject(context.Background(), sys, filepath.Join(dir, "tsconfig.json"), sources, config)
	if err != nil || len(skipped) != 0 {
		t.Fatalf("lintProject: %v, skipped %v", err, skipped)
	}
	vibe, ts = map[string][]string{}, map[string][]string{}
	for _, key := range keys {
		vibe[key], ts[key] = []string{}, []string{}
	}
	for _, d := range diags {
		names := ruleNames(d)
		if d.File() == nil || len(names) != 1 {
			continue
		}
		base := filepath.Base(string(d.File().FileName()))
		key := strings.TrimSuffix(strings.TrimSuffix(base, ".vibe"), ".ts")
		if strings.HasSuffix(base, ".vibe") {
			vibe[key] = append(vibe[key], names[0])
		} else {
			ts[key] = append(ts[key], names[0])
		}
	}
	return vibe, ts
}

func witnessKeys() []string {
	var keys []string
	for key := range ruleWitnesses {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

// VIP-38: "a repo's lint script covers `.vibe` the same way it covers `.ts`",
// quoted by chapter 007 as "so its lint script covers `.vibe` as it covers
// `.ts`". toolcover-alchemy: Effect.succeed(undefined) in a .vibe file passed
// vibelang lint with effecttsgo/effect-succeed-with-void set to error.
func TestLintReportsAnsweredRulesInVibeFiles(t *testing.T) {
	keys := witnessKeys()
	vibe, ts := lintTwins(t, keys)
	for _, key := range keys {
		rule := ruleWitnesses[key].rule
		if !slices.Contains(vibe[key], rule) {
			t.Errorf("%s: %s does not fire on the .vibe file; reported %v", key, rule, vibe[key])
		}
		if !slices.Contains(ts[key], rule) {
			t.Errorf("%s: %s does not fire on the .ts twin; reported %v", key, rule, ts[key])
		}
	}
}

// A rule VibeLang ports reports once, through the port, not again as itself,
// and every other rule runs.
func TestLintDoesNotRunPortedRulesTwice(t *testing.T) {
	for _, r := range rules.All {
		ported := vibeAnswers[r.Name].ek != ""
		if ported == slices.Contains(lintRuleNames, r.Name) {
			t.Errorf("%s: ported %v, runs %v", r.Name, ported, !ported)
		}
	}
}

// A build keeps its rule set: only the lint command takes the wider one.
func TestBuildRulesAreUnchanged(t *testing.T) {
	for _, name := range []string{"effectSucceedWithVoid", "globalConsole", "floatingEffect"} {
		if slices.Contains(vibeRuleNames, name) {
			t.Errorf("a build runs %s on .vibe files", name)
		}
	}
}

// FuzzLintRulesMatchTypeScript compares the compiler with itself on two inputs
// the spec says must agree: for any selection of witnesses in one program, a
// rule reports on the .vibe file exactly when it reports on the .ts twin.
func FuzzLintRulesMatchTypeScript(f *testing.F) {
	keys := witnessKeys()
	f.Add(strings.Join(keys, ","))
	for _, key := range keys {
		f.Add(key)
	}
	f.Fuzz(func(t *testing.T, input string) {
		var chosen []string
		for _, part := range strings.Split(input, ",") {
			if _, ok := ruleWitnesses[part]; ok && !slices.Contains(chosen, part) {
				chosen = append(chosen, part)
			}
		}
		if len(chosen) == 0 {
			return
		}
		vibe, ts := lintTwins(t, chosen)
		for _, key := range chosen {
			a, b := slices.Sorted(slices.Values(vibe[key])), slices.Sorted(slices.Values(ts[key]))
			if !slices.Equal(a, b) {
				t.Errorf("%s: .vibe reports %v, .ts reports %v", key, a, b)
			}
		}
	})
}

func TestHelpIsTheLintHelpWithOrWithoutAConfiguration(t *testing.T) {
	bare, configured := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(configured, ".oxlintrc.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{bare, configured} {
		sys := &testSys{cwd: tspath.RootedDirectoryPathFromAbsolute(dir)}
		if status := Command(context.Background(), sys, []string{"--help"}); status != 0 || !strings.HasPrefix(sys.out.String(), "Usage: vibelang lint") {
			t.Errorf("%s: status %d\n%s", dir, status, sys.out.String())
		}
	}
}
