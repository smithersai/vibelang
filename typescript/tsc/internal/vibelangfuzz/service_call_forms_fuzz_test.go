package vibelangfuzz

import (
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// FuzzVIPServiceCallForms checks --fix-vip-only and plain --fix on the call
// form of service access that compilers before explicit effects accepted, try
// FileSystem.FileSystem(), over each tag kind and each kind of effect code.
// After explicit effects the form is TS2349 or TS2348 (t3code:
// vip-migration:service-access-call-form, 31 sites in 13 modules). The oracle:
// the VIP pass writes exactly the bare form, try FileSystem.FileSystem; plain
// --fix, which may also shorten imports, leaves no call of the tag; each result
// compiles; a second pass writes nothing. A function whose call returns an
// Effect is the control: it keeps its parentheses.
//
// An input is "<tag>:<owner>"; other bytes pick by index.
func FuzzVIPServiceCallForms(f *testing.F) {
	startShortBudget(f)
	for _, tag := range slices.Sorted(maps.Keys(serviceCallTags)) {
		for _, owner := range slices.Sorted(maps.Keys(serviceCallOwners)) {
			f.Add([]byte(tag + ":" + owner))
		}
	}
	env := newVIPEnv(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, source, want := serviceCallInput(data)
		if source == "" {
			t.Skip("the input names no form")
		}
		for _, mode := range []struct {
			name    string
			options vibelang.FixOptions
		}{{"vip", vibelang.FixOptions{VIPOnly: true}}, {"plain", vibelang.FixOptions{}}} {
			id := mode.name + "/" + key
			files := map[string]string{"main.vibe": source, "tags.ts": serviceCallTagsModule}
			old := legacyCompile(t, env, files)
			defer old.Remove()
			result := fixServiceCalls(t, env, old, mode.options)
			var report strings.Builder
			result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
			if result.Err != nil || len(result.Refused) > 0 {
				Gap(t, "FuzzVIPServiceCallForms", "refused/"+id, "--fix refused or did not converge (%v):\n%s\nsource:\n%s", result.Err, report.String(), source)
			}
			got := source
			for name, file := range result.Files {
				if strings.HasSuffix(name.AsString(), "main.vibe") {
					got = file.Text
				}
			}
			if mode.name == "vip" && got != want {
				Gap(t, "FuzzVIPServiceCallForms", "rewrite/"+id, "--fix-vip-only wrote\n%s\nwant\n%s", got, want)
			}
			if mode.name == "plain" && strings.Contains(want, "try make()") != strings.Contains(got, "()\n") {
				Gap(t, "FuzzVIPServiceCallForms", "rewrite/"+id, "--fix wrote\n%s\nwant the call form only in the control", got)
			}
			after := legacyCompile(t, env, map[string]string{"main.vibe": got, "tags.ts": serviceCallTagsModule})
			defer after.Remove()
			if errors := legacyErrors(after); len(errors) > 0 {
				Gap(t, "FuzzVIPServiceCallForms", "compile/"+id, "the migrated program does not compile: %s\nmigrated:\n%s", strings.Join(errors, "\n"), got)
			}
			if again := fixServiceCalls(t, env, after, mode.options); len(again.Files) != 0 {
				Gap(t, "FuzzVIPServiceCallForms", "fixed-point/"+id, "a second --fix wrote files:\n%s", got)
			}
		}
	})
}

func fixServiceCalls(t *testing.T, env *vipEnv, compiled *Result, options vibelang.FixOptions) *vibelang.FixResult {
	t.Helper()
	config := toolsConfig(env.w, compiled.Dir)
	if config == nil || len(config.Errors) > 0 {
		t.Fatalf("config of the program: %v", config)
	}
	var result *vibelang.FixResult
	Within("fix", func() {
		result = vibelang.FixProjectWithOptions(t.Context(), env.w.fs, bundled.LibPath(), config, options)
	})
	return result
}

const serviceCallTagsModule = `import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
export class ClassTag extends Context.Service<ClassTag, { readonly v: number }>()("ClassTag") {}
export const Plat = Context.Reference<{ readonly os: string }>("Plat", { defaultValue: () => ({ os: "x" }) })
export const make = () => Effect.succeed(1)
`

// serviceCallTags are the callee that follows try, the import that names it,
// and what the migration writes for the whole call.
var serviceCallTags = map[string]struct{ imports, call, bare string }{
	"service-member":      {`import * as FileSystem from "effect/FileSystem"`, "FileSystem.FileSystem()", "FileSystem.FileSystem"},
	"namespace-same-name": {`import * as Path from "effect/Path"`, "Path()", "Path.Path"},
	"class-tag":           {`import { ClassTag } from "./tags.js"`, "ClassTag()", "ClassTag"},
	"reference":           {`import { Plat } from "./tags.js"`, "Plat()", "Plat"},
	"namespace-reference": {`import * as Tags from "./tags.js"`, "Tags.Plat()", "Tags.Plat"},
	"callable-control":    {`import { make } from "./tags.js"`, "make()", "make()"},
}

// serviceCallOwners are the kinds of effect code that hold the read.
var serviceCallOwners = map[string]string{
	"effect-block":    "export const g = effect {\n  const s = try READ\n  return String(s !== undefined)\n}\n",
	"effect-function": "export effect function g() {\n  const s = try READ\n  return String(s !== undefined)\n}\n",
	"effect-arrow":    "export const g = effect () => {\n  const s = try READ\n  return String(s !== undefined)\n}\n",
	"nested-block":    "export effect function g(flag: boolean) {\n  if (flag) {\n    const s = try READ\n    return String(s !== undefined)\n  }\n  return \"\"\n}\n",
}

func serviceCallInput(data []byte) (key, source, want string) {
	tags := slices.Sorted(maps.Keys(serviceCallTags))
	owners := slices.Sorted(maps.Keys(serviceCallOwners))
	tag, owner, _ := strings.Cut(string(data), ":")
	if serviceCallTags[tag].call == "" || serviceCallOwners[owner] == "" {
		if len(data) < 2 {
			return "", "", ""
		}
		tag, owner = tags[int(data[0])%len(tags)], owners[int(data[1])%len(owners)]
	}
	form := serviceCallTags[tag]
	head := form.imports + "\n\n"
	return tag + ":" + owner,
		head + strings.ReplaceAll(serviceCallOwners[owner], "READ", form.call),
		head + strings.ReplaceAll(serviceCallOwners[owner], "READ", form.bare)
}
