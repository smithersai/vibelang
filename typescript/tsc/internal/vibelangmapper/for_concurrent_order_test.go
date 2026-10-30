package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestConcurrentHeadOrderRuntime(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	assert.NilError(t, err)
	scope := mapperTestScope(t, root)
	node, err := exec.LookPath("node")
	assert.NilError(t, err)
	cases := []struct{ name, source, expected string }{
		{"direct", "export effect function scenario() { const log = []; const xs = [1,2]; for concurrent ((log.push('limit'), 1)) (const item of (log.push('items'), xs)) { log.push(item) } return log }", "[\"limit\",\"items\",1,2]"},
		{"suspending heads", "export effect function scenario() { const log = []; const xs = [1,2]; for concurrent ((log.push('limit'), try Effect.succeed(1))) (const item of (log.push('items'), try Effect.succeed(xs))) { log.push(item) } return log }", "[\"limit\",\"items\",1,2]"},
		{"unbraced conditional", "export effect function scenario() { const log = []; const xs = [1,2]; if (true) for concurrent ((log.push('limit'), 1)) (const item of (log.push('items'), xs)) log.push(item); else log.push('wrong'); return log }", "[\"limit\",\"items\",1,2]"},
		{"repeated hygienic names", "export effect function scenario() { const log = []; const $concurrency = 'user'; for (const j of [1,2]) { for concurrent ((log.push('limit'+j), 1)) (const item of (log.push('items'+j), [j])) log.push(item) } return { log, kept: $concurrency } }", "{\"log\":[\"limit1\",\"items1\",1,\"limit2\",\"items2\",2],\"kept\":\"user\"}"},
		{"skipped conditional", "export effect function scenario() { const log = []; if (false) for concurrent ((log.push('limit'), 1)) (const item of (log.push('items'), [1])) log.push(item); else log.push('skipped'); return log }", "[\"skipped\"]"},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			js, _, diagnostics := Emit(tt.source, testContext)
			assert.Equal(t, len(diagnostics), 0, "%v\n%s", diagnostics, js)
			cmd := exec.Command(node, "--no-warnings", "--input-type=module")
			cmd.Dir = scope
			cmd.Stdin = strings.NewReader(js + "\nimport * as TestEffect from 'effect/Effect'; console.log(JSON.stringify(await TestEffect.runPromise(scenario())))")
			out, err := cmd.CombinedOutput()
			assert.NilError(t, err, "%s\n%s", out, js)
			assert.Equal(t, strings.TrimSpace(string(out)), tt.expected)
		})
	}
}
