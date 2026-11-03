package vibelangfuzz

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

// VIP-27: "Declarations are exactly what idiomatic Effect TypeScript would
// declare." Compare the public type of each emitted sidecar with the .ts twin
// using stock TypeScript in both assignment directions; the producer and
// consumer are separate programs, so source resolution cannot hide corruption.
func TestSidecarLiteralDirectivesQuoted(t *testing.T) { sidecarSourceIdentityQuoted(t) }

func FuzzSidecarLiteralDirectives(f *testing.F) {
	startShortBudget(f)
	sidecarSourceIdentityQuoted(f)
	stock := StockTypeScript(f)
	keys := []string{"source-map", "reference", "import", "export", "require"}
	for _, key := range keys {
		f.Add([]byte(key + "/plain/adjacent"))
		f.Add([]byte(key + "/tail/mirrored"))
		f.Add([]byte(key + "/head/mirrored"))
	}
	f.Fuzz(func(t *testing.T, data []byte) {
		t.Parallel()
		key, form, mirrored := keys[0], 0, false
		if len(data) > 0 {
			key = keys[int(data[0])%len(keys)]
			form = int(data[len(data)-1]) % 3
			mirrored = data[0]&1 != 0
		}
		parts := strings.Split(string(data), "/")
		for _, candidate := range keys {
			if parts[0] == candidate {
				key = candidate
			}
		}
		if len(parts) > 1 {
			switch parts[1] {
			case "plain":
				form = 0
			case "tail":
				form = 1
			case "head":
				form = 2
			}
		}
		if len(parts) > 2 {
			mirrored = parts[2] == "mirrored"
		}
		directive := map[string]string{
			"source-map": "//# sourceMappingURL=keep",
			"reference":  "/// <reference path=\"./keep.d.ts\" />",
			"import":     "import type { X } from \"./keep.js\";",
			"export":     "export * from \"./keep.js\";",
			"require":    "import X = require(\"./keep.js\");",
		}[key]
		literal := "`a\n" + directive + "\nz`"
		if form == 1 {
			literal = "`a${T}\n" + directive + "\nz`"
		} else if form == 2 {
			literal = "`a\n" + directive + "\n${T}z`"
		}
		source := "export type Text<T extends string = \"\"> = " + literal + ";\n"
		layout := ""
		output := "/src/main.d.vibe.ts"
		if mirrored {
			layout = ",\"sidecarDir\":\"generated\""
			output = "/src/generated/main.d.vibe.ts"
		}
		fs := vfstest.FromMap(map[string]any{
			"/src/main.vibe":     source,
			"/src/tsconfig.json": fmt.Sprintf(`{"compilerOptions":{"noLib":true},"vibe":{"effectGlobals":false,"effectModules":false%s},"files":["main.vibe"]}`, layout),
		}, tspath.CaseSensitive)
		config, ds := tsoptions.GetParsedCommandLineOfConfigFile("/src/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(ds) != 0 {
			t.Fatal(ds)
		}
		program := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
		var sidecar string
		program.EmitDeclarationSidecars(t.Context(), func(name, text string) error {
			if name == output {
				sidecar = text
			}
			return nil
		})
		if sidecar == "" {
			t.Fatal("sidecar was not emitted")
		}
		dir := t.TempDir()
		files := map[string]string{
			"main.d.vibe.ts": sidecar,
			"twin.ts":        source,
			"consumer.ts":    "import type { Text as Actual } from \"./main.vibe\";\nimport type { Text as Expected } from \"./twin\";\ndeclare const actual: Actual<\"X\">;\ndeclare const expected: Expected<\"X\">;\nconst a: Actual<\"X\"> = expected;\nconst b: Expected<\"X\"> = actual;\n// @ts-expect-error The literal must not widen to string or any.\nconst wrong: Actual<\"X\"> = \"different\";\n",
			"tsconfig.json":  `{"compilerOptions":{"strict":true,"noEmit":true,"types":[],"allowArbitraryExtensions":true,"module":"esnext","moduleResolution":"bundler","target":"es2022"},"files":["consumer.ts"]}`,
		}
		for name, text := range files {
			if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0600); err != nil {
				t.Fatal(err)
			}
		}
		cmd := exec.CommandContext(t.Context(), stock, "-p", dir, "--pretty", "false")
		if out, err := cmd.CombinedOutput(); err != nil {
			Gap(t, "FuzzSidecarLiteralDirectives", fmt.Sprintf("%s/%d/%t", key, form, mirrored), "sidecar changed the .ts twin's public type: %v\n%s\n%s", err, out, sidecar)
		}
	})
}
