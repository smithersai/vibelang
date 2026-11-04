package vibelang

import (
	"encoding/json"
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"os"
	"slices"
	"testing"
)

func TestQualifiedHostAlias(t *testing.T) {
	var rows []struct {
		Key, Source, Mode string
		Errors            []string
	}
	data, err := os.ReadFile("../vibelangfuzz/testdata/qualified-host-alias.json")
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(data, &rows); err != nil {
		t.Fatal(err)
	}
	for _, row := range rows {
		t.Run(row.Key, func(t *testing.T) {
			files := computedKeyFiles(false)
			files["/workspace/x/src/main.vibe"] = row.Source
			files["/workspace/x/src/tsconfig.json"] = "{\"compilerOptions\":{\"target\":\"ES2022\",\"module\":\"NodeNext\",\"moduleResolution\":\"NodeNext\",\"strict\":true,\"skipLibCheck\":true,\"types\":[],\"noEmit\":true},\"files\":[\"main.vibe\",\"node_modules/@types/node/index.d.ts\"]}"
			for name, text := range map[string]string{"node_modules/@types/node/package.json": `{"name":"@types/node","types":"index.d.ts"}`,
				"node_modules/@types/node/index.d.ts": "declare namespace Bun {namespace platform {const value:number;namespace nested {const value:number;namespace deeper {const value:number}}}}declare namespace HostRuntime {namespace platform {const value:number;namespace nested {const value:number;namespace deeper {const value:number}}}}declare namespace Bun {namespace platform {namespace TypesOnly {interface Value {id:number}}}}declare namespace HostRuntime {namespace platform {namespace TypesOnly {interface Value {id:number}}}}",
				"node_modules/library/package.json":   `{"name":"library","types":"index.d.ts"}`,
				"node_modules/library/index.d.ts":     "export namespace platform {const value:number}",
				"package.json":                        fmt.Sprintf(`{"type":%q}`, row.Mode)} {
				files["/workspace/x/src/"+name] = text
			}
			var codes []string
			for _, d := range computedKeyProgram(t, files).GetSemanticDiagnostics(t.Context(), nil) {
				if d.Category() != diagnostics.CategoryError {
					continue
				}
				prefix := d.Source()
				if prefix == "" {
					prefix = "TS"
				}
				codes = append(codes, fmt.Sprintf("%s%d", prefix, d.Code()))
			}
			slices.Sort(codes)
			if !slices.Equal(codes, row.Errors) {
				t.Fatalf("host-origin value alias: expected %v, got %v", row.Errors, codes)
			}
		})
	}
}
