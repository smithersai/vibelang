package vibelangwasm

import (
	"context"
	"path"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/vfstest"
)

const playgroundDir = "/playground"

func normalizeFilename(raw string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	base := path.Base(cleaned)
	if base == "" || base == "." || base == "/" {
		return "playground.vibe"
	}
	ext := path.Ext(base)
	switch ext {
	case ".vibe", ".vibex", ".ts", ".tsx":
		return base
	default:
		return base + ".vibe"
	}
}

func moduleKeyFor(filename string) string {
	stem := strings.TrimSuffix(filename, path.Ext(filename))
	if stem == "" {
		stem = "playground"
	}
	return "playground/" + stem
}

func buildVirtualFiles(filename string, source string) map[string]any {
	files := map[string]any{
		playgroundDir + "/package.json":  `{"name":"playground","type":"module"}`,
		playgroundDir + "/tsconfig.json": buildTSConfig(filename),
		playgroundDir + "/" + filename:   source,
	}
	addEffectStubs(files)
	addRuntimeStubs(files)
	return files
}

func buildTSConfig(filename string) string {
	jsx := `"preserve"`
	if !strings.HasSuffix(filename, ".vibex") && !strings.HasSuffix(filename, ".tsx") {
		jsx = `"react-jsx"`
	}
	return `{"compilerOptions":{"strict":true,"target":"ES2022","module":"NodeNext","moduleResolution":"NodeNext","lib":["ES2022","DOM"],"declaration":true,"jsx":` + jsx + `,"skipLibCheck":true,"types":[]},"files":[` + quoteJSONString(filename) + `]}`
}

func quoteJSONString(s string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + replacer.Replace(s) + `"`
}

func compileProgram(filename string, source string) (string, string, []Diagnostic) {
	entries := buildVirtualFiles(filename, source)
	var memFS vfs.FS = bundled.WrapFS(vfstest.FromMap(entries, tspath.CaseSensitive))
	configPath := tspath.RootedFilePathFromAbsolute(playgroundDir + "/tsconfig.json")
	parsed, configErrors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, memFS, nil)
	if len(configErrors) > 0 || parsed == nil {
		return "", "", collectASTDiagnostics(configErrors, source)
	}
	host := compiler.NewCachedFSCompilerHost(memFS, bundled.LibPath(), nil, nil, nil)
	program := compiler.NewProgram(compiler.ProgramOptions{
		ProgramConfig: compiler.ProgramConfig{
			Config:         parsed,
			SingleThreaded: core.TSTrue,
		},
		ProgramHosts: compiler.ProgramHosts{Host: host},
	})
	return emitAndCollect(program, filename, source)
}

func emitAndCollect(program *compiler.Program, filename string, source string) (string, string, []Diagnostic) {
	ctx := context.Background()
	entryPath := tspath.RootedFilePathFromAbsolute(playgroundDir + "/" + filename)
	sourceFile := program.GetSourceFile(entryPath)

	diags := collectProgramDiagnostics(program, sourceFile, source)
	var jsOut, dtsOut string
	stem := strings.TrimSuffix(filename, path.Ext(filename))
	emitResult := program.Emit(ctx, compiler.EmitOptions{
		WriteFile: func(fileName tspath.RootedFilePath, text string, _ *compiler.WriteFileData) error {
			name := fileName.AsString()
			switch {
			case strings.HasSuffix(name, "/"+stem+".js") || strings.HasSuffix(name, "/"+stem+".jsx"):
				jsOut = text
			case strings.HasSuffix(name, "/"+stem+".d.vibe.ts") || strings.HasSuffix(name, "/"+stem+".d.ts"):
				if dtsOut == "" || strings.HasSuffix(name, ".d.vibe.ts") {
					dtsOut = text
				}
			}
			return nil
		},
	})
	if emitResult != nil && len(emitResult.Diagnostics) > 0 {
		diags = append(diags, collectASTDiagnostics(emitResult.Diagnostics, source)...)
	}
	return jsOut, dtsOut, diags
}
