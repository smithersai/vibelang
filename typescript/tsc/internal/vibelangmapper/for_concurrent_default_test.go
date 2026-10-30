package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestConcurrentDefaultLimitShadowRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	source := "export effect function scenario() { const undefined = 1; let active = 0, maximum = 0; for concurrent (const item of [1,2,3]) { active++; maximum = Math.max(maximum, active); try Effect.yieldNow; active-- } return maximum }"
	js, _, diagnostics := Emit(source, testContext)
	assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
	cmd := exec.Command(node, "--no-warnings", "--input-type=module")
	cmd.Dir = scope
	cmd.Stdin = strings.NewReader(js + "\nimport * as TestEffect from 'effect/Effect'; console.log(JSON.stringify(await TestEffect.runPromise(scenario())))")
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, js)
	assert.Equal(t, strings.TrimSpace(string(out)), "3")
}
