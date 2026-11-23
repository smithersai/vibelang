package vibelangmapper

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Effect arrows under reserved and quoted object keys lower, and tried
// member calls run them.
func TestRetryCalledObjectCallbacks(t *testing.T) {
	source := `export effect function scenario() {
 const handlers = {
 default: effect (n: number) => { try sleep("1 millis"); return n + 1 },
 "not-an-identifier": effect (n: number) => { try sleep("1 millis"); return n + 2 },
 arguments: effect (n: number) => { try sleep("1 millis"); return n + 3 },
 yield: effect (n: number) => { try sleep("1 millis"); return n + 4 }
 }; return [try handlers.default(1), try handlers["not-an-identifier"](1), try handlers.arguments(1), try handlers.yield(1)]
}`
	for _, projection := range []Projection{Project(source, testContext), Executable(source, testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatalf("%v\n%s", projection.Diagnostics, projection.Text)
		}
		for _, want := range []string{
			`default:        (n: number) => { return $gen(function* () {`,
			`"not-an-identifier":        (n: number) => { return $gen(function* () {`,
			`arguments:        (n: number) => { return $gen(function* () {`,
			`yield:        (n: number) => { return $gen(function* () {`,
			`$try(handlers["not-an-identifier"](1))`,
			`$try(handlers.yield(1))`,
		} {
			if !strings.Contains(projection.Text, want) {
				t.Fatalf("missing %s:\n%s", want, projection.Text)
			}
		}
	}
}

// D268 must leave known unbranded generic stages in their contextual position.
func TestD268PipeGenericStagesProjection(t *testing.T) {
	source, err := os.ReadFile("../../../vibelang/cases/pipe-generic-stages/main.vibe")
	if err != nil {
		t.Fatal(err)
	}
	for _, projection := range []Projection{Project(string(source), testContext), Executable(string(source), testContext)} {
		if len(projection.Diagnostics) != 0 {
			t.Fatal(projection.Diagnostics)
		}
		if strings.Contains(projection.Text, "$adapt(") {
			t.Fatal(projection.Text)
		}
		if !strings.Contains(projection.Text, "Match.exhaustive") {
			t.Fatal(projection.Text)
		}
	}
}

// The describe-shaped pipeline keeps contextual inference for
// Match.exhaustive rather than becoming unknown.
func TestD268UnbrandedGenericTypes(t *testing.T) {
	dir, stock := stockBuiltinProject(t)
	requireStockTypeScript(t, stock)
	source := `import { Match } from "effect"
const describe = pipe(Match.type<number | string>(), Match.when(Match.number, (n) => String(n)), Match.when(Match.string, (s) => s), Match.exhaustive)
export effect function main() { return { numbers: describe(1), strings: describe("a") } }`
	projection := Project(source, testContext)
	if len(projection.Diagnostics) != 0 {
		t.Fatal(projection.Diagnostics)
	}
	text := projection.Text + `
import type { Effect as Program } from "effect/Effect";
type Eq<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const describeExact: Eq<typeof describe, (u: string | number) => string> = true;
const describeCheck: (u: string | number) => string = describe;
const resultCheck: Program<{ numbers: string; strings: string }> = main();
`
	if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(text), 0600); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command(stock, "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "--target", "esnext", "--module", "nodenext", "main.ts")
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s\n%s", err, out, text)
	}
}
