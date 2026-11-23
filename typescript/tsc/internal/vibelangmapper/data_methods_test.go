package vibelangmapper

import (
	"fmt"
	"gotest.tools/v3/assert"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
)

// TestDynamicDataMethods checks opaque module values with stock TypeScript,
// including predicate narrowing, then executes the dispatch emitted for them.
func TestDynamicDataMethods(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	dir := t.TempDir()
	dataMethodTestDependencies(t, root, dir, stock)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte(`{"name":"vibelang-ts-mapper","type":"module","exports":{"./prelude":"./prelude.d.ts"}}`), 0600))
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	assert.NilError(t, err)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "prelude.d.ts"), prelude, 0600))
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "opaque.d.ts"), []byte(`import { Option, Effect, Exit } from "effect"; export const outcome: Exit.Exit<number>; export const maybe: Option.Option<number>; export const program: Effect.Effect<number>; export const own: { isSome(): Effect.Effect<boolean> };`), 0600))
	source := `import { maybe, program, own, outcome } from "./opaque.js"; export function f() { if (maybe.isSome()) { const n: number = maybe.value; return n } return 0 }
export function keepExit() { return sync((): Exit.Exit<number> => Exit.map(outcome, (n): number => n + 1)) }
export function negativeGuard() { if (maybe.isNone()) return 0; const n: number = maybe.value; return n }
export function effectGuard() { return Effect.isSuccess(program) }
export function ownGuard() { return own.isSome() }`
	projection := Project(source, testContext)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text+`
import type { Effect as EffectType } from "effect"; const effectCheck: EffectType.Effect<boolean> = effectGuard(); const ownCheck: EffectType.Effect<boolean> = ownGuard();
import { Effect as EffectModule } from "effect"; const retryProbe = EffectModule.retry(EffectModule.succeed(1), { times: 1 });
// @ts-expect-error D152 does not expose Effect-only methods on Exit.
outcome.flatMap((n: number) => EffectModule.succeed(n));`), 0600))
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	js, _, ds := Emit(source, testContext)
	assert.Equal(t, len(ds), 0)
	assert.Assert(t, strings.Contains(js, `$method(maybe, "isSome", [], $methodCandidates_isSome)`), "%s", js)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "opaque.js"), []byte(`import { Option, Effect, Exit } from "effect"; export const outcome = Exit.succeed(2); export const maybe = Option.some(42); export const program = Effect.succeed(7); export let ownCalls = 0; export const own = { isSome() { ownCalls++; return Effect.succeed(false) } };`), 0600))
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.mjs"), []byte(js+"\n"+`import * as RunEffect from "effect/Effect"; import { ownCalls } from "./opaque.js"; console.log(JSON.stringify([f(), await RunEffect.runPromise(effectGuard()), await RunEffect.runPromise(ownGuard()), ownCalls, (await RunEffect.runPromise(keepExit())).value]))`), 0600))
	cmd = exec.Command("node", "--no-warnings", "main.mjs")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	assert.Equal(t, strings.TrimSpace(string(out)), "[42,true,false,1,3]")
}

// TestDataMethodAccessRequiresCall keeps augmentation from accepting accesses
// that execution cannot implement, while native array members remain values.
func TestDataMethodAccessRequiresCall(t *testing.T) {
	for _, source := range []string{
		`function f(o: Option.Option<number>) { return o.map }`,
		`function f(o: Option.Option<number>) { return o?.isSome() }`,
	} {
		got := Project(source, testContext)
		assert.Equal(t, len(got.Diagnostics), 1, "%s", got.Text)
	}
	got := Project(`function f(xs: number[]) { return xs.map }`, testContext)
	assert.Equal(t, len(got.Diagnostics), 0, "%v", got.Diagnostics)
}

// currentRuntime is packages/runtime compiled from its current sources, once
// per test binary; TestMain removes it.
var currentRuntime struct {
	sync.Once
	path string
	err  error
}

// dataMethodTestDependencies uses the current runtime sources and pinned Effect,
// so execution tests depend neither on an earlier parity run's package copy nor
// on a packages/runtime/dist that a fresh checkout doesn't have.
func dataMethodTestDependencies(t *testing.T, root, dir, stock string) {
	t.Helper()
	effect := filepath.Join(root, "packages/runtime/node_modules/effect")
	currentRuntime.Do(func() { currentRuntime.err = buildCurrentRuntime(root, effect, stock) })
	assert.NilError(t, currentRuntime.err)
	modules := filepath.Join(dir, "node_modules")
	assert.NilError(t, os.MkdirAll(modules, 0700))
	for name, target := range map[string]string{
		"effect":           effect,
		"vibelang-runtime": currentRuntime.path,
	} {
		assert.NilError(t, os.Symlink(target, filepath.Join(modules, name)))
	}
}

// buildCurrentRuntime compiles packages/runtime with stock TypeScript into a
// temporary package that resolves the same Effect.
func buildCurrentRuntime(root, effect, stock string) error {
	pkg, err := os.MkdirTemp("", "vibelang-data-methods-runtime-")
	if err != nil {
		return err
	}
	currentRuntime.path = pkg
	runtime := filepath.Join(root, "packages/runtime")
	manifest, err := os.ReadFile(filepath.Join(runtime, "package.json"))
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(pkg, "package.json"), manifest, 0600); err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Join(pkg, "node_modules"), 0700); err != nil {
		return err
	}
	if err := os.Symlink(effect, filepath.Join(pkg, "node_modules/effect")); err != nil {
		return err
	}
	if out, err := exec.Command(stock, "-p", filepath.Join(runtime, "tsconfig.json"), "--outDir", filepath.Join(pkg, "dist")).CombinedOutput(); err != nil {
		return fmt.Errorf("build packages/runtime: %w: %s", err, out)
	}
	return nil
}
