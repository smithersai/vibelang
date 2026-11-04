package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// Chapter 5's EK4402 row: host access is checked "including inside
// `Effect.try` and `tryPromise` arrows", and the quick fix moves the code to a
// new sibling .ts module unless it "cannot preserve run phase, captures,
// receiver and public types".
const platformCallSplitQuote = "including inside `Effect.try` and `tryPromise` arrows. The quick fix and the codemod move the code into a sibling `.ts` module that does not exist yet"

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

// FuzzPlatformCallSplit (23 keys): --fix on a wrapper whose callback reads a binding of
// the file moves only the platform code to a sibling .ts module. The fixed
// program has no error, its declarations are the original's, and it runs as
// the same code in a .ts file does (chapter 1: moving code to a sibling .ts
// file changes nothing it does), on bytes the fuzzer picks.
func FuzzPlatformCallSplit(f *testing.F) {
	startShortBudget(f)
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		f.Fatal(err)
	}
	if !strings.Contains(string(chapter), platformCallSplitQuote) {
		f.Fatalf("chapter 5 no longer says %q", platformCallSplitQuote)
	}
	for _, key := range platformCallSplitKeys() {
		// Text, and bytes that are not UTF-8 (seed CPU budget: 120s).
		f.Add([]byte(key + "\x00hi"))
		f.Add([]byte(key + "\x00\xff{"))
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, data []byte) {
		key, raw, _ := strings.Cut(string(data), "\x00")
		if !slices.Contains(platformCallSplitKeys(), key) {
			key = "from-bytes:options"
		}
		if len(raw) > 24 {
			raw = raw[:24]
		}
		shape, wrapper, _ := strings.Cut(key, ":")
		var bytes []string
		for _, b := range []byte(raw) {
			bytes = append(bytes, fmt.Sprint(b))
		}
		program := fmt.Sprintf(platformCallSplitWrappers[wrapper], platformCallSplitShapes[shape])
		errorClass := "export class ReadError extends Error {\n  constructor(readonly label: string, readonly reason: unknown) { super(\"read \" + label) }\n}\n"
		read := "export const read = (label: string, bytes: Uint8Array) => " + program + "\n"
		vibe := "/// <reference path=\"./types-node/index.d.ts\" />\n" + errorClass + read +
			"export effect function main() { return try read(\"x\", new Uint8Array([" + strings.Join(bytes, ", ") + "])) }\n"
		native := "/// <reference path=\"./types-node/index.d.ts\" />\nimport { Effect } from \"effect\"\n" + errorClass + read +
			"export function main() { return read(\"x\", new Uint8Array([" + strings.Join(bytes, ", ") + "])) }\n"
		types := map[string]string{
			"types-node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"types-node/index.d.ts":   platformCallSplitTypes,
		}
		files := maps.Clone(types)
		files["main.vibe"] = vibe
		files["package.json"] = `{"name":"platform-call-split","type":"module"}`
		before := toolsCompile(t, w, "FuzzPlatformCallSplit", files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil {
			t.Fatal("missing fix project")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if len(result.Refused) != 0 || len(result.Files) < 2 {
			Gap(t, "FuzzPlatformCallSplit", "refused/"+key, "--fix left the platform code (%+v):\n%s", result.Refused, vibe)
			return
		}
		if strings.Contains(fixed["main.vibe"], "Buffer.from") || strings.Contains(fixed["main.vibe"], "process.") {
			Gap(t, "FuzzPlatformCallSplit", "left/"+key, "the fixed .vibe file still runs platform code:\n%s", fixed["main.vibe"])
			return
		}
		after := toolsCompile(t, w, "FuzzPlatformCallSplit", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzPlatformCallSplit", "errors/"+key, "the fixed program has errors: %v\n%s", after.Diagnostics, fixed["main.vibe"])
			return
		}
		twinFiles := maps.Clone(types)
		twinFiles["main.ts"] = native
		twinFiles["package.json"] = files["package.json"]
		twin := toolsCompile(t, w, "FuzzPlatformCallSplit", twinFiles)
		defer twin.Remove()
		if !toolsErrorFree(twin) {
			t.Fatalf("the .ts twin does not compile: %v\n%s", twin.Diagnostics, native)
		}
		if node == nil {
			if node, err = NewNode(w.Dir); err != nil {
				t.Fatal(err)
			}
		}
		got, want := node.Run(after, platformCallSplitEntry(t, after), "main"), node.Run(twin, platformCallSplitEntry(t, twin), "main")
		if got.Kind != want.Kind || got.Tag != want.Tag || string(got.Value) != string(want.Value) {
			Gap(t, "FuzzPlatformCallSplit", "runs/"+key, "the split runs %+v, the .ts twin %+v\n%s", got, want, fixed["main.vibe"])
			return
		}
		ExpectPending(t, "FuzzPlatformCallSplit", key)
	})
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
