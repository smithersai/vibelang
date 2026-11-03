package vibelangfuzz

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const sidecarExtensionIdentityQuote = "A non-relative import reaching a known compatibility declaration uses its available mapped source only when TypeScript's final resolved path is outside " + string(rune(96)) + "node_modules" + string(rune(96)) + "."

func sidecarExtensionIdentityQuoted(t testing.TB) {
	if !strings.Contains(SpecText("007-tooling.md"), sidecarExtensionIdentityQuote) {
		t.Fatal("chapter 007 lost module-identity rule")
	}
	sidecarSourceIdentityQuoted(t)
}

func TestSidecarExtensionIdentityQuoted(t *testing.T) { sidecarExtensionIdentityQuoted(t) }

func FuzzSidecarExtensionIdentity(f *testing.F) {
	startShortBudget(f)
	sidecarExtensionIdentityQuoted(f)
	for _, ext := range []string{"vibe", "vibex"} {
		for _, layout := range []string{"adjacent", "mirrored"} {
			for _, importer := range []string{"ts", "vibe", "vibex"} {
				f.Add([]byte(ext + "/" + layout + "/" + importer))
				f.Add([]byte(ext + "/" + layout + "/" + importer + "/published"))
			}
		}
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		const target = "FuzzSidecarExtensionIdentity"
		defer recoverCompilerPanic(t, target)
		index := 0
		if len(data) != 0 {
			index = int(data[0]) % 12
		}
		ext, layout, importer := []string{"vibe", "vibex"}[index/6], []string{"adjacent", "mirrored"}[(index/3)%2], []string{"ts", "vibe", "vibex"}[index%3]
		parts := strings.Split(string(data), "/")
		if len(parts) == 3 && (parts[0] == "vibe" || parts[0] == "vibex") && (parts[1] == "adjacent" || parts[1] == "mirrored") && (parts[2] == "ts" || parts[2] == "vibe" || parts[2] == "vibex") {
			ext, layout, importer = parts[0], parts[1], parts[2]
		}
		published := len(parts) == 4 && parts[3] == "published" && (parts[0] == "vibe" || parts[0] == "vibex") && (parts[1] == "adjacent" || parts[1] == "mirrored") && (parts[2] == "ts" || parts[2] == "vibe" || parts[2] == "vibex")
		if published {
			ext, layout, importer = parts[0], parts[1], parts[2]
		}
		compile := func() {
			t.Helper()
			sourceExt, declExt := ext, ".d."+ext+".ts"
			base, direct := "/app/pkg", "./pkg"
			if published {
				base, direct = "/app/node_modules/lib", "./node_modules/lib"
			}
			source := base + "/Stage." + sourceExt
			sidecar := base + "/Stage" + declExt
			if layout == "mirrored" {
				sidecar = base + "/types/Stage" + declExt
			}
			entry := "/app/main." + importer
			config, _ := json.Marshal(map[string]any{
				"compilerOptions": map[string]any{"noLib": true, "strict": true, "module": "nodenext", "jsx": "preserve", "noEmit": true, "allowImportingTsExtensions": importer == "ts", "paths": map[string][]string{"lib/Stage": {sidecar}}},
				"files":           []string{entry},
			})
			fs := vfstest.FromMap(map[string]any{
				"/app/package.json":      "{\"type\":\"module\"}",
				"/app/tsconfig.json":     string(config),
				"/app/pkg/tsconfig.json": "{\"vibe\":{\"sidecarDir\":\"types\"}}",
				source:                   "export class Stage { private n = 0 }",
				sidecar:                  "export declare class Stage { private n }",
				entry:                    "import { Stage as Source } from \"" + direct + "/Stage." + sourceExt + "\"; import { Stage as Alias } from \"lib/Stage\"; export const value: Alias = new Source();",
			}, tspath.CaseSensitive)
			parsed, ds := tsoptions.GetParsedCommandLineOfConfigFile("/app/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
			if len(ds) != 0 {
				t.Fatal(ds)
			}
			program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
			ds = program.GetSemanticDiagnostics(t.Context(), nil)
			if published {
				if len(ds) != 1 || ds[0].Code() != 2322 && ds[0].Code() != 2719 {
					Gap(t, target, "published:"+ext+"/"+layout+"/"+importer, "a retained dependency source and declaration keep distinct private identities: %v", ds)
				}
			} else if len(ds) != 0 {
				Gap(t, target, "admission:"+ext+"/"+layout+"/"+importer, "%s: one source module required: %v", sidecarExtensionIdentityQuote, ds)
			}
			if program.GetSourceFile(tspath.RootedFilePath(source)) == nil {
				Gap(t, target, "source:"+ext+"/"+layout+"/"+importer, "source not selected: %s", source)
			}
			if loaded := program.GetSourceFile(tspath.RootedFilePath(sidecar)) != nil; loaded != published {
				Gap(t, target, "identity:"+ext+"/"+layout+"/"+importer, "sidecar loaded as a second module: %s", sidecar)
			}
		}
		compile()
	})
}
