package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"
)

const matchThrowContextsTarget = "FuzzMatchThrowContexts"

// VIP-4 quotes Will's synchronous no-throw ruling. VIP-7 supplies the async
// boundary; the Effect counterpart supplies the effect-body behavior.
var matchThrowContextQuotes = []struct{ chapter, quote string }{
	{"../vips/0004-throw.md", "If you throw in vibelang itself in a sync function that's an error."},
	{"../vips/0007-match.md", "a thrown exception rejects the Promise"},
	{"003-failures.md", "return yield* Effect.fail(e)"},
}

func TestMatchThrowContextsQuoted(t *testing.T) {
	for _, rule := range matchThrowContextQuotes {
		chapterSays(t, rule.chapter, rule.quote)
	}
}

type matchThrowContext struct {
	key, source string
	reject      bool
}

func matchThrowContexts() []matchThrowContext {
	const arm = `match (flag) { when true: 1; default: throw "missing"; }`
	const asyncArm = `async match (flag) { when true: 1; default: throw "missing"; }`
	return []matchThrowContext{
		{"plain-function", "export function probe(flag: boolean) { return " + arm + " }", true},
		{"plain-arrow", "export const probe = (flag: boolean) => " + arm, true},
		{"plain-method", "export class Probe { run(flag: boolean) { return " + arm + " } }", true},
		{"plain-in-effect", "export effect function probe(flag: boolean) { const local = () => " + arm + "; return 1 }", true},
		{"plain-in-async", "export async function probe(flag: boolean) { const local = () => " + arm + "; return 1 }", true},
		{"plain-in-async-match", "export function probe(flag: boolean) { return async match (flag) { default: (() => " + arm + ")(); } }", true},
		{"effect-function", "export effect function probe(flag: boolean) { return " + arm + " }", false},
		{"effect-block", "export const probe = (flag: boolean) => effect { return " + arm + " }", false},
		{"async-function", "export async function probe(flag: boolean) { return " + arm + " }", false},
		{"async-match", "export function probe(flag: boolean) { return " + asyncArm + " }", false},
	}
}

// Static placement only: vary callable boundaries, trivia and identifier
// spelling. Runtime behavior remains in the ordinary compiler case.
func FuzzMatchThrowContexts(f *testing.F) {
	startShortBudget(f)
	for _, rule := range matchThrowContextQuotes {
		chapterSays(f, rule.chapter, rule.quote)
	}
	contexts := matchThrowContexts()
	for _, c := range contexts {
		f.Add(c.key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		i := slices.IndexFunc(contexts, func(c matchThrowContext) bool { return c.key == key })
		if i < 0 {
			if key == "" {
				return
			}
			i = int(key[0]) % len(contexts)
		}
		c := contexts[i]
		source := strings.ReplaceAll(c.source, "flag", fmt.Sprintf("flag%d", variant%8))
		source = strings.Repeat("/* boundary */\n", int(variant)%3) + source + "\n"
		result, err := w.Compile(t.Context(), Single(source))
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		got := r3Errors(result.Diagnostics)
		ok := len(got) == 0
		if c.reject {
			ok = slices.Contains(got, "EK0401")
		}
		gapKey := "context:" + c.key
		if !ok {
			Gap(t, matchThrowContextsTarget, gapKey, "VIP-4/VIP-7: context %s; want EK0401=%v, got %v\n%s", c.key, c.reject, got, source)
		}
		ExpectPending(t, matchThrowContextsTarget, gapKey)
		ExpectPending(t, matchThrowContextsTarget, specCorpusKey(t))
	})
}
