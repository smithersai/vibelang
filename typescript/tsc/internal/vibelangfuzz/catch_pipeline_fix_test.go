package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

// The shared migration oracle compares native TypeScript and repaired
// declarations, outcomes, comments and repeated repairs.
func TestCatchPipelineFixQuoted(t *testing.T) {
	catchPipelineFixQuoted(t)
}

func catchPipelineFixQuoted(t testing.TB) {
	if !strings.Contains(SpecText("007-tooling.md"), catchScopeFixQuote) {
		t.Fatalf("Chapter 7 no longer says %q", catchScopeFixQuote)
	}
}

func catchPipelineFixSources() map[string]string {
	result := map[string]string{}
	for _, position := range []string{"returned", "middle"} {
		for _, newline := range []string{"lf", "crlf"} {
			stages := "Effect.map((x) => x + 1), Effect.catch((e) => Effect.succeed(e.length))"
			if position == "middle" {
				stages = "Effect.catch((e) => Effect.succeed(e.length)), Effect.map((x) => x + 1)"
			}
			source := `import { Effect } from "effect"
let made = 0
let ran = 0
function p(n: number) {
  made++
  return Effect.sync(() => { ran++; return n }).pipe(
    Effect.flatMap((x) => x < 0 ? Effect.fail("bad") : Effect.succeed(x))
  )
}
export const f = (n: number) => p(n).pipe(` + stages + `)
export const main = () => Effect.gen(function* () {
  // Construct twice, then run one of the same programs twice.
  const first = f(4)
  const second = f(-1)
  const counts = [made, ran]
  const values = [yield* first, yield* second, yield* first]
  return { counts, values, made, ran }
})
`
			if newline == "crlf" {
				source = strings.ReplaceAll(source, "\n", "\r\n")
			}
			result[position+"-"+newline] = source
		}
	}
	return result
}

// The shared mutation oracle may discard invalid mutated programs, but none
// of these retained regression witnesses may be invalid or fail to execute.
func TestCatchPipelineNativeControls(t *testing.T) {
	catchPipelineFixQuoted(t)
	w := NewWorkspace(t)
	node, err := NewNode(w.Dir)
	if err != nil {
		t.Fatal(err)
	}
	defer node.Close()
	for key, source := range catchPipelineFixSources() {
		t.Run(key, func(t *testing.T) {
			reference := toolsCompile(t, w, "FuzzCatchPipelineFix", map[string]string{"main.ts": source})
			defer reference.Remove()
			if !toolsErrorFree(reference) {
				t.Fatalf("invalid native control: %v", SortedKeys(Keys(reference.Dir, reference.Diagnostics)))
			}
			outcome := node.Run(reference, "out/main.js", "main")
			fallback := 3
			if strings.HasPrefix(key, "middle") {
				fallback = 4
			}
			want := fmt.Sprintf("{\"counts\":[2,0],\"values\":[5,%d,5],\"made\":2,\"ran\":3}", fallback)
			if toolsInvalidOutcome(outcome) || string(outcome.Value) != want {
				t.Fatalf("native control: %+v; want %s", outcome, want)
			}
		})
	}
}
