package vibelangfuzz

import (
	"context"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
	"strings"
	"testing"
)

func TestSidecarLiteralCommentsQuoted(t *testing.T) {
	const quote = "Declarations are exactly what idiomatic Effect TypeScript would declare."
	if !strings.Contains(SpecText("001-functions.md"), quote) {
		t.Fatalf("chapter 001 no longer says %q", quote)
	}
}

// VIP-27: a directive-looking line in a literal type is data.
func FuzzSidecarLiteralComments(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"reference", "source-map", "after-span", "no-span"} {
		f.Add(key, uint8(0))
		f.Add(key, uint8(1))
	}
	f.Fuzz(func(t *testing.T, key string, variant uint8) {
		TestSidecarLiteralCommentsQuoted(t)
		line := "/// <reference path=\"./payload.d.ts\" />"
		if key == "source-map" {
			line = "//# sourceMappingURL=payload"
		}
		nl := "\n"
		if variant%2 != 0 {
			nl = "\r\n"
		}
		head, tail := "head"+nl, nl+"\x24{string}end"
		if key == "after-span" {
			head += "\x24{string}" + nl
			tail = nl + "end"
		}
		if key == "no-span" {
			tail = nl + "end"
		}
		literal := "`" + head + line + tail + "`"
		source := "export type Value = " + literal + ";\n"
		fs := vfstest.FromMap(map[string]string{
			"/project/main.vibe":     source,
			"/project/native.ts":     source,
			"/project/native.json":   `{"compilerOptions":{"noLib":true,"module":"esnext","moduleResolution":"bundler","outDir":"native-out","declaration":true},"files":["native.ts"]}`,
			"/project/tsconfig.json": `{"compilerOptions":{"noLib":true,"module":"esnext","moduleResolution":"bundler","outDir":"out","declaration":true},"files":["main.vibe"]}`,
		}, tspath.CaseSensitive)
		config, errors := tsoptions.GetParsedCommandLineOfConfigFile("/project/tsconfig.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(errors) != 0 || config == nil || len(config.Errors) != 0 {
			t.Fatalf("fixture config: %v %v", config, errors)
		}
		p := compiler.NewProgram(compiler.ProgramOptions{Config: config, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
		got := ""
		p.EmitDeclarationSidecars(context.Background(), func(name, text string) error {
			if name == "/project/main.d.vibe.ts" {
				got = text
			}
			return nil
		})
		nativeConfig, nativeErrors := tsoptions.GetParsedCommandLineOfConfigFile("/project/native.json", &core.CompilerOptions{}, nil, fs, nil)
		if len(nativeErrors) != 0 || nativeConfig == nil || len(nativeConfig.Errors) != 0 {
			t.Fatalf("native twin config: %v %v", nativeConfig, nativeErrors)
		}
		native := compiler.NewProgram(compiler.ProgramOptions{Config: nativeConfig, Host: compiler.NewCompilerHost(fs, "/", nil, nil, nil)})
		want := ""
		native.Emit(context.Background(), compiler.EmitOptions{EmitOnly: compiler.EmitOnlyDts, ForceEmit: true, WriteFile: func(name tspath.RootedFilePath, text string, data *compiler.WriteFileData) error {
			if strings.HasSuffix(name.AsString(), ".d.ts") {
				want = text
			}
			return nil
		}})
		if want == "" || got != want {
			Gap(t, "FuzzSidecarLiteralComments", key, "VIP-27 native TypeScript declaration differs: native=%q sidecar=%q", want, got)
		}
	})
}
