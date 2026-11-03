package vibelangfuzz

import (
	"fmt"
	"strings"
	"testing"
)

const serviceShapeRenameQuote = "declare namespace Users { type Shape = $Users$Shape }"

func TestServiceShapeRenameQuoted(t *testing.T) {
	if !strings.Contains(SpecText("005-services.md"), serviceShapeRenameQuote) {
		t.Fatal("VIP-9 class/Shape namespace counterpart changed")
	}
}

// VIP-9 supplies the class and its Shape namespace as one declaration. Reuse
// the reference/rename metamorphic oracle across direct, qualified and imported
// spellings, including aliases, foreign Context keys and a shadowing service.
func FuzzServiceShapeRename(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"local", "namespace", "import", "foreign", "shadow"} {
		f.Add(key, byte(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, choice byte) {
		kinds := []string{"local", "namespace", "import", "foreign", "shadow"}
		if !strings.Contains("|"+strings.Join(kinds, "|")+"|", "|"+key+"|") || key == "" {
			key = kinds[int(choice)%len(kinds)]
		}
		name := []string{"Settings", "Flags", "Café"}[int(choice)%3]
		declaration := fmt.Sprintf(`service %s { static readonly key="tests/Settings"; prefix:string; static readonly fallback:%s.Shape={prefix:"x"} }`, name, name)
		prefix, qualifier, probeName := declaration, name, name
		files := map[string]string{}
		switch key {
		case "namespace":
			prefix = "namespace Tags { export " + declaration + " }"
			qualifier = "Tags." + name
		case "import":
			files["settings.vibe"] = "export " + declaration
			prefix = fmt.Sprintf(`import { %s as Local } from "./settings.vibe"`, name)
			qualifier = "Local"
			probeName = "Local"
		case "foreign":
			files["settings.ts"] = fmt.Sprintf(`import { Context } from "effect"; export class %s extends Context.Service<%s,{readonly prefix:string}>()("tests/Settings") {}`, name, name)
			prefix = fmt.Sprintf(`import { %s as Local } from "./settings.js"`, name)
			qualifier = "Local"
			probeName = "Local"
		case "shadow":
			prefix += fmt.Sprintf(` function inner(){ service %s {static readonly key="tests/Inner"; prefix:number}; const value:%s.Shape={prefix:1};return value.prefix }`, name, name)
		}
		files["main.vibe"] = prefix + fmt.Sprintf(`; export function label(x:%s.Shape){return x.prefix};export const key=%s`, qualifier, qualifier)
		r := toolsCompile(t, w, consistencyTarget, files)
		defer r.Remove()
		if HasError(r.Diagnostics) {
			t.Fatalf("service spelling must type-check: %v\n%s", Keys(r.Dir, r.Diagnostics), Archive(files))
		}
		c := &consistency{t: t, ctx: t.Context(), w: w, main: "main.vibe", archive: Archive(files)}
		c.before = c.project(r, files)
		for _, symbol := range c.symbols() {
			if symbol.name != name || symbol.kind != "ClassDeclaration" {
				continue
			}
			for _, ref := range symbol.refs {
				if files[c.main][ref.start:ref.end] != probeName {
					continue
				}
				probe := consistencyProbe{consistencySymbol: symbol, consistencyRef: ref}
				refs := c.checkReferences(probe)
				if refs == nil {
					t.Fatal("service qualifier has no references")
				}
				c.checkRename(probe, refs)
				return
			}
		}
		t.Fatal("service qualifier was not probed")
	})
}
