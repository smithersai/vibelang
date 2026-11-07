package compiler_test

import (
	"fmt"
	"strings"
	"testing"
	"unicode"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-40: "`main.vibe.parse.d.ts` is also written beside that sidecar, so
// stock `tsc` resolves the sidecar's relative import from the sidecar's actual
// location: beside `main.vibe` by default, or at the mirrored path under
// `vibe.sidecarDir`." The fuzzer varies the sidecar directory, the source's
// directory and the body's name; the sidecar must name the body as a sibling
// and the body's declaration must sit there, never beside a relocated source.
//
// rule-evidence: docs/design/vips/0040-module-declarations.md#41699fff05dc8475
func FuzzModuleBodyDeclarationBesideSidecar(f *testing.F) {
	f.Add("", "", "parse")
	f.Add("types", "", "parse")
	f.Add(".vibe/declarations", "lib", "parse")
	f.Add("out/types", "a/b", "Text")
	f.Add("types", "lib", "_x9")
	f.Fuzz(func(t *testing.T, layout, sub, name string) {
		clean := func(s string) string {
			var parts []string
			for _, part := range strings.Split(s, "/") {
				part = strings.Map(func(r rune) rune {
					if r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '.') {
						return r
					}
					return -1
				}, part)
				if part != "" && strings.Trim(part, ".") != "" && len(parts) < 3 {
					parts = append(parts, part)
				}
			}
			return strings.Join(parts, "/")
		}
		layout, sub = clean(layout), clean(sub)
		if strings.HasPrefix(layout+"/", "node_modules/") || strings.Contains("/"+layout+"/", "/node_modules/") {
			t.Skip()
		}
		body := strings.Map(func(r rune) rune {
			if r < 128 && (unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_') {
				return r
			}
			return -1
		}, name)
		if body == "" || unicode.IsDigit(rune(body[0])) || len(body) > 12 {
			body = "parse"
		}
		// The encoded stem keeps a-z, 0-9 and _ and writes other code points
		// as -hex- (VIP-40); ASCII letters in upper case are the only others here.
		var stem strings.Builder
		for _, r := range body {
			if r >= 'A' && r <= 'Z' {
				fmt.Fprintf(&stem, "-%x-", r)
			} else {
				stem.WriteRune(r)
			}
		}
		source := "/src/main.vibe"
		if sub != "" {
			source = "/src/" + sub + "/main.vibe"
		}
		files := map[string]any{
			"/src/package.json":  `{"type":"module"}`,
			"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"strict":true,"target":"esnext","module":"esnext","moduleResolution":"bundler","noEmit":true,"rootDir":"."},"vibe":{"effectGlobals":false,"effectModules":false,"sidecarDir":%q},"files":[%q]}`, layout, strings.TrimPrefix(source, "/src/")),
			source:               fmt.Sprintf("module %s {\n  export function port(raw: string): number { return Number(raw) }\n}\nexport { port } from %s\n", body, body),
		}
		fs := bundled.WrapFS(vfstest.FromMap(files, tspath.CaseSensitive))
		config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 {
			t.Fatal(ds)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
		emitted := map[string]string{}
		result := p.EmitDeclarationSidecars(t.Context(), func(name, text string) error { emitted[name] = text; return nil })
		if result == nil || result.EmitSkipped || len(result.Diagnostics) != 0 {
			t.Fatalf("sidecar emit: %+v", result)
		}
		dir := tspath.GetDirectoryPath(source)
		if layout != "" {
			dir = tspath.CombinePaths("/src", layout, sub)
		}
		declaration := tspath.CombinePaths(dir, "main.vibe."+stem.String()+".d.ts")
		sidecar := emitted[tspath.CombinePaths(dir, "main.d.vibe.ts")]
		if !strings.Contains(sidecar, fmt.Sprintf("%q", "./main.vibe."+stem.String()+".js")) {
			t.Fatalf("sidecar does not name its sibling body declaration: %q (%v)", sidecar, emitted)
		}
		if !strings.Contains(emitted[declaration], "port(raw: string): number") {
			t.Fatalf("no body declaration at %s: %v", declaration, emitted)
		}
		for name := range emitted {
			if strings.HasSuffix(name, ".d.ts") && name != declaration {
				t.Fatalf("body declaration also written at %s (want only %s)", name, declaration)
			}
		}
	})
}
