package vibelang

import (
	"strings"
	"testing"
)

// A pipe whose body uses its topic once, after only stable values, compiles
// to its body with the left side where the topic stands (pipes_lower.go). No
// other mode exists: the topic is never passed by name (#413).
func TestPipeRetryEmitsSubstitutedCall(t *testing.T) {
	for _, tc := range []struct{ name, source, want string }{
		{"plain", `function load() { return 1 }
function retry(n: number, policy: number) { return n + policy }
const policy = 3
export function main() { return load() |> retry(%, policy) }
`, "return retry(load(), policy);"},
		{"effect", `effect function load(): number { return 1 }
function retry<A, E, R>(program: Effect.Effect<A, E, R>, policy: { times: number }) { return Effect.retry(program, policy) }
const policy = { times: 3 }
export effect function main() { return try (load() |> retry(%, policy)) }
`, "return yield* (retry(load(), policy));"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			program, _, _, _ := editorProgram(t, tc.source)
			js := emittedJS(t, program)
			var text string
			for _, out := range js {
				text += out
			}
			if !strings.Contains(text, tc.want) {
				t.Errorf("emit lacks %q:\n%s", tc.want, text)
			}
		})
	}
}
