package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

func TestVIP3PlatformErrorNamesQuoted(t *testing.T) {
	annotationTwinChapters(t)
}

// VIP-3 makes a migrated annotation the native Effect TypeScript channel.
// Import aliases and a local type with the module's usual name must retain
// that type, rather than treating the namespace itself as an error type.
func FuzzVIP3PlatformErrorNames(f *testing.F) {
	startShortBudget(f)
	annotationTwinChapters(f)
	w := NewWorkspace(f)
	tsc := annotationTwinTypeScript(f)
	for _, binding := range []string{"implicit", "alias", "shadow"} {
		f.Add("binding:"+binding, false)
		f.Add("binding:"+binding, true)
	}
	f.Fuzz(func(t *testing.T, input string, bang bool) {
		const target = "FuzzVIP3PlatformErrorNames"
		defer recoverCompilerPanic(t, target)
		binding := strings.TrimPrefix(input, "binding:")
		switch binding {
		case "implicit", "alias", "shadow":
		default:
			index := byte(0)
			if len(input) > 0 {
				index = input[0]
			}
			binding = []string{"implicit", "alias", "shadow"}[index%3]
		}
		key := fmt.Sprintf("binding:%s:bang:%t", binding, bang)
		prelude := "import { FileSystem } from \"effect\"\n"
		if binding != "implicit" {
			prelude = "import { FileSystem, PlatformError as FailureModule } from \"effect\"\n"
		}
		if binding == "shadow" {
			prelude += "type PlatformError = string\n"
		}
		annotation := "Effect.Effect<string, infer E, FileSystem.FileSystem>"
		if bang {
			annotation = "string!infer E!FileSystem.FileSystem"
		}
		source := prelude + "export const work = effect (path: string): " + annotation +
			" => { const fs = FileSystem.FileSystem(); return fs.readFileString(path) }\n"
		before := toolsCompile(t, w, target, map[string]string{"main.vibe": source})
		defer before.Remove()
		options := vibelang.FixOptions{VIPOnly: true}
		fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		if fixed.Err != nil || len(fixed.Refused) != 0 || len(fixed.Files) != 1 {
			Gap(t, target, "migration:"+key, "%s; error %v, refused %+v, files %d\n%s",
				annotationTwinQuote, fixed.Err, fixed.Refused, len(fixed.Files), source)
			return
		}
		text := ""
		for _, file := range fixed.Files {
			text = file.Text
		}
		after := toolsCompile(t, w, target, map[string]string{"main.vibe": text})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, target, "new-error:"+key, "%s\n%v\n%s", annotationTwinQuote,
				SortedKeys(Keys(after.Dir, after.Diagnostics)), text)
			return
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if again.Err != nil || len(again.Files) != 0 || len(again.Refused) != 0 {
			Gap(t, target, "idempotence:"+key, "second migration changes %d files, error %v, refused %+v",
				len(again.Files), again.Err, again.Refused)
			return
		}
		native := after.Outputs["out/main.d.ts"]
		if native == "" {
			Gap(t, target, "declaration:"+key, "migration emitted no declaration\n%s", text)
			return
		}
		twin := "import { Effect, FileSystem, PlatformError } from \"effect\"\n" +
			"export const work = Effect.fn(function* (path: string): Effect.fn.Return<string, PlatformError.PlatformError, FileSystem.FileSystem> { const fs = yield* FileSystem.FileSystem; return yield* fs.readFileString(path) })\n"
		check := "import { work as native } from \"./fixed.js\"\nimport { work as twin } from \"./main.js\"\n" +
			"type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false\n" +
			"export const same: Same<ReturnType<typeof native>, ReturnType<typeof twin>> = true\n"
		out, ok := runAnnotationTwinTSC(t, w, tsc, map[string]string{
			"main.ts": twin, "fixed.d.ts": native, "check.ts": check,
		}, `"main.ts", "fixed.d.ts", "check.ts"`)
		if !ok {
			Gap(t, target, "declaration:"+key, "%s\n%s\nfixed:\n%s\ndeclaration:\n%s",
				annotationTwinQuote, out, text, native)
		}
	})
}
