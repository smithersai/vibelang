package vibelangfuzz

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

func TestSchemaAliasNativePropertiesQuoted(t *testing.T) {
	if !strings.Contains(SpecText("006-data.md"), "Mappings preserve TypeScript mutability: properties are writable unless `readonly`") {
		t.Fatal("native schema mutability authority changed")
	}
}
func FuzzSchemaAliasNativeProperties(f *testing.F) {
	startShortBudget(f)
	for flags := uint8(0); flags < 16; flags++ {
		f.Add(flags, false)
		f.Add(flags, true)
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, flags uint8, bad bool) {
		TestSchemaAliasNativePropertiesQuoted(t)
		const target = "FuzzSchemaAliasNativeProperties"
		mutable, optional, nested, imported := flags&1 != 0, flags&2 != 0, flags&4 != 0, flags&8 != 0
		schema := "Schema.String"
		assigned := "'write'"
		if nested {
			schema = "Schema.Struct({value:Schema.String})"
			assigned = "{value:'write'}"
		}
		if optional {
			schema = "Schema.optional(" + schema + ")"
		}
		if mutable {
			schema = "Schema.mutableKey(" + schema + ")"
		}
		prefix := ""
		if imported {
			prefix = "import {Schema} from 'effect';"
		}
		files := map[string]string{
			"main.vibe":     prefix + "export const User=Schema.Struct({name:" + schema + "});export type User=typeof User.Type;",
			"consumer.vibe": "import type {User} from './main.vibe';declare const user:User;user.name=" + assigned + ";",
		}
		if bad {
			files["consumer.vibe"] += "export const invalid:string=1;"
		}
		toolsGuard(t, target, func() {
			before := toolsCompile(t, w, target, files)
			defer before.Remove()
			want := []string{}
			if !mutable {
				want = append(want, "TS2540")
			}
			if bad {
				want = append(want, "TS2322")
			}
			slices.Sort(want)
			original := r3Errors(before.Diagnostics)
			slices.Sort(original)
			if !slices.Equal(original, want) {
				t.Fatalf("native Struct control: got %v want %v", original, want)
			}
			result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{})
			if result.Err != nil || len(result.Refused) != 0 {
				t.Fatalf("repair: %v refused %v", result.Err, result.Refused)
			}
			fixed := maps.Clone(files)
			for name, file := range result.Files {
				fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
			}
			if !strings.Contains(fixed["main.vibe"], "schema User") {
				t.Fatal("no schema alias repair")
			}
			after := toolsCompile(t, w, target, fixed)
			defer after.Remove()
			got := r3Errors(after.Diagnostics)
			slices.Sort(got)
			if !slices.Equal(got, want) {
				t.Fatalf("repair changed native writable properties: got %v want %v source %s", got, want, fixed["main.vibe"])
			}
			if mismatch := toolsContractMismatch(t, w, before, after, false); mismatch != "" {
				t.Fatal(fmt.Sprintf("native API changed: %s", mismatch))
			}
		})
	})
}
