package vibelang

import (
	"fmt"
	"regexp"
	"strings"
	"testing"
)

// Alchemy's EventBridge/ToQueue.vibe (2026-11-04): an inferred return type
// names Providers, which the file never imports. The .vibe build declared it
// as import("..").Providers, the package index that re-exports it; stock tsc
// on the TypeScript twin declares import("../Providers.ts").Providers. The
// extra index import put the whole package in every consumer's program, so
// Git's Hasher/LambdaFunction.d.ts named root @alchemy.run/aws and loaded
// EKS's registry augmentation. A .vibe file declares the module tsc names.
var reexportImportType = regexp.MustCompile(`import\("([^"]*)"\)\.Providers`)

func reexportContainerFiles(declaring, reexporter, consumer string, named bool, depth int) (map[string]string, string) {
	files := computedKeyFiles(false)
	files["/workspace/x/src/tsconfig.json"] = `{"compilerOptions":{"strict":true,"target":"ESNext","module":"Preserve","moduleResolution":"Bundler","declaration":true,"outDir":"lib","rootDir":".","allowImportingTsExtensions":true,"rewriteRelativeImportExtensions":true},"include":["**/*.ts","**/*.vibe"],"exclude":["node_modules","lib"]}`
	files["/workspace/x/src/Providers."+declaring] = "export interface Providers { readonly region: string }\n"
	reexport := `export * from "./Providers.` + declaring + `";` + "\n"
	if named {
		reexport = `export type { Providers } from "./Providers.` + declaring + `";` + "\n"
	}
	files["/workspace/x/src/index."+reexporter] = reexport + `export * from "./Rule.` + consumer + `";` + "\n"
	files["/workspace/x/src/Rule."+consumer] = `import * as Effect from "effect/Effect";` + "\n" +
		`import type { Providers } from "./Providers.` + declaring + `";` + "\n" +
		"export declare const rule: () => Effect.Effect<number, never, Providers>;\n"
	dir, up := "/workspace/x/src/", ""
	for range depth {
		dir, up = dir+"sub/", up+"../"
	}
	files[dir+"ToQueue."+consumer] = `import { rule } from "` + up + `Rule.` + consumer + `";` + "\n" + "export const toQueue = () => rule();\n"
	return files, strings.TrimPrefix(dir, "/workspace/x/src/") + "ToQueue.d.ts"
}

func reexportSpecifier(t *testing.T, files map[string]string, name string) string {
	t.Helper()
	dts := emitDeclarationsOf(t, files, name)
	m := reexportImportType.FindStringSubmatch(dts)
	if m == nil {
		t.Fatalf("%s names no Providers import type:\n%s", name, dts)
	}
	return m[1]
}

// specifierModule drops the ending, so ../Providers.ts, ../Providers.js and
// ../Providers name the same module.
func specifierModule(specifier string) string {
	for _, ext := range []string{".ts", ".js", ".vibe"} {
		specifier = strings.TrimSuffix(specifier, ext)
	}
	return specifier
}

func TestDeclarationNamesDeclaringModuleNotReexportIndex(t *testing.T) {
	for _, declaring := range []string{"vibe", "ts"} {
		for _, reexporter := range []string{"ts", "vibe"} {
			for _, named := range []bool{false, true} {
				for _, depth := range []int{1, 2} {
					t.Run(fmt.Sprintf("%s-%s-named%v-depth%d", declaring, reexporter, named, depth), func(t *testing.T) {
						twin, name := reexportContainerFiles("ts", "ts", "ts", named, depth)
						want := reexportSpecifier(t, twin, name)
						files, _ := reexportContainerFiles(declaring, reexporter, "vibe", named, depth)
						got := reexportSpecifier(t, files, name)
						if specifierModule(got) != specifierModule(want) {
							t.Fatalf("%s declares import(%q).Providers; the TypeScript twin declares import(%q)", name, got, want)
						}
					})
				}
			}
		}
	}
}
