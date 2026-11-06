package vibelangmapper

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// The private project copy must differ physically from the runtime dependency.
// Otherwise a helper that delegates to its own Effect copy passes accidentally.
func TestConcurrentProjectEffectInstanceRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/concurrent-effect-instance/main.vibe"))
	if err != nil {
		t.Fatal(err)
	}
	// Use native fork and join calls to isolate the traversal's allocation
	// from the mapper's independent support for the keyword forms.
	textSource := strings.NewReplacer(
		"Effect as Eff }", "Effect as Eff, Fiber as Fib }",
		"fork effect {", "try Eff.forkChild(effect {",
		"fork Eff.succeed(0)", "try Eff.forkChild(Eff.succeed(0))",
		"join child", "try Fib.join(child)",
		"\n  }\n  const seen = join anchor", "\n  })\n  const seen = try Fib.join(anchor)",
		"\n  }\n  return join anchor", "\n  })\n  return try Fib.join(anchor)",
	).Replace(string(source))
	scope := mapperTestScope(t, root)
	for _, limit := range []string{"", "1", "2", "2.5", "NaN", "\"unbounded\"", "undefined as any", "null as any"} {
		t.Run(fmt.Sprintf("limit-%s", limit), func(t *testing.T) {
			text := textSource
			bound := ""
			if limit != "" {
				bound = "(" + limit + ")"
			}
			text = strings.Replace(text, "for concurrent(2)", "for concurrent"+bound, 1)
			if limit == "1" || strings.Contains(limit, "as any") {
				text = strings.Replace(text, "owner < current", "owner === current", 1)
			}
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
assert.deepEqual(result.value, Array(33).fill(true))
`
			if err := os.WriteFile(filepath.Join(dir, "run.mjs"), []byte(runner), 0600); err != nil {
				t.Fatal(err)
			}
			cmd := exec.CommandContext(t.Context(), "node", "--no-warnings", "run.mjs")
			cmd.Dir = dir
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("runtime: %v\n%s\n%s", err, output, js)
			}
		})
	}
}
