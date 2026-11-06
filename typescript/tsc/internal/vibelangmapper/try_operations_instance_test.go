package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The private project copy must differ physically from the runtime dependency.
// Otherwise a helper that delegates to its own Effect copy passes accidentally.
func TestTryOperationsProjectEffectInstanceRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/try-operations-effect-instance/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	scope := mapperTestScope(t, root)
	text := string(source)
	js, _, diagnostics := Emit(text, testContext)
	if len(diagnostics) != 0 {
		t.Fatalf("diagnostics: %v\n%s", diagnostics, js)
	}
	dir := t.TempDir()
	if err := os.Symlink(filepath.Join(scope, "node_modules"), filepath.Join(dir, "node_modules")); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(dir, "app"), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "app/main.mjs"), []byte(js), 0600); err != nil {
		t.Fatal(err)
	}
	runner := `import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const source = path.dirname(path.dirname(require.resolve("effect/Effect")))
fs.mkdirSync(new URL("./app/node_modules/", import.meta.url), {recursive:true})
fs.cpSync(source, new URL("./app/node_modules/effect/", import.meta.url), {recursive:true})
const Effect = await import("./app/node_modules/effect/dist/Effect.js")
const {main} = await import("./app/main.mjs")
const result = await Effect.runPromiseExit(main())
assert.equal(result._tag, "Success")
assert.deepEqual(result.value, Array(13).fill(true))
`
	if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(runner), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "run.mjs")
	cmd.Dir = dir
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
	}
}
