package vibelangfuzz

import (
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const platformYieldValueQuote = "The non-function value exports are globals too;"
const platformYieldDiagnosticQuote = "a message in the user's words that says what is wrong and how to fix it"

func TestPlatformYieldAdviceQuoted(t *testing.T) { platformYieldAdviceQuoted(t) }

func platformYieldAdviceQuoted(t testing.TB) {
	t.Helper()
	for name, quote := range map[string]string{"005-services.md": platformYieldValueQuote, "007-tooling.md": platformYieldDiagnosticQuote} {
		text, err := os.ReadFile(SpecPath(name))
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(text), quote) {
			t.Fatalf("%s no longer says %q", name, quote)
		}
	}
}

var platformYieldAdviceKeys = []string{"microtask", "immediate", "next-tick", "timers", "promises", "shadow", "native"}

// Static diagnostic advice must name an expression that actually type-checks.
// Keyed paths cover global/member/import aliases and unrelated local controls.
func FuzzPlatformYieldAdvice(f *testing.F) {
	startShortBudget(f)
	platformYieldAdviceQuoted(f)
	for _, key := range platformYieldAdviceKeys {
		for _, variant := range []byte{0, 1} {
			f.Add([]byte(key + "\x00" + string([]byte{variant})))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		key, variant := parts[0], byte(0)
		if !slices.Contains(platformYieldAdviceKeys, key) {
			key = platformYieldAdviceKeys[len(data)%len(platformYieldAdviceKeys)]
		}
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		source, want := "", 1
		switch key {
		case "microtask":
			source = "export const run = () => queueMicrotask(() => {})"
		case "immediate":
			source = "export const run = () => setImmediate(() => {})"
		case "next-tick":
			source = "export const run = () => process.nextTick(() => {})"
		case "timers":
			source = "import { setImmediate as pause } from \"node:timers\"; export const run = () => pause(() => {})"
		case "promises":
			source = "import { setImmediate as pause } from \"node:timers/promises\"; export const run = () => pause()"
		case "shadow":
			source, want = "const queueMicrotask = (f: () => void) => 1; export const run = () => queueMicrotask(() => {})", 0
		case "native":
			source, want = "import { Effect } from \"effect\"; export effect function main() { try Effect.yieldNow }", 0
		}
		config := `{"compilerOptions":{"strict":true,"noEmit":true,"target":"ES2022","module":"NodeNext","skipLibCheck":true,"types":[]},"files":["main.vibe","node_modules/@types/node/index.d.ts"]`
		if variant&1 != 0 {
			config += `,"vibe":{"effectGlobals":false,"effectModules":false}`
		}
		config += "}"
		files := map[string]string{
			"main.vibe":                             source,
			"node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
			"node_modules/@types/node/index.d.ts": `
declare var queueMicrotask: (callback: () => void) => void
declare var setImmediate: (callback: () => void) => number
declare var process: { nextTick(callback: () => void): void }
declare module "node:timers" { export function setImmediate(callback: () => void): number }
declare module "node:timers/promises" { export function setImmediate(): Promise<void> }
`,
		}
		result, err := w.Compile(t.Context(), Project{Config: config, Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Source() == "EK" && d.Code() == 4402 {
				count++
				text := layerMergeAdviceText(d)
				if !strings.Contains(text, "try Effect.yieldNow") || strings.Contains(text, "yieldNow()") {
					Gap(t, "FuzzPlatformYieldAdvice", key, "%s; obsolete advice: %s", platformYieldValueQuote, text)
					return
				}
			} else if d.Category() == diagnostics.CategoryError {
				t.Fatalf("fixture %s rejected: %s", key, d.String())
			}
		}
		if count != want {
			Gap(t, "FuzzPlatformYieldAdvice", key, "want %d EK4402, got %d", want, count)
			return
		}
		if want != 0 {
			files["main.vibe"] = "import { Effect } from \"effect\"; export effect function main() { try Effect.yieldNow }"
			checked, err := w.Compile(t.Context(), Project{Config: config, Files: files})
			if err != nil {
				t.Fatal(err)
			}
			defer checked.Remove()
			for _, d := range checked.Diagnostics {
				if d.Category() == diagnostics.CategoryError {
					Gap(t, "FuzzPlatformYieldAdvice", key+":advice", "native replacement rejected: %s", d.String())
					return
				}
			}
		}
		ExpectPending(t, "FuzzPlatformYieldAdvice", key)
		ExpectPending(t, "FuzzPlatformYieldAdvice", specCorpusKey(t))
	})
}
