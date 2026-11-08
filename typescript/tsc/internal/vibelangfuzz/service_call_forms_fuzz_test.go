package vibelangfuzz

import (
	"maps"
	"slices"
	"strings"
)

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
