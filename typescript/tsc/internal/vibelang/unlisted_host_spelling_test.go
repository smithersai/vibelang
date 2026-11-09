package vibelang

import (
	"fmt"
	"strings"
	"testing"
)

func TestUnlistedHostSpelling(t *testing.T) {
	rows := []struct {
		key, name, typo, binding string
		banned                   bool
	}{
		{"mutation", "MutationObserver", "MutatonObserver", "host", true},
		{"wasm", "WebAssembly", "WebAssemby", "host", true},
		{"screen", "screen", "screeen", "host", true},
		{"status", "status", "statuz", "host", true},
		{"allow-url", "URLSearchParams", "URLSearchParmas", "host", false},
		{"allow-encoder", "TextEncoder", "TextEnocder", "host", false},
		{"ecma", "ArrayBuffer", "ArrayBufferr", "host", false},
		{"local-status", "status", "statuz", "local", false},
		{"declared-status", "status", "statuz", "declared", false},
	}
	for _, row := range rows {
		for _, ext := range []string{".vibe", ".vibex", ".ts", ".tsx"} {
			forms := []string{"value", "query", "namespace"}
			if row.name == "WebAssembly" {
				forms = append(forms, "qualified", "qualified-value")
			}
			switch row.name {
			case "MutationObserver", "URLSearchParams", "TextEncoder", "ArrayBuffer":
				forms = append(forms, "type")
			}
			if row.banned {
				forms = append(forms, "host", "host-type")
			}
			for _, form := range forms {
				t.Run(fmt.Sprintf("%s/%s/%s", row.key, ext, form), func(t *testing.T) {
					source := "export const value = " + row.typo
					if form == "qualified" {
						source = "export type Value = " + row.typo + ".Module"
					}
					if form == "qualified-value" {
						source += ".Module"
					}
					if form == "type" {
						source = "export type Value = " + row.typo
					}
					if form == "query" {
						source = "export type Value = typeof " + row.typo
					}
					if form == "host" {
						source = "export const value = " + row.name
					}
					if form == "host-type" {
						source = "export type Value = typeof " + row.name
					}
					if row.binding == "local" {
						source = "const status = 'ready'; " + source
					}
					if form == "namespace" {
						source = "namespace App { " + source + " }"
					}
					files := computedKeyFiles(false)
					delete(files, "/workspace/x/src/main.vibe")
					libs := `["ESNext","DOM"]`
					extra := ""
					if row.binding == "declared" {
						libs = `["ESNext"]`
						extra = `,"own.d.ts"`
						files["/workspace/x/src/own.d.ts"] = "declare var status: string;"
					}
					files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"NodeNext","types":[],"lib":` + libs + `},"files":["main` + ext + `"` + extra + `]}`
					files["/workspace/x/src/main"+ext] = source
					ds := computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil)
					native := ext == ".ts" || ext == ".tsx"
					if form == "host-type" || (form == "host" && native) {
						if len(ds) != 0 {
							t.Fatalf("valid control: %v", ds)
						}
						return
					}
					if len(ds) != 1 {
						t.Fatalf("invalid fixture: %v", ds)
					}
					d := ds[0]
					if form == "host" {
						if d.Source() != diagnosticSource || d.Code() != 4402 {
							t.Errorf("host binding must be banned: %s", d.String())
						}
						return
					}
					allowed := !row.banned || native || form == "query" || form == "type" || form == "qualified"
					want := int32(2304)
					if allowed {
						want = 2552
					}
					if form == "qualified" {
						want = 2833
					}
					if d.Source() != "" || d.Code() != want || d.Category() != errorCategory {
						t.Errorf("want native TS%d, got %s", want, d.String())
					}
					if d.File().Text()[d.Pos():d.End()] != row.typo {
						t.Errorf("typo span changed: %s", d.String())
					}
					if allowed && !strings.Contains(d.String(), "Did you mean '"+row.name+"'") {
						t.Errorf("native suggestion missing: %s", d.String())
					}
				})
			}
		}
	}
}
