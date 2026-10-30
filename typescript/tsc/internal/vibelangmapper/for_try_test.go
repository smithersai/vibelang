package vibelangmapper

import (
	"gotest.tools/v3/assert"
	"os/exec"
	"strings"
	"testing"
)

func TestForTryProjection(t *testing.T) {
	source := `effect function main(rows: Stream.Stream<number>) { let sum = 0; for try (const x of rows) { if (x === 1) continue; if (x === 3) break; sum += x }; return sum }`
	p := Project(source, testContext)
	assert.Equal(t, len(p.Diagnostics), 0, "%v", p.Diagnostics)
	assertParses(t, p.Text)
	assert.Assert(t, strings.Contains(p.Text, "$eachStream(rows)"), "%s", p.Text)
	e := Executable(source, testContext)
	assert.Equal(t, len(e.Diagnostics), 0, "%v", e.Diagnostics)
	assertParses(t, e.Text)
	assert.Assert(t, strings.Contains(e.Text, "runForEachWhile"), "%s", e.Text)
	assert.Assert(t, !strings.Contains(e.Text, "isStream"), "%s", e.Text)
}

func TestForTryControlDiagnostics(t *testing.T) {
	for _, c := range []struct {
		source string
		code   int32
	}{
		{`for try (const x of rows) {}`, 2001},
		{`effect function main() { for try (const x of rows) { return x } }`, 2002},
		{`effect function main() { outer: for (const x of [1]) { for try (const y of rows) { continue outer } } }`, 2003},
		{`effect function main() { let x = 0; for try (x of rows) {} }`, 2005},
		{`effect function main() { for try (var x of rows) {} }`, 2005},
	} {
		p := Project(c.source, testContext)
		assert.Equal(t, len(p.Diagnostics), 1, "%v", p.Diagnostics)
		assert.Equal(t, p.Diagnostics[0].Code, c.code)
	}
}

func TestForTryBindingDefaults(t *testing.T) {
	source := `effect function main(rows: Stream.Stream<number[]>) { for try (let [value = try load()] of rows) { value += 1 } }`
	e := Executable(source, testContext)
	assert.Equal(t, len(e.Diagnostics), 0, "%v", e.Diagnostics)
	assertParses(t, e.Text)
	assert.Assert(t, strings.Contains(e.Text, "let [value ="), "%s", e.Text)
	assert.Assert(t, !strings.Contains(e.Text, "try load"), "%s", e.Text)
}

func TestForTryOwnLabels(t *testing.T) {
	for _, source := range []string{
		`effect function main(rows: Stream.Stream<number>) { again: for try (const x of rows) { if (x === 1) continue again; break again } }`,
		`effect function main(rows: Stream.Stream<number>) { outer: inner: for try (const x of rows) { if (x === 1) continue outer; break inner } }`,
	} {
		p := Project(source, testContext)
		assert.Equal(t, len(p.Diagnostics), 0, "%v", p.Diagnostics)
		e := Executable(source, testContext)
		assert.Equal(t, len(e.Diagnostics), 0, "%v", e.Diagnostics)
		assertParses(t, e.Text)
		js, _, diagnostics := Emit(source, testContext)
		assert.Equal(t, len(diagnostics), 0, "%v", diagnostics)
		if node, err := exec.LookPath("node"); err == nil {
			cmd := exec.Command(node, "--check", "--input-type=module")
			cmd.Stdin = strings.NewReader(js)
			output, err := cmd.CombinedOutput()
			assert.NilError(t, err, "%s\n%s", output, js)
		}
	}
}
