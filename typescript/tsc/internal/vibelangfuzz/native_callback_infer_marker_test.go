package vibelangfuzz

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const nativeCallbackInferTarget = "FuzzNativeCallbackInferMarker"
const nativeCallbackInferQuote = "`infer` has no meaning in a return annotation: `--fix` deletes a bare `: infer _`"

func TestNativeCallbackInferMarkerQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", nativeCallbackInferQuote)
}

func FuzzNativeCallbackInferMarker(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"global", "qualified", "imported"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestNativeCallbackInferMarkerQuoted(t)
		prelude, call := "import { Effect } from \"effect\"\n", "callback"
		twinPrelude := prelude + "import { callback } from \"effect/Effect\"\n"
		switch key {
		case "qualified":
			call, twinPrelude = "Effect.callback", prelude
		case "imported":
			prelude += "import { callback as register } from \"effect/Effect\"\n"
			call, twinPrelude = "register", prelude
		default:
			key = "global"
		}
		body := "export const make = " + call + "<number>((resume): infer _ => { resume(Effect.succeed(1)); });\n"
		source := prelude + body
		twin := twinPrelude + strings.ReplaceAll(body, ": infer _", "")
		if crlf {
			source, twin = strings.ReplaceAll(source, "\n", "\r\n"), strings.ReplaceAll(twin, "\n", "\r\n")
		}
		toolsGuard(t, nativeCallbackInferTarget, func() {
			before := toolsCompile(t, w, nativeCallbackInferTarget, map[string]string{"main.vibe": source})
			defer before.Remove()
			fixed := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			files := map[string]string{"main.vibe": source}
			for name, file := range fixed.Files {
				files[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if fixed.Err != nil || len(fixed.Refused) != 0 || strings.Contains(files["main.vibe"], ": infer _") {
				Gap(t, nativeCallbackInferTarget, "marker:"+key, "%s; err=%v refused=%+v\n%s", nativeCallbackInferQuote, fixed.Err, fixed.Refused, Archive(files))
			}
			after := toolsCompile(t, w, nativeCallbackInferTarget, files)
			defer after.Remove()
			reference := toolsCompile(t, w, nativeCallbackInferTarget, map[string]string{"main.ts": twin})
			defer reference.Remove()
			if !toolsErrorFree(after) || !toolsErrorFree(reference) {
				Gap(t, nativeCallbackInferTarget, "typing:"+key, "native registration must compile after marker removal: %v; twin %v", SortedKeys(Keys(after.Dir, after.Diagnostics)), SortedKeys(Keys(reference.Dir, reference.Diagnostics)))
			}
			if mismatch := toolsContractMismatch(t, w, reference, after, false); mismatch != "" {
				Gap(t, nativeCallbackInferTarget, "declarations:"+key, "%s", mismatch)
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{})
			if again.Err != nil || len(again.Files) != 0 {
				Gap(t, nativeCallbackInferTarget, "idempotence:"+key, "second repair changed the registration: %v %v", again.Err, again.Order)
			}
		})
	})
}
