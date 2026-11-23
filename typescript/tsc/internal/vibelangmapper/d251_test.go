package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// TestD251StaticDataBoundary checks opaque declarations with stock TypeScript:
// identical runtime Exits must be distinguished by their declared types.
func TestD251StaticDataBoundary(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	dir := t.TempDir()
	assert.NilError(t, os.Symlink(filepath.Join(scope, "node_modules"), filepath.Join(dir, "node_modules")))
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`), 0600))
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	assert.NilError(t, err)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "prelude.d.ts"), prelude, 0600))
	helper := `import { Effect, Exit, Config, Context, Cause } from "effect";
export function config(name = "MISSING"): Config.Config<string> { return Config.orElse(Config.String(name), () => Config.succeed("no " + name)) }
export const service = Context.Service<{ value: number }>("d254");
export function key(): typeof service { return service }
export function error(): Error { return new Error("data") }
export function foreign(): Cause.YieldableError { throw new Error("runtime helper replaces this") }
export function data(): Exit.Exit<number> { return Exit.succeed(42) }
export function program(): Effect.Effect<number> { return Exit.succeed(42) }`
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "helper.ts"), []byte(helper), 0600))
	source := `import { data, program, config, key, error, foreign } from "./helper.js";
export effect function replayed() { return try data() }
export effect function good() { return try program() }
export effect function kept() { return try sync((): Exit.Exit<number> => data()) }
export effect function resumed() { return try Effect.callback<number>((resume): void => { resume(Exit.succeed(9)) }) }
export effect function generic<T>(x: T) { return x }
export effect function configData() { return config() }
export effect function configRead() { return try config("MISSING") }
export effect function keyData() { return key() }
export effect function errorData() { return error() }
export effect function foreignData() { return foreign() }`
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assert.Assert(t, strings.Contains(projection.Text, "$run($try(data()))"), "%s", projection.Text)
	assert.Assert(t, strings.Contains(projection.Text, "resume(Exit.succeed(9))"), "%s", projection.Text)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text+`
import { $run as runProbe, $gen as genProbe } from "./prelude.js"; export function genericRun<T>(x: T) { return runProbe(x) }
export function optional<T>(x: T | undefined) { return runProbe(x) }
import { Config, Context, Cause } from "effect";
declare const probeConfig: Config.Config<number>;
declare const probeKey: Context.Key<{}, {}>;
declare const probeError: Cause.YieldableError;
declare const mixed: Exit.Exit<number> | number;
export function configProbe() { return genProbe(function* () { return yield* runProbe(probeConfig) }) }
export function keyProbe() { return genProbe(function* () { return yield* runProbe(probeKey) }) }
export function errorProbe() { return genProbe(function* () { return yield* runProbe(probeError) }) }
function mixedProbe() { return genProbe(function* () { return yield* runProbe(mixed) }) }`), 0600))
	cmd := exec.Command(stock, "--ignoreConfig", "--declaration", "--emitDeclarationOnly", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	assert.Assert(t, err != nil, "%s", out)
	assert.Assert(t, strings.Contains(string(out), "sync((): Exit.Exit<A, E>"), "%s", out)
	// try runs an Exit (VIP-5), so only the raw mixed union keeps the D251 annotation error.
	assert.Equal(t, strings.Count(string(out), "error TS"), 1, "%s", out)
	declarations, err := os.ReadFile(filepath.Join(dir, "main.d.ts"))
	assert.NilError(t, err)
	assert.Assert(t, strings.Contains(string(declarations), "generic<T>(x: T): Effect.Effect<T, never, never>"), "%s", declarations)
	assert.Assert(t, strings.Contains(string(declarations), "genericRun<T>(x: T): Effect.Effect<T, never, never>"), "%s", declarations)
	assert.Assert(t, strings.Contains(string(declarations), "optional<T>(x: T | undefined): Effect.Effect<T | undefined, never, never>"), "%s", declarations)
	for _, want := range []string{
		"configProbe(): Effect.Effect<Config.Config<number>, never, never>",
		"keyProbe(): Effect.Effect<Context.Key<{}, {}>, never, never>",
		"errorProbe(): Effect.Effect<Cause.YieldableError, never, never>",
	} {
		assert.Assert(t, strings.Contains(string(declarations), want), "%s", declarations)
	}
	js, _, ds := Emit(source, testContext)
	assert.Equal(t, len(ds), 0, "%v", ds)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.mjs"), []byte(js+`
import { configValue, keyValue } from "./helper.js";
console.log(JSON.stringify([await Effect.runPromise(replayed()), await Effect.runPromise(good()), (await Effect.runPromise(kept())).value, await Effect.runPromise(resumed()), await Effect.runPromise(configRead()), (await Effect.runPromise(configData())) === configValue, (await Effect.runPromise(keyData())) === keyValue, (await Effect.runPromise(errorData())).message, (await Effect.runPromise(foreignData())).message]))`), 0600))
	// The helper's annotations erase to the same constructor at runtime.
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "helper.js"), []byte(`import { Exit, Config, Context, Data } from "effect";
import vm from "node:vm";
export const data = () => Exit.succeed(42); export const program = data;
export const configValue = Config.orElse(Config.String("D254_MISSING"), () => Config.succeed("fallback")); export const config = () => configValue;
export const keyValue = Context.Service("d254"); export const key = () => keyValue;
export const error = () => new Error("data");
const foreignError = vm.runInNewContext('new (class YieldableError extends Error {})("foreign")');
// Copy Effect's YieldableError protocol onto the foreign Error subclass,
// preserving its foreign Error prototype and therefore its realm identity.
Object.assign(Object.getPrototypeOf(foreignError), Object.getPrototypeOf(Object.getPrototypeOf(new Data.Error())));
if (foreignError instanceof Error || !("~effect/Effect" in foreignError) || foreignError["~effect/Effect/identifier"] !== "YieldableError") throw new Error("expected a foreign YieldableError");
export const foreign = () => foreignError;`), 0600))
	cmd = exec.Command("node", "--no-warnings", "main.mjs")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	assert.Equal(t, strings.TrimSpace(string(out)), `[42,42,42,9,"fallback",true,true,"data","foreign"]`)
}

// TestD251ProjectionGolden keeps the static boundary in checking output and
// preserves the explicitly plain D43 registration body without run edits.
func TestD251ProjectionGolden(t *testing.T) {
	source := `import { data } from "./helper.js"; effect function f() { return try data() } effect function g() { return try Effect.callback<number>((resume): void => { resume(Exit.succeed(9)) }) }`
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0)
	assert.Equal(t, virtualBody(t, projection), `import { data } from "./helper.js";        function f() { return $gen(function* () { return     (yield* $run($try(data()))) })}        function g() { return $gen(function* () { return     (yield* $run($try(Effect.callback<number>((resume): void => { resume(Exit.succeed(9)) })))) })}`)
}

// TestD254DataProjectionGolden keeps opaque D24 data calls in the same run
// positions as programs so the prelude and runtime make the same decision.
func TestD254DataProjectionGolden(t *testing.T) {
	for _, name := range []string{"config", "key", "error", "foreign"} {
		t.Run(name, func(t *testing.T) {
			source := "import { " + name + " } from \"./helper.js\"; effect function f() { return try " + name + "() }"
			projection := Project(source, testContext)
			assert.Equal(t, len(projection.Diagnostics), 0)
			assert.Equal(t, virtualBody(t, projection), "import { "+name+" } from \"./helper.js\";        function f() { return $gen(function* () { return     (yield* $run($try("+name+"()))) })}")
		})
	}
}
