package vibelang

import (
	"slices"
	"strings"
	"testing"

	"gotest.tools/v3/assert"
)

// TestMissingEffectReportsEffectFunctions compiles a program in which neither
// effect nor vibelang-runtime resolves. Each Effect function, an unannotated
// one whatever its body does (D500) and a producer, is EK1011. A function with
// a plain annotation keeps its plain behavior and is not reported.
func TestMissingEffectReportsEffectFunctions(t *testing.T) {
	t.Parallel()
	source := `export const make = (name: string) => {
  if (name === "") throw new TypeError("empty")
  return { name }
}
export function greet(name: string) {
  return "hello " + name
}
export const count = function* () {
  yield 1
}
export function shout(name: string): string {
  return name.toUpperCase()
}
`
	p := computedKeyProgram(t, map[string]string{
		"/Users/x/src/package.json":  `{"type":"module"}`,
		"/Users/x/src/tsconfig.json": `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","declaration":true,"types":[]},"files":["main.vibe"]}`,
		"/Users/x/src/main.vibe":     source,
	})
	var reported []string
	for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
		if d.Code() == EK1011.Code {
			reported = append(reported, source[d.Pos():d.End()])
		}
	}
	slices.Sort(reported)
	assert.DeepEqual(t, reported, []string{"count", "greet", "make"})
}

// Effect 3 resolves normally, but its dist/dts layout cannot supply the
// Effect 4 interface. Advice must identify the incompatible install, including
// when only the implicit prelude resolves effect.
func TestUnsupportedEffectReportsInstalledVersion(t *testing.T) {
	t.Parallel()
	for _, prefix := range []string{"", "import { Effect } from \"effect\"\n"} {
		t.Run(prefix, func(t *testing.T) {
			p := computedKeyProgram(t, map[string]string{
				"/Users/x/src/package.json":                             `{"type":"module"}`,
				"/Users/x/src/tsconfig.json":                            `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe"]}`,
				"/Users/x/src/main.vibe":                                prefix + `export function fail() { throw new Error("bad") }`,
				"/Users/x/src/node_modules/effect/package.json":         `{"name":"effect","version":"3.19.0","type":"module","exports":{".":{"types":"./dist/dts/index.d.ts"},"./Effect":{"types":"./dist/dts/Effect.d.ts"}}}`,
				"/Users/x/src/node_modules/effect/dist/dts/index.d.ts":  `export * as Effect from "./Effect.js"`,
				"/Users/x/src/node_modules/effect/dist/dts/Effect.d.ts": `export interface Effect<A, E = never, R = never> { readonly _A: A; readonly _E: E; readonly _R: R }`,
			})
			found := false
			for _, d := range p.GetSemanticDiagnostics(t.Context(), nil) {
				if d.Code() != EK1011.Code {
					continue
				}
				found = true
				text := diagnosticWithNotes(d)
				for _, want := range []string{"effect@3.19.0", "effect@4.1.0"} {
					if !strings.Contains(text, want) {
						t.Errorf("missing %s in diagnostic: %s", want, text)
					}
				}
				if strings.Contains(text, "Install effect where this file can resolve it") {
					t.Errorf("resolved Effect must not be diagnosed as missing: %s", text)
				}
			}
			if !found {
				t.Fatal("expected EK1011 for unsupported Effect")
			}
		})
	}
}
