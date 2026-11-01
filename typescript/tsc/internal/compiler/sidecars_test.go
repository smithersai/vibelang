package compiler

import (
	"fmt"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

func TestSidecarTextNamesVibeModuleEverywhereADeclarationNamesOne(t *testing.T) {
	t.Parallel()
	exists := func(path string) bool { return path == "/src/user.vibe" }
	for _, test := range []struct{ name, declaration, want string }{
		{"import", `import { User } from "./user.js";`, `import { User } from "./user.vibe";`},
		{"re-export", `export * from "./user.js";`, `export * from "./user.vibe";`},
		{"import type", `export type U = import("./user.js").User;`, `export type U = import("./user.vibe").User;`},
		{"require", `import user = require("./user.js");`, `import user = require("./user.vibe");`},
		{"augmentation", "declare module \"./user.js\" {\n}", "declare module \"./user.vibe\" {\n}"},
		{"a TypeScript module stays", `export * from "./other.js";`, `export * from "./other.js";`},
		{"a string type stays", `export declare const path: "./user.js";`, `export declare const path: "./user.js";`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := sidecarText(test.declaration, "/out/index.d.ts", "/src/index.vibe", exists, tspath.CaseSensitive)
			if got != test.want {
				t.Fatalf("sidecarText(%q) = %q, want %q", test.declaration, got, test.want)
			}
		})
	}
}

// RC-12: explicit source identity survives portable declaration spelling.
// Each native sibling is deliberately absent from files, and must not
// redirect the explicitly selected .vibe export.
func TestSidecarExplicitVibeSpecifierWithNativeSiblings(t *testing.T) {
	for _, extension := range []string{"", ".ts", ".d.ts", ".tsx", ".js"} {
		for _, style := range []string{".js", ".ts", "extensionless"} {
			for _, form := range []string{
				"export { value } from %s",
				"export * from %s",
				"export * as model from %s",
				"import { value } from %s; export { value }",
				"export type T = typeof import(%s).value",
			} {
				t.Run(extension+"/"+style+"/"+form, func(t *testing.T) {
					t.Parallel()
					files := map[string]any{
						"/src/package.json":  `{"type":"module"}`,
						"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"noLib":true,"module":"esnext","moduleResolution":"bundler","outDir":"out","declaration":true},"vibelang":{"declarationImportStyle":%q},"files":["main.vibe"]}`, style),
						"/src/main.vibe":     fmt.Sprintf(form, `"./model.vibe"`),
						"/src/model.vibe":    `export const value: "vibe" = "vibe"`,
					}
					if extension != "" {
						files["/src/model"+extension] = `export declare const value: "native"`
					}
					fs := vfstest.FromMap(files, tspath.CaseSensitive)
					config, diagnostics := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
					if len(diagnostics) != 0 {
						t.Fatal(diagnostics)
					}
					p := NewProgram(ProgramOptions{Config: config, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
					var main string
					p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
						if name == "/src/main.d.vibe.ts" {
							main = text
						}
						return nil
					})
					if !strings.Contains(main, `"./model.vibe"`) || strings.Contains(main, `"./model.js"`) {
						t.Fatalf("sidecar lost explicit source identity:\n%s", main)
					}
				})
			}
		}
	}
}
