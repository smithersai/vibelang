package vibelangmapper

import (
	"strings"
	"testing"
)

// `: infer _` makes a function plain, with the return type TypeScript infers
// from its body. TypeScript has no such annotation: kept, it is TS1338 ('infer'
// declarations are only permitted in the 'extends' clause of a conditional
// type), which Oxc and tsc report on the rendering. Both renderings drop it.
func TestInferReturnContractIsErased(t *testing.T) {
	for _, source := range []string{
		"export const id = (n: number): infer _ => n",
		"export function twice(n: number): infer _ { return n * 2 }",
		"export const prefix = (p: string): infer _ => (s: string) => p + s",
		"export const run = { now(): infer _ { return 1 } }",
	} {
		for name, projection := range map[string]Projection{
			"projection": Project(source, testContext),
			"executable": Executable(source, testContext),
		} {
			if strings.Contains(projection.Text, "infer _") {
				t.Errorf("%s of %q keeps the infer _ return annotation:\n%s", name, source, projection.Text)
			}
			assertParses(t, projection.Text)
			assertValidMap(t, projection, source)
		}
	}
}
