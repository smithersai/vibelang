package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"slices"
	"strings"
	"testing"
)

func TestRelocatedSidecarLayoutQuoted(t *testing.T) {
	if !strings.Contains(SpecText("007-tooling.md"), "Workspace package imports use the owning config") {
		t.Fatal("owning sidecar mapping authority changed")
	}
}
func FuzzRelocatedSidecarLayout(f *testing.F) {
	startShortBudget(f)
	for _, explicit := range []bool{false, true} {
		for _, mapped := range []bool{false, true} {
			f.Add(explicit, mapped, uint8(0))
			f.Add(explicit, mapped, uint8(7))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, explicit, mapped bool, variation uint8) {
		TestRelocatedSidecarLayoutQuoted(t)
		stem := []string{"Stage", "Entry", "Node"}[variation%3]
		prefix := ""
		if explicit {
			prefix = "src/"
		}
		if !mapped {
			if prefix == "" {
				prefix = "src/"
			} else {
				prefix = ""
			}
		}
		sidecar := "a/.vibe/declarations/" + prefix + stem + ".d.vibe.ts"
		options := map[string]any{"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "types": []string{}, "skipLibCheck": true, "noEmit": true, "allowArbitraryExtensions": true, "rewriteRelativeImportExtensions": true}
		owner := map[string]any{"compilerOptions": options, "include": []string{"src"}, "vibe": map[string]any{"sidecarDir": ".vibe/declarations"}}
		if explicit {
			options["rootDir"] = "."
		}
		ownerJSON, _ := json.Marshal(owner)
		config := map[string]any{"compilerOptions": map[string]any{"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "types": []string{}, "skipLibCheck": true, "noEmit": true, "allowArbitraryExtensions": true, "rewriteRelativeImportExtensions": true, "paths": map[string]any{"stage-alias": []string{"./" + sidecar}}}, "files": []string{"main.ts"}}
		encoded, _ := json.Marshal(config)
		files := map[string]string{
			"package.json":            `{"type":"module"}`,
			"main.ts":                 "import {Stage} from 'stage-alias';import {use} from './a/src/Use.js';export const run=(s:Stage)=>use(s);",
			"a/package.json":          `{"name":"producer","type":"module"}`,
			"a/tsconfig.json":         string(ownerJSON),
			"a/src/" + stem + ".vibe": "export class Stage {private readonly brand=1;constructor(readonly name:string){}}",
			"a/src/Use.ts":            "import {Stage} from './" + stem + ".vibe';export const use=(s:Stage)=>s.name;",
			sidecar:                   "export declare class Stage {private readonly brand;readonly name:string;constructor(name:string)}",
		}
		r, err := w.Compile(t.Context(), Project{Files: files, Config: string(encoded)})
		if err != nil {
			t.Fatal(err)
		}
		got := r3Errors(r.Diagnostics)
		r.Remove()
		slices.Sort(got)
		var want []string
		if !mapped {
			want = []string{"TS2345"}
		}
		if !slices.Equal(got, want) {
			Gap(t, "FuzzRelocatedSidecarLayout", fmt.Sprintf("explicit=%t/mapped=%t/%d", explicit, mapped, variation), "only proven owning-root mappings join source identity; got %v, want %v", got, want)
		}
	})
}
