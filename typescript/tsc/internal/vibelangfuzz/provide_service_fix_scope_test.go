package vibelangfuzz

import (
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const provideServiceFixMeaningQuote = "without changing the meaning of TypeScript-style source."
const provideServiceFixLayerQuote = "which means `Layer.succeed(Key, value)`"

var provideServiceFixScopeKeys = []string{"native", "alias", "qualified", "layer"}

func TestProvideServiceFixScopeQuoted(t *testing.T) { provideServiceFixScopeQuoted(t) }
func provideServiceFixScopeQuoted(t testing.TB) {
	t.Helper()
	for file, quote := range map[string]string{"007-tooling.md": provideServiceFixMeaningQuote, "005-services.md": provideServiceFixLayerQuote} {
		text, err := os.ReadFile(SpecPath(file))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer says %q", file, quote)
		}
	}
}
func provideServiceFixDiagnostic(d *ast.Diagnostic) string {
	text := d.String()
	for _, child := range d.MessageChain() {
		text += "\n" + provideServiceFixDiagnostic(child)
	}
	return text
}

// Native service provision leaves no Layer memo map. Layer provision creates
// one. Both editor actions and --fix must preserve those pinned observations.
// main is marked effect and tries the provision: under VIP-1 an unmarked
// function is plain JavaScript that returns the program unrun, and EK4836's
// block repair and its scope advice apply to effect code.
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#10fe388bcbf9c49b
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#e6d04a4ede5b0933
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#4187f09a06bc9fbb
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#d8364cc628a733b7
// Chapter 007 / provide repairs preserve cold factories and CurrentMemoMap: docs/design/src/007-tooling.md#7d5987968b922bb6

func FuzzProvideServiceFixScope(f *testing.F) {
	startShortBudget(f)
	provideServiceFixScopeQuoted(f)
	for _, key := range provideServiceFixScopeKeys {
		for variant := byte(0); variant < 4; variant++ {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	w := NewWorkspace(f)
	var node *Node
	f.Cleanup(func() {
		if node != nil {
			node.Close()
		}
	})
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		if !slices.Contains(provideServiceFixScopeKeys, key) {
			key = "native"
		}
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		imports, callee, keyArg, extra := "", "Effect.provideService", "Key", ""
		if key == "alias" {
			imports = "import { Effect as Fx } from \"effect\"\n"
			callee = "Fx.provideService"
		}
		if key == "qualified" {
			keyArg = "Keys.Key"
			extra = "const Keys = { Key }\n"
		}
		separator := ", "
		if key != "layer" && variant&1 != 0 {
			separator = ", /* retain */ "
		}
		call := callee + "(observe()" + separator + keyArg + separator + fmt.Sprintf("{ value: %d })", 1+int(variant)%4)
		if key == "layer" {
			call = fmt.Sprintf("Effect.provide(observe(), Layer.succeed(Key, { value: %d }))", 1+int(variant)%4)
		}
		source := imports + `service Key {
 static readonly key = "fix-scope/Key"
 value: number
}
effect function observe(): string!! {
 const memo = try Effect.serviceOption(Layer.CurrentMemoMap)
 return memo._tag
}
` + extra + "export effect function main() { return try " + call + " }\n"
		files := map[string]string{"main.vibe": source, "package.json": `{"name":"provide-service-fix-scope","type":"module"}`}
		before := toolsCompile(t, w, "FuzzProvideServiceFixScope", files)
		defer before.Remove()
		if !toolsErrorFree(before) {
			t.Fatalf("controlled scope program rejected: %v\n%s", before.Diagnostics, source)
		}
		config := toolsConfig(w, before.Dir)
		if config == nil {
			t.Fatal("missing fix project")
		}
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
		if result.Err != nil {
			t.Fatal(result.Err)
		}
		fixed := maps.Clone(files)
		applied := 0
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			applied += file.Counts[4836]
		}
		after := toolsCompile(t, w, "FuzzProvideServiceFixScope", fixed)
		defer after.Remove()
		if !toolsErrorFree(after) {
			t.Fatalf("fixed scope program rejected: %v", after.Diagnostics)
		}
		if node == nil {
			var err error
			node, err = NewNode(w.Dir)
			if err != nil {
				t.Fatal(err)
			}
		}
		// The export is controlled here; a namespace alias in its inferred
		// declaration need not match the generic runnable-export recognizer.
		var entries []toolsRunnable
		for name := range before.Outputs {
			if name == "main.js" || strings.HasSuffix(name, "/main.js") {
				entries = append(entries, toolsRunnable{name, "main"})
			}
		}
		found := false
		for _, entry := range entries {
			if entry.name != "main" {
				continue
			}
			found = true
			was, is := node.Run(before, entry.file, entry.name), node.Run(after, entry.file, entry.name)
			want := "None"
			if key == "layer" {
				want = "Some"
			}
			if was.Kind != "success" || string(was.Value) != fmt.Sprintf("%q", want) {
				t.Fatalf("controlled native observation: got %+v, want %q", was, want)
			}
			if !toolsSameOutcome(was, is) {
				Gap(t, "FuzzProvideServiceFixScope", key, "VIP-12/34: --fix changes native scope observation: before %+v; after %+v", was, is)
				return
			}
		}
		if !found {
			t.Fatal("controlled main export was not runnable")
		}
		diagnostics := 0
		for _, d := range before.Diagnostics {
			if d.Source() != "EK" || d.Code() != 4836 {
				continue
			}
			diagnostics++
			offered := toolsOffersQuickFix(t, w, before, "main.vibe", d)
			if key == "layer" {
				if !offered || applied == 0 {
					Gap(t, "FuzzProvideServiceFixScope", key, "native Layer control lost its safe block repair")
					return
				}
			} else {
				text := provideServiceFixDiagnostic(d)
				if offered || applied != 0 || !strings.Contains(text, "No quick fix") || !strings.Contains(text, "Layer.CurrentMemoMap") {
					Gap(t, "FuzzProvideServiceFixScope", key, "unsafe native service migration offered=%v applied=%d advice=%s", offered, applied, text)
					return
				}
			}
		}
		if diagnostics != 1 {
			t.Fatalf("want one EK4836, got %d", diagnostics)
		}
		ExpectPending(t, "FuzzProvideServiceFixScope", key)
		ExpectPending(t, "FuzzProvideServiceFixScope", specCorpusKey(t))
	})
}
