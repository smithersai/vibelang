package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// TestD252RegressionCallbackContext checks that a guarded native member call
// keeps the callback's contextual type even when the receiver is textually opaque.
func TestD252RegressionCallbackContext(t *testing.T) {
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
	source := `function interrupted(exit: Exit.Exit<string> | undefined) {
 return exit !== undefined && exit._tag === "Failure" && exit.cause.reasons.some((reason) => reason._tag === "Interrupt")
}`
	projection := Project(source, testContext)
	assert.Equal(t, len(projection.Diagnostics), 0, "%v", projection.Diagnostics)
	assert.Assert(t, strings.Contains(projection.Text, `exit.cause.reasons.some((reason) => reason._tag === "Interrupt")`), "%s", projection.Text)
	assert.NilError(t, os.WriteFile(filepath.Join(dir, "main.ts"), []byte(projection.Text), 0600))
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--skipLibCheck", "--strict", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	assert.NilError(t, err, "%s\n%s", out, projection.Text)
	executable := Executable(source, testContext)
	assert.Assert(t, strings.Contains(executable.Text, `$method(exit.cause.reasons, "some", [`), "%s", executable.Text)
}

// TestD252RegressionNullableOptionalChain retains D152's error for a nullable
// data receiver, while nullable native arrays keep their JavaScript methods.
func TestD252RegressionNullableOptionalChain(t *testing.T) {
	source, err := os.ReadFile("../../../vibelang/cases/methods-optional-chain.fail/main.vibe")
	assert.NilError(t, err)
	assert.Assert(t, strings.Contains(string(source), "expect: TS2339"))
	for _, source := range []string{string(source),
		`function f(o: Option.Option<number> | null) { return o?.isSome() }`,
		`type Maybe = Option.Option<number> | undefined; function f(o: Maybe) { return o?.isSome() }`,
	} {
		projection := Project(source, testContext)
		assert.Equal(t, len(projection.Diagnostics), 1, "%s", projection.Text)
		assert.Assert(t, strings.Contains(projection.Diagnostics[0].Message, "optional chaining"), "%v", projection.Diagnostics)
	}
	native := Project(`function f(xs: readonly number[] | undefined) { return xs?.map((n) => n + 1) }`, testContext)
	assert.Equal(t, len(native.Diagnostics), 0, "%v", native.Diagnostics)
}

// TestD252RegressionBareMethodBlock pins the checking and executable spellings
// of a bare block without consuming its brace or losing its form diagnostic.
func TestD252RegressionBareMethodBlock(t *testing.T) {
	source := `import { lines } from "./opaque.js"; const audited = lines.ensuring { log("released"); log("finished") }`
	projection := Project(source, testContext)
	assert.Equal(t, virtualBody(t, projection), `import { lines } from "./opaque.js"; const audited = lines.ensuring ($dual($gen(function* () { ;(yield* $run(log("released"))); ;(yield* $run(log("finished"))) })))`)
	assert.Equal(t, len(projection.Diagnostics), 1, "%v", projection.Diagnostics)
	assert.Equal(t, projection.Diagnostics[0].Code, int32(CodeFormChoice))
	assertParses(t, projection.Text)
	assertValidMap(t, projection, source)
	executable := Executable(source, testContext)
	assertParses(t, executable.Text)
	_, body, ok := strings.Cut(executable.Text, "\n")
	assert.Assert(t, ok)
	assert.Equal(t, body, `import { lines } from "./opaque.js"; const audited = $method(lines, "ensuring", [ $dual($gen(function* () { ;(($t = log("released")), $isRun($t) ? (yield* $t) : $t); ;(($t = log("finished")), $isRun($t) ? (yield* $t) : $t) }))], $methodCandidates_ensuring)`)
	// This is the complete third block that the docs census materializes.
	page, err := os.ReadFile("../../../../docs/user/src/stream/058-resourceful-streams.md")
	assert.NilError(t, err)
	blocks := strings.Split(strings.ReplaceAll(string(page), "```vibe\n", "```ts\n"), "```ts\n")
	assert.Assert(t, len(blocks) > 3)
	block, _, ok := strings.Cut(blocks[3], "```")
	assert.Assert(t, ok)
	// The page now shows the VIP language, which the census skips until the
	// compiler implements the VIPs its pending line names.
	if strings.Contains(block, "// pending: VIP-") {
		return
	}
	projected := Project("import { lines } from \"./opaque.js\";\n"+block, testContext)
	assertParses(t, projected.Text)
	for _, d := range projected.Diagnostics {
		assert.Equal(t, d.Code, int32(CodeFormChoice), "%v", projected.Diagnostics)
	}
}
