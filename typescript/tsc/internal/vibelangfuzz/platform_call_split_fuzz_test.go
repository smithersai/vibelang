package vibelangfuzz

import (
	"slices"
	"strings"
	"testing"
)

// Chapter 5's EK4402 row: host access is checked "including inside
// `Effect.try` and `tryPromise` arrows", and the quick fix moves the code to a
// new sibling .ts module unless it "cannot preserve run phase, captures,
// receiver and public types".
const platformCallSplitQuote = "including inside `Effect.try` and `tryPromise` arrows. The quick fix moves the code into a sibling `.ts` module that does not exist yet"

// platformCallSplitShapes are platform code a wrapper's callback runs on a
// binding of the .vibe file, as t3code Desktop's ElectronSafeStorage and
// SafariCookies run Buffer.from on a local inside Effect.try.
var platformCallSplitShapes = map[string]string{
	"from-bytes": `Buffer.from(bytes).toString("utf8")`,
	"from-text":  `Buffer.from(label, "utf8").length`,
	"json":       `JSON.parse(Buffer.from(bytes).toString("utf8"))`,
	"cwd":        `process.cwd().length > label.length`,
	"platform":   `process.platform + label`,
	"nested":     `Buffer.from(Buffer.from(bytes).toString("utf8"), "utf8").length`,
}

var platformCallSplitWrappers = map[string]string{
	"options": "Effect.try({ try: () => %s, catch: (cause) => new ReadError(label, cause) })",
	"thunk":   "Effect.try(() => %s)",
	"sync":    "Effect.sync(() => %s)",
	"promise": "Effect.tryPromise({ try: async () => %s, catch: (cause) => new ReadError(label, cause) })",
}

const platformCallSplitTypes = `export {}
declare global {
  interface Buffer extends Uint8Array { toString(encoding?: string): string }
  var Buffer: {
    from(value: Uint8Array | ReadonlyArray<number>): Buffer
    from(value: string, encoding?: string): Buffer
  }
  var process: { readonly platform: string; cwd(): string }
}
`

func platformCallSplitKeys() []string {
	var keys []string
	for shape := range platformCallSplitShapes {
		for wrapper := range platformCallSplitWrappers {
			if shape == "json" && wrapper == "sync" {
				// JSON.parse throws, and Effect.sync code never throws: the
				// input is wrong before any split (chapter 1 throw rule).
				continue
			}
			keys = append(keys, shape+":"+wrapper)
		}
	}
	slices.Sort(keys)
	return keys
}

func platformCallSplitEntry(t *testing.T, r *Result) string {
	t.Helper()
	for name := range r.Outputs {
		if name == "main.js" || strings.HasSuffix(name, "/main.js") {
			return name
		}
	}
	t.Fatal("no main.js output")
	return ""
}
