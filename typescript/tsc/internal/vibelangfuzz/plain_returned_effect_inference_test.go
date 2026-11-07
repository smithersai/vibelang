package vibelangfuzz

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const plainReturnedInferTarget = "FuzzPlainReturnedEffectInference"
const plainReturnedInferQuote = "writes checker-proved inferred channel types, preserving declaration types and runtime behavior, or refuses with an explanation if it cannot name those types safely."

func TestPlainReturnedEffectInferenceQuoted(t *testing.T) {
	chapterSays(t, "001-functions.md", plainReturnedInferQuote)
}

func FuzzPlainReturnedEffectInference(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"legacy-raise-catch-tag", "success-literal", "mapped-requirement", "mapped-error", "caught-tag", "caught-tag-pipe", "handler-requirement", "handler-error"} {
		f.Add(key, false)
		f.Add(key, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, crlf bool) {
		TestPlainReturnedEffectInferenceQuoted(t)
		prefix := "import { Effect } from \"effect\"\n"
		body, native := "", ""
		switch key {
		case "legacy-raise-catch-tag":
			prefix += "class Tagged extends Error { readonly _tag = \"Tagged\" }\n"
			body = "function raise<E>(error: E): Effect.Effect<never, E, infer R> { throw error }\nexport function keep(error: Tagged): Effect.Effect<string, never, infer R> { return raise(error) |> Effect.catchTag(%, \"Tagged\", (caught) => caught.message) }\n"
			native = "function raise<E>(error: E): Effect.Effect<never, E, never> { return Effect.fail(error) }\nexport function keep(error: Tagged): Effect.Effect<string, never, never> { return Effect.catchTag(raise(error), \"Tagged\", (caught) => Effect.succeed(caught.message)) }\n"
		case "success-literal":
			body = "export function keep<E, R>(program: Effect.Effect<number, E, R>): Effect.Effect<infer Value, E, R> { return Effect.as(program, \"done\" as const) }\n"
			native = strings.ReplaceAll(body, "infer Value", "\"done\"")
		case "mapped-error":
			body = "export function keep<E>(program: Effect.Effect<number, E>): Effect.Effect<string, infer Failure, never> { return Effect.map(program, String) }\n"
			native = strings.ReplaceAll(body, "infer Failure", "E")
		case "caught-tag", "caught-tag-pipe":
			prefix += "class Tagged extends Error { readonly _tag = \"Tagged\" }\n"
			body = "export function keep(program: Effect.Effect<never, Tagged>): Effect.Effect<string, never, infer Need> { return Effect.catchTag(program, \"Tagged\", effect (caught) => caught.message) }\n"
			native = strings.ReplaceAll(body, "infer Need", "never")
			native = strings.ReplaceAll(native, "effect (caught) => caught.message", "(caught) => Effect.succeed(caught.message)")
			if key == "caught-tag-pipe" {
				body = strings.Replace(body, "Effect.catchTag(program,", "program |> Effect.catchTag(%,", 1)
			}
		case "handler-requirement":
			prefix += "class Tagged extends Error { readonly _tag = \"Tagged\" }\nclass Needed { readonly _tag = \"Needed\" }\n"
			body = "export function keep(program: Effect.Effect<never, Tagged>, next: Effect.Effect<string, never, Needed>): Effect.Effect<string, never, infer Need> { return Effect.catchTag(program, \"Tagged\", effect () => try next) }\n"
			native = strings.ReplaceAll(body, "infer Need", "Needed")
			native = strings.ReplaceAll(native, "effect () => try next", "() => next")
		case "handler-error":
			prefix += "class Tagged extends Error { readonly _tag = \"Tagged\" }\nclass Other extends Error { readonly _tag = \"Other\" }\n"
			body = "export function keep(program: Effect.Effect<never, Tagged>): Effect.Effect<never, infer Failure, never> { return Effect.catchTag(program, \"Tagged\", effect () => { throw new Other() }) }\n"
			native = strings.ReplaceAll(body, "infer Failure", "Other")
			native = strings.ReplaceAll(native, "effect () => { throw new Other() }", "() => Effect.fail(new Other())")
		default:
			key = "mapped-requirement"
			body = "export function keep<R>(program: Effect.Effect<number, never, R>): Effect.Effect<string, never, infer Need> { return Effect.map(program, String) }\n"
			native = strings.ReplaceAll(body, "infer Need", "R")
		}
		source, twin := prefix+body, prefix+native
		if crlf {
			source, twin = strings.ReplaceAll(source, "\n", "\r\n"), strings.ReplaceAll(twin, "\n", "\r\n")
		}
		toolsGuard(t, plainReturnedInferTarget, func() {
			before := toolsCompile(t, w, plainReturnedInferTarget, map[string]string{"main.vibe": source})
			defer before.Remove()
			repaired := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{VIPOnly: true})
			files := map[string]string{"main.vibe": source}
			for name, file := range repaired.Files {
				files[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if repaired.Err != nil || len(repaired.Refused) != 0 || strings.Contains(files["main.vibe"], "infer ") {
				Gap(t, plainReturnedInferTarget, "repair:"+key, "%s; err=%v refused=%+v\n%s", plainReturnedInferQuote, repaired.Err, repaired.Refused, Archive(files))
			}
			after := toolsCompile(t, w, plainReturnedInferTarget, files)
			defer after.Remove()
			reference := toolsCompile(t, w, plainReturnedInferTarget, map[string]string{"main.ts": twin})
			defer reference.Remove()
			if !toolsErrorFree(after) || !toolsErrorFree(reference) {
				Gap(t, plainReturnedInferTarget, "typing:"+key, "repair %v; native twin %v\n%s", SortedKeys(Keys(after.Dir, after.Diagnostics)), SortedKeys(Keys(reference.Dir, reference.Diagnostics)), Archive(files))
			}
			if mismatch := toolsContractMismatch(t, w, reference, after, false); mismatch != "" {
				Gap(t, plainReturnedInferTarget, "declarations:"+key, "%s", mismatch)
			}
			again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{VIPOnly: true})
			if again.Err != nil || len(again.Files) != 0 {
				Gap(t, plainReturnedInferTarget, "idempotence:"+key, "second repair changed source: %v %v", again.Err, again.Order)
			}
		})
	})
}
