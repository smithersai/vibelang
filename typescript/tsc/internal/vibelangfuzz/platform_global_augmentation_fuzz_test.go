package vibelangfuzz

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const hostAugmentationQuote = "A global is banned when the symbol has a declaration in `lib.dom*.d.ts`, `lib.webworker*.d.ts`, `lib.scripthost.d.ts` or `@types/node`, none in `lib.es*.d.ts` or `lib.decorators*.d.ts`"

func platformGlobalAugmentationQuoted(t testing.TB) {
	t.Helper()
	chapter, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(chapter), hostAugmentationQuote) {
		t.Fatalf("chapter 5 no longer says %q", hostAugmentationQuote)
	}
}

func TestPlatformGlobalAugmentationQuoted(t *testing.T) { platformGlobalAugmentationQuoted(t) }

func FuzzPlatformGlobalAugmentation(f *testing.F) {
	startShortBudget(f)
	platformGlobalAugmentationQuoted(f)
	names := []string{"XMLHttpRequest", "EventSource", "WebSocket", "SharedWorker"}
	for _, name := range names {
		f.Add([]byte(name))
		f.Add([]byte(name + "\x00\x01")) // declaration-file control
		f.Add([]byte(name + "\x00\x06")) // literal access and retained trivia
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		parts := strings.SplitN(string(data), "\x00", 2)
		choice := 0
		if len(data) > 0 {
			choice = int(data[0]) % len(names)
		}
		for i, name := range names {
			if parts[0] == name {
				choice = i
				break
			}
		}
		name := names[choice]
		variant := byte(0)
		if len(parts) == 2 && len(parts[1]) > 0 {
			variant = parts[1][0]
		}
		file := "augment.ts"
		if variant&1 != 0 {
			file = "augment.d.ts"
		}
		reference := name
		if variant&2 != 0 {
			reference = fmt.Sprintf("globalThis[%q]", name)
		}
		if variant&4 != 0 {
			reference = "(/* retained */ " + reference + ")"
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"types":[],"lib":["ES2022","DOM"]},"files":["main.vibe",%q]}`, file)
		augmentation := fmt.Sprintf("export {}\ndeclare global { interface %s { readonly projectOnly?: boolean } }\n", name)
		check := func(role, source string, want int) {
			t.Helper()
			r, err := w.Compile(t.Context(), Project{Config: config, Files: map[string]string{
				"main.vibe": source + "\n", file: augmentation,
				"local.ts":     fmt.Sprintf("export const %s = 7\n", name),
				"package.json": `{"name":"host-augmentation","type":"module"}`,
			}})
			if err != nil {
				t.Fatal(err)
			}
			defer r.Remove()
			var errors []string
			hostErrors := 0
			for _, d := range r.Diagnostics {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				errors = append(errors, fmt.Sprintf("%s%d: %s", d.Source(), d.Code(), d.String()))
				if IsEK(d) && d.Code() == 4402 {
					hostErrors++
				}
			}
			key := role + ":" + name + ":" + file
			if hostErrors != want || len(errors) != want {
				Gap(t, "FuzzPlatformGlobalAugmentation", key, "chapter 5: %s; want %d EK4402, got:\n%s\nsource:\n%s", hostAugmentationQuote, want, strings.Join(errors, "\n"), source)
				return
			}
			ExpectPending(t, "FuzzPlatformGlobalAugmentation", key)
		}
		check("local", fmt.Sprintf("const %s = 7; export const value = %s", name, name), 0)
		check("import", fmt.Sprintf("import { %s } from './local.js'; export const value = %s", name, name), 0)
		check("diagnostic", "export const value = "+reference, 1)
		ExpectPending(t, "FuzzPlatformGlobalAugmentation", specCorpusKey(t))
	})
}
