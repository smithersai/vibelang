package vibelangfuzz

import (
	"strings"
	"testing"
)

// The Tokens and Units rules apply when a lexical read moves into a capture.
func TestSourceMapCapturedNewTarget(t *testing.T) {
	TestSourceMapRulesCited(t)
	w := NewWorkspace(t)
	for name, source := range map[string]string{
		"function":          "export effect function captured(): unknown!! { return new.target }\n",
		"region":            "export effect function captured(): number!! {\n  let value = 0\n  uninterruptible { value = new.target === undefined ? 1 : 2 }\n  return value\n}\n",
		"block":             "export function captured(): Effect.Effect<unknown> { return effect { return new.target } }\n",
		"constructor-arrow": "export class Captured {\n  readonly read: () => unknown!!\n  constructor() { this.read = effect () => new.target }\n}\n",
	} {
		t.Run(name, func(t *testing.T) {
			c, err := w.CompileOrdered(t.Context(), withSourceMaps(Single(source)), OrderTsc, true)
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			if c.Program == nil || HasError(withoutEffectLint(c.Diagnostics)) {
				t.Fatalf("source-map control must compile: %v", SortedKeys(Keys(c.Dir, c.Diagnostics)))
			}
			hasMap := false
			for filename := range c.Outputs {
				hasMap = hasMap || strings.HasSuffix(filename, ".js.map")
			}
			if !hasMap {
				t.Fatal("source-map control emitted no JavaScript map")
			}
			for _, variant := range sourceMapVariants {
				t.Run(variant.key, func(t *testing.T) {
					checkSourceMapTokens(t, w, source, variant.key)
				})
			}
		})
	}
}
