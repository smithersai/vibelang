package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

// Foldkit-104 (corrected from the duplicate foldkit-103): instanceof HTMLElement and new MutationObserver were rejected,
// but nearby DOM constructors were admitted. VIP-33 derives the ban from host
// declarations, independently of which constructors the compiler lists today.
// No constructor is executed: this is an admission oracle, with TypeScript
// controls; runtime comparisons remain in FuzzVIPDifferential.
var platformConstructors = []struct {
	name, arguments string
	banned          bool
}{
	{"HTMLElement", "", true},
	{"HTMLDialogElement", "", true},
	{"HTMLCanvasElement", "", true},
	{"HTMLSelectElement", "", true},
	{"MutationObserver", "(): void => {}", true},
	{"EventTarget", "", true},
	{"Blob", "", true},
	{"FormData", "", true},
	{"URL", "\"https://example.test/\"", false},
	{"URLSearchParams", "\"a=b\"", false},
	{"TextEncoder", "", false},
	{"AbortController", "", false},
}
var platformConstructorUses = []string{"capture", "new", "instanceof"}

func platformConstructorQuotes(tb testing.TB) {
	tb.Helper()
	chapter := SpecText("005-services.md")
	for _, quote := range []string{
		"A global is banned when the symbol has a declaration in ",
		"The compiler reads the declarations themselves.",
		"The web-utility allowlist is closed: a name can be added later, never removed.",
	} {
		if !strings.Contains(chapter, quote) {
			tb.Fatalf("Chapter 5 no longer says %q", quote)
		}
	}
	raw, err := os.ReadFile(SpecPath("../inventory/platform-globals.json"))
	if err != nil {
		tb.Fatal(err)
	}
	var inventory struct{ Banned []string }
	if err = json.Unmarshal(raw, &inventory); err != nil {
		tb.Fatal(err)
	}
	for _, entry := range platformConstructors {
		if slices.Contains(inventory.Banned, entry.name) != entry.banned {
			tb.Fatalf("re-read VIP-33: inventory classification changed for %s", entry.name)
		}
	}
}

func TestPlatformConstructorBindingsQuoted(t *testing.T) { platformConstructorQuotes(t) }

func platformConstructorSource(name, use, arguments string, local bool) string {
	source := "declare const subject: object;\n"
	if local {
		source += "const " + name + " = class { constructor(..._args: any[]) {} };\n"
	}
	expression := name
	switch use {
	case "new":
		expression = "new " + name + "(" + arguments + ")"
	case "instanceof":
		expression = "subject instanceof " + name
	}
	return source + "export const value = " + expression + ";\n"
}

func FuzzPlatformConstructorBindings(f *testing.F) {
	startShortBudget(f)
	platformConstructorQuotes(f)
	var keys []string
	for _, entry := range platformConstructors {
		for _, use := range platformConstructorUses {
			for _, binding := range []string{"global", "local"} {
				key := strings.Join([]string{entry.name, use, binding}, ":")
				keys = append(keys, key)
				f.Add(key)
			}
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string) {
		const target = "FuzzPlatformConstructorBindings"
		defer recoverCompilerPanic(t, target)
		if !slices.Contains(keys, key) {
			index := 0
			if len(key) > 0 {
				index = int(key[0]) % len(keys)
			}
			key = keys[index]
		}
		parts := strings.Split(key, ":")
		entry := platformConstructors[slices.IndexFunc(platformConstructors, func(e struct {
			name, arguments string
			banned          bool
		}) bool {
			return e.name == parts[0]
		})]
		local := parts[2] == "local"
		source := platformConstructorSource(entry.name, parts[1], entry.arguments, local)
		banned := entry.banned && !local
		g := &Gaps{Target: target, Input: source}
		for _, file := range []string{"main.ts", "main.vibe"} {
			config := fmt.Sprintf("{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"lib\":[\"ES2022\",\"DOM\"],\"noEmit\":true},\"files\":[%q]}", file)
			c, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer c.Remove()
			if c.Program == nil {
				t.Fatal("constructor project has no program")
			}
			if file == "main.ts" {
				if HasError(c.Diagnostics) {
					t.Fatalf("invalid native constructor control %s: %v", key, SortedKeys(Keys(c.Dir, c.Diagnostics)))
				}
				continue
			}
			reported := false
			for _, d := range c.Diagnostics {
				if IsEK(d) && d.Category() == diagnostics.CategoryError && d.Code() == 4402 {
					reported = true
				}
			}
			if reported != banned || !banned && HasError(c.Diagnostics) {
				g.Add("feature:"+key, "VIP-33 derives the platform ban from resolved host declarations, retaining pure helpers and local shadows: want EK4402=%t, got %v", banned, SortedKeys(Keys(c.Dir, c.Diagnostics)))
			}
		}
		g.FinishInput(t, specCorpusKey(t))
	})
}
