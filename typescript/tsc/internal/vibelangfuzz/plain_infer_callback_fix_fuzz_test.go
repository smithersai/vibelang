package vibelangfuzz

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const plainInferCallbackTarget = "FuzzPlainInferCallbackFix"
const plainInferCallbackQuote = "A quick fix is offered only when it preserves evaluation order, coldness, types, comments, and declaration output; otherwise the diagnostic explains why it has no automatic fix."

func TestPlainInferCallbackFixQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), plainInferCallbackQuote) {
		t.Fatal("missing callback migration preservation rule")
	}
	if !strings.Contains(SpecText("001-functions.md"), "--fix\x60 deletes a bare \x60: infer _\x60") {
		t.Fatal("missing legacy plain return migration rule")
	}
}

func FuzzPlainInferCallbackFix(f *testing.F) {
	startShortBudget(f)
	f.Add("promise-options", byte(0), false)
	f.Add("promise-direct", byte(1), true)
	f.Add("try-options", byte(2), false)
	f.Add("try-direct", byte(0), true)
	f.Add("sync", byte(1), false)
	for outer := byte(0); outer < 3; outer++ {
		for _, namespace := range []bool{false, true} {
			f.Add("callback", outer, namespace)
			f.Add("callback-legacy", outer, namespace)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, outer byte, namespace bool) {
		TestPlainInferCallbackFixQuoted(t)
		wrapper := ""
		switch key {
		case "promise-options":
			wrapper = "Effect.tryPromise({ try: (): infer _ => Promise.resolve(1), catch: (cause) => String(cause) })"
		case "promise-direct":
			wrapper = "Effect.tryPromise((): infer _ => Promise.resolve(1))"
		case "try-options":
			wrapper = "Effect.try({ try: (): infer _ => 1, catch: (cause) => String(cause) })"
		case "try-direct":
			wrapper = "Effect.try(function (): infer _ { return 1 })"
		case "sync":
			wrapper = "sync((): infer _ => 1)"
		case "callback":
			wrapper = "callback<number>((resume): infer _ => { resume(Effect.succeed(1)); })"
		case "callback-legacy":
			wrapper = "legacyCallback<number>((resume): infer _ => { resume(1); })"
		default:
			key = "promise-options"
			wrapper = "Effect.tryPromise({ try: (): infer _ => Promise.resolve(1), catch: (cause) => String(cause) })"
		}
		prelude := "import { Effect } from \"effect\"\n"
		if namespace {
			prelude = "import * as Effect from \"effect/Effect\"\n"
		}
		if key == "callback-legacy" {
			prelude += "import { callback as legacyCallback } from \"vibelang-runtime\"\n"
		}
		body := "const run = effect () => try " + wrapper + "; return { run };"
		source := ""
		switch outer % 3 {
		case 0:
			source = "export const make = () => Effect.gen(function* () { " + body + " });\n"
		case 1:
			source = "export const make = () => effect { " + body + " };\n"
		case 2:
			source = "export effect function make() { " + body + " }\n"
		}
		nativeWrapper := strings.ReplaceAll(wrapper, ": infer _", "")
		if key == "sync" || key == "callback" {
			nativeWrapper = "Effect." + nativeWrapper
		}
		twin := prelude + "export const make = () => Effect.gen(function* () { const run = () => " + nativeWrapper + "; return { run }; });\n"
		source = prelude + source
		toolsGuard(t, plainInferCallbackTarget, func() {
			original := toolsCompile(t, w, plainInferCallbackTarget, map[string]string{"main.vibe": source})
			defer original.Remove()
			config := toolsConfig(w, original.Dir)
			if original.Program == nil || config == nil {
				t.Fatal("missing callback project")
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{})
			fixed := map[string]string{"main.vibe": source}
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(original.Dir)+"/")] = file.Text
			}
			after := toolsCompile(t, w, plainInferCallbackTarget, fixed)
			defer after.Remove()
			if result.Err != nil || !toolsErrorFree(after) {
				Gap(t, plainInferCallbackTarget, "fix:plain-infer:"+key, "legacy callback did not converge: err=%v refused=%+v diagnostics=%v\n%s", result.Err, result.Refused, SortedKeys(Keys(after.Dir, after.Diagnostics)), Archive(fixed))
			}
			reference := toolsCompile(t, w, plainInferCallbackTarget, map[string]string{"main.ts": twin})
			defer reference.Remove()
			if !toolsErrorFree(reference) {
				t.Fatalf("invalid native callback twin: %v\n%s", SortedKeys(Keys(reference.Dir, reference.Diagnostics)), twin)
			}
			if mismatch := toolsContractMismatch(t, w, reference, after, false); mismatch != "" {
				Gap(t, plainInferCallbackTarget, "fix:plain-infer:types:"+key, "%s\n%s", mismatch, Archive(fixed))
			}
			secondConfig := toolsConfig(w, after.Dir)
			second := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), secondConfig, vibelang.FixOptions{})
			for name, file := range second.Files {
				rel := strings.TrimPrefix(name.AsString(), filepath.ToSlash(after.Dir)+"/")
				if previous, ok := fixed[rel]; ok && previous != file.Text {
					Gap(t, plainInferCallbackTarget, "fix:plain-infer:idempotence:"+key, "second fix changed the callback again")
				}
			}
		})
	})
}
