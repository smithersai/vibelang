package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const platformDerivedQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`, and is not on the allowlist below."
const platformDerivedShadowQuote = "A local binding, an import or an Effect module in scope (`Option`, `FileSystem`, `Headers`, `Worker`) shadows the global first"

type platformDerivedInventory struct {
	Banned    []string `json:"banned"`
	Allowlist []string `json:"allowlist"`
}

func platformDerivedRules(t testing.TB) platformDerivedInventory {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{platformDerivedQuote, platformDerivedShadowQuote} {
		if !strings.Contains(string(chapter), quote) {
			t.Fatalf("chapter 5 no longer says %q", quote)
		}
	}
	path := filepath.Join(filepath.Dir(SpecPath("005-services.md")), "../inventory/platform-globals.json")
	text, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var inventory platformDerivedInventory
	if err := json.Unmarshal(text, &inventory); err != nil {
		t.Fatal(err)
	}
	if len(inventory.Banned) == 0 || len(inventory.Allowlist) == 0 {
		t.Fatal("platform inventory is empty")
	}
	return inventory
}
func TestPlatformDerivedGlobalsQuoted(t *testing.T) { platformDerivedRules(t) }

func FuzzPlatformDerivedGlobals(f *testing.F) {
	startShortBudget(f)
	inventory := platformDerivedRules(f)
	for _, key := range []string{
		"FileReader:shorthand", "FileReader:type", "FileReader:qualified-type",
		"fetch:shorthand", "fetch:type", "setTimeout:shorthand", "setTimeout:type",
		"MutationObserver:shorthand", "MutationObserver:value", "MutationObserver:type", "MutationObserver:member", "MutationObserver:shadow",
		"HTMLElement:value", "HTMLElement:type", "HTMLElement:member", "HTMLElement:shadow",
		"URL:value", "URL:type", "URL:member", "URL:shadow",
		"AbortSignal:value", "AbortSignal:type", "AbortSignal:member",
		"AbortSignal.timeout:host-member", "URL.createObjectURL:host-member", "URL.revokeObjectURL:host-member",
	} {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	// Read the pinned declarations used by the inventory, including Node's.
	from := filepath.Join(Root(), "docs/tools/node_modules")
	if _, err := os.Stat(filepath.Join(from, "@types/node/package.json")); err != nil {
		from = filepath.Join(Root(), "packages/runtime/node_modules")
	}
	if err := installPackage(filepath.Join(w.Dir, "node_modules"), from, "@types/node", false); err != nil {
		Missing(f, "install pinned @types/node in docs/tools before derived-platform fuzzing: %v", err)
	}
	names := append(slices.Clone(inventory.Banned), inventory.Allowlist...)
	modes := []string{"value", "type", "qualified-type", "member", "shorthand", "shadow"}
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), ":", 2)
		name, mode := parts[0], "value"
		if len(parts) == 2 {
			mode = parts[1]
		}
		hostMember := mode == "host-member" && slices.Contains([]string{"AbortSignal.timeout", "URL.createObjectURL", "URL.revokeObjectURL"}, name)
		if !hostMember && !slices.Contains(names, name) {
			index := 0
			if len(data) > 0 {
				index = int(data[0])
			}
			if len(data) > 1 {
				index = index*256 + int(data[1])
			}
			name = names[index%len(names)]
		}
		if !hostMember && !slices.Contains(modes, mode) {
			index := 0
			if len(data) > 2 {
				index = int(data[2])
			}
			mode = modes[index%len(modes)]
		}
		source := "export const value = " + name
		want := 0
		if hostMember || (slices.Contains(inventory.Banned, name) && (mode == "value" || mode == "member" || mode == "shorthand")) {
			want = 1
		}
		switch mode {
		case "type":
			source = "export type Value = typeof " + name
		case "qualified-type":
			source = "export type Value = typeof globalThis." + name
		case "shorthand":
			source = "export const value = { " + name + " }"
		case "member":
			literal, _ := json.Marshal(name)
			source = "export const value = globalThis[" + string(literal) + "]"
		case "shadow":
			source = "export function value(" + name + ": number): number { return " + name + " }"
		}
		config := `{"compilerOptions":{"target":"ESNext","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":["node"],"lib":["ESNext","DOM","WebWorker","ScriptHost"]},"vibe":{"effectModules":false},"files":["main.vibe"]}`
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source, "package.json": servicesPackage}, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		count := 0
		for _, d := range result.Diagnostics {
			if d.Category() != diagnostics.CategoryError {
				continue
			}
			if IsEK(d) && d.Code() == 4402 {
				count++
			} else {
				t.Fatalf("unexpected diagnostic for %s:%s: %s", name, mode, d.String())
			}
		}
		key := name + ":" + mode
		if count != want {
			Gap(t, "FuzzPlatformDerivedGlobals", key, "%s; %s", platformDerivedQuote, fmt.Sprintf("want %d EK4402, got %d", want, count))
			return
		}
		ExpectPending(t, "FuzzPlatformDerivedGlobals", key)
		ExpectPending(t, "FuzzPlatformDerivedGlobals", specCorpusKey(t))
	})
}
