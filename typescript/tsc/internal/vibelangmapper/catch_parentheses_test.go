package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// The editor projection must type the handler, and executable output must
// invoke it without leaving its closing source parentheses.
func TestParenthesizedCatchHandlersInBothRenderings(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	stock := stockTypeScriptPath(t, root)
	requireStockTypeScript(t, stock)
	source, err := os.ReadFile(filepath.Join(root, "typescript/vibelang/cases/catch-handler-parentheses/main.vibe"))
	assert.NilError(t, err)
	text := "import { Effect } from \"effect\";\n" + string(source)
	projection := Project(text, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	js, _, diagnostics := Emit(text, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)

	dir := t.TempDir()
	dataMethodTestDependencies(t, root, dir, stock)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "package.json"), []byte("{\"name\":\"vibelang-ts-mapper\",\"type\":\"module\",\"exports\":{\"./prelude\":\"./prelude.d.ts\"}}"), 0600))
	prelude, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/prelude.d.ts"))
	assert.NilError(t, err)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "prelude.d.ts"), prelude, 0600))
	runner := "\nimport * as RunEffect from \"effect/Effect\";\nconsole.log(JSON.stringify(await RunEffect.runPromise(main())));\n"
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "project.ts"), []byte(projection.Text+runner), 0600))
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "nodenext", "project.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, projection.Text)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "emit.mjs"), []byte(js+runner), 0600))
	cmd = exec.Command("node", "--no-warnings", "emit.mjs")
	cmd.Dir = dir
	out, err = cmd.CombinedOutput()
	assert.NilError(t, err, "%s", out)
	assert.Equal(t, strings.TrimSpace(string(out)), "[2,7,8,9,[\"xx\"]]")
}
