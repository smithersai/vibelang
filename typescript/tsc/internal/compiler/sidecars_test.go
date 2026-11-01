package compiler

import (
	"fmt"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"strings"
	"testing"
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

func TestRelocatedSidecarTextNamesVibeModuleEverywhereADeclarationNamesOne(t *testing.T) {
	t.Parallel()
	resolve := func(specifier string) string {
		if specifier == "./Ω.js" {
			return "/src/Ω.js"
		}
		if specifier == "./user.js" {
			return "/src/user.vibe"
		}
		return tspath.ResolvePath("/src", specifier)
	}
	for _, test := range []struct{ name, declaration, want string }{
		{"import", `import { User } from "./user.js";`, `import { User } from "./user.vibe";`},
		{"re-export", `export * from "./user.js";`, `export * from "./user.vibe";`},
		{"import type", `export type U = import("./user.js").User;`, `export type U = import("./user.vibe").User;`},
		{"require", `import user = require("./user.js");`, `import user = require("./user.vibe");`},
		{"augmentation", "declare module \"./user.js\" {\n}", "declare module \"./user.vibe\" {\n}"},
		{"a TypeScript module stays", `export * from "./other.js";`, `export * from "./other.js";`},

		{"escaped Unicode", `export * from "./\u03A9.js";`, `export * from "./\u03A9.js";`},
		{"single quote", `export * from './user.js';`, `export * from './user.vibe';`},
		{"comment stays", `// export * from "./user.js";`, `// export * from "./user.js";`},
		{"a string type stays", `export declare const path: "./user.js";`, `export declare const path: "./user.js";`},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			got := relocatedSidecarText(test.declaration, "/out/index.d.ts", "/src", resolve, tspath.CaseSensitive)
			if got != test.want {
				t.Fatalf("relocatedSidecarText(%q) = %q, want %q", test.declaration, got, test.want)
			}
		})
	}
}

func TestSidecarTextResolvesFromFinalOutput(t *testing.T) {
	t.Parallel()
	resolve := func(specifier string) string {
		switch specifier {
		case "./tag":
			return "/pkg/generated/src/tag/index.vibe"
		case ".", "./":
			return "/pkg/src"
		case "..", "../":
			return "/pkg"
		case "./hidden":
			return "/pkg/generated/src/.hidden.vibe"
		default:
			return "/pkg/src/helper.js"
		}
	}
	for _, test := range []struct{ name, declaration, want string }{
		{"native", `import type { Helper } from "./helper.js";`, `import type { Helper } from "../../src/helper.js";`},
		{"Vibe directory", `export type T = import("./tag").Tag;`, `export type T = import("./tag/index.vibe").Tag;`},
		{"hidden name", `export * from "./hidden";`, `export * from "./.hidden.vibe";`},
		{"directory root", `export * from ".";`, `export * from "../../src";`},
		{"directory root slash", `export * from "./";`, `export * from "../../src";`},
		{"parent root", `export * from "..";`, `export * from "../..";`},
		{"parent root slash", `export * from "../";`, `export * from "../..";`},
		{"reference", `/// <reference path="../shared.d.ts" />`, `/// <reference path="../../../public/shared.d.ts" />`},
	} {
		t.Run(test.name, func(t *testing.T) {
			got := relocatedSidecarText(test.declaration, "/public/src/index.d.ts", "/pkg/generated/src", resolve, tspath.CaseSensitive)
			if got != test.want {
				t.Fatalf("got %q, want %q", got, test.want)
			}
		})
	}
}

// The sidecar callback uses forced declaration emit, but it must still honor
// the same output-path block as ordinary declaration emit.
func TestSidecarOverwriteInput(t *testing.T) {
	for _, layout := range []string{"", ".vibe/declarations", "types"} {
		for _, noEmit := range []bool{false, true} {
			for _, explicit := range []bool{false, true} {
				t.Run(fmt.Sprintf("layout=%s/noEmit=%t/files=%t", layout, noEmit, explicit), func(t *testing.T) {
					sidecar := "main.d.vibe.ts"
					if layout != "" {
						sidecar = layout + "/" + sidecar
					}
					stale := ".vibe/declarations/main.d.vibe.ts"
					if layout != "" {
						stale = "main.d.vibe.ts"
					}
					setting := ""
					if layout != "" {
						setting = fmt.Sprintf(`,"sidecarDir":%q`, layout)
					}
					config := fmt.Sprintf(`{"compilerOptions":{"noLib":true,"noEmit":%t},"vibe":{"effectGlobals":false,"effectModules":false%s},`, noEmit, setting)
					if explicit {
						config += fmt.Sprintf(`"files":["main.vibe",%q]}`, sidecar)
					} else {
						config += `"include":["*"]}`
					}
					original := "// hand-written\r\nexport declare const original: unique symbol;\r\n"
					fs := vfstest.FromMap(map[string]any{
						"/src/tsconfig.json": config,
						"/src/main.vibe":     "export const value = 42;",
						"/src/" + sidecar:    original,
						"/src/" + stale:      original,
					}, tspath.CaseSensitive)
					parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", nil, nil, fs, nil)
					if len(ds) != 0 {
						t.Fatal(ds)
					}
					p := NewProgram(ProgramOptions{Config: parsed, Host: NewCompilerHost(fs, "/", nil, nil, nil)})
					count := 0
					for _, d := range p.GetProgramDiagnostics() {
						if d.Code() == 5055 {
							count++
						}
					}
					if count != core.IfElse(explicit, 1, 0) {
						t.Fatalf("TS5055 count=%d, explicitly listed=%t", count, explicit)
					}
					written := false
					result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
						written = true
						return fs.WriteFile(tspath.RootedFilePathFromNormalized(name), text)
					}, fs)
					if result == nil || result.EmitSkipped != explicit {
						t.Fatalf("emit result=%+v, explicitly listed=%t", result, explicit)
					}
					if written == explicit {
						t.Fatalf("sidecar written=%t, explicitly listed=%t", written, explicit)
					}
					if explicit {
						if got, _ := fs.ReadFile(tspath.RootedFilePathFromNormalized("/src/" + stale)); got != original {
							t.Fatalf("blocked write removed stale bytes: %q", got)
						}
						if got, _ := fs.ReadFile(tspath.RootedFilePathFromNormalized("/src/" + sidecar)); got != original {
							t.Fatalf("input bytes changed: %q", got)
						}
					}
				})
			}
		}
	}
}
