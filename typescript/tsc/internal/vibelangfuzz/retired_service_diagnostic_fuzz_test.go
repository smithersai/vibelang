package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
)

const retiredServiceDiagnosticTarget = "FuzzRetiredServiceClassDiagnostic"
const retiredServiceDiagnosticQuote = "Legacy `service class Name { members }` is not a service production and reports `EK0909`."

func TestRetiredServiceClassDiagnosticQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", retiredServiceDiagnosticQuote)
}

func FuzzRetiredServiceClassDiagnostic(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", retiredServiceDiagnosticQuote)
	keys := []string{"property", "method", "readonly", "recursive", "shape", "reference"}
	for _, key := range keys {
		for _, mode := range []byte{0, 7, 31} {
			f.Add(key, mode)
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		if !slices.Contains(keys, key) {
			key = keys[len(key)%len(keys)]
		}
		separator := []string{" ", " /*keep*/ ", "\t", "\u00a0"}[int(mode>>2)%4]
		body := map[string]string{
			"property":  "value:number",
			"method":    "read():number",
			"readonly":  "readonly value:string",
			"recursive": "value:number; next?:Port.Shape",
			"shape":     "",
			"reference": "static readonly defaultValue=()=>({value:7}); value:number",
		}[key]
		annotation := ""
		if key == "shape" {
			annotation = ": {readonly value:number}"
		}
		for _, legacy := range []bool{true, false} {
			keyword := "service"
			if legacy {
				keyword += separator + "class"
			}
			declaration := keyword + " Port" + annotation + " {static readonly key=\"fuzz/retired-service\";" + body + "}"
			source := "export " + declaration + "\nexport const held=Port;"
			if mode&2 != 0 {
				source = "namespace Catalog {export " + declaration + "}\nexport const held=Catalog.Port;"
			}
			if mode&1 != 0 {
				source = "// retained declaration trivia\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
			}
			file := "main.vibe"
			if mode&16 != 0 {
				file = "main.vibex"
			}
			config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","strict":true,"skipLibCheck":true,"types":[],"jsx":"preserve","noEmit":true},"files":[%q]}`, file)
			result, err := w.Compile(t.Context(), Project{Files: map[string]string{file: source, "package.json": servicesPackage}, Config: config})
			if err != nil {
				t.Fatal(err)
			}
			defer result.Remove()
			var codes []string
			for _, d := range result.Diagnostics {
				if d.Category() != diagnostics.CategoryError && d.Category() != diagnostics.CategoryWarning {
					continue
				}
				origin := d.Source()
				if origin == "" {
					origin = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%04d:%d", origin, d.Code(), d.Category()))
			}
			want := []string(nil)
			if legacy {
				want = []string{fmt.Sprintf("EK0909:%d", diagnostics.CategoryError)}
			}
			if !slices.Equal(codes, want) {
				Gap(t, retiredServiceDiagnosticTarget, key, "%s; legacy=%t want %v got %v; source=%s", retiredServiceDiagnosticQuote, legacy, want, codes, source)
				return
			}
		}
		ExpectPending(t, retiredServiceDiagnosticTarget, key)
		ExpectPending(t, retiredServiceDiagnosticTarget, specCorpusKey(t))
	})
}
