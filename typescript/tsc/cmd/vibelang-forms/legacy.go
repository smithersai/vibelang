package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

// auditLegacy deliberately requires a diagnostic-free project: migration
// warnings must fail CI too, and type errors cannot establish a clean audit.
// Use the compiler's checker rather than a spelling-based approximation of
// service bindings, effect contexts or retired forms.
func auditLegacy(binary, project string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	cmd := exec.CommandContext(ctx, binary, "--project", project, "--noEmit", "--pretty", "false")
	output, err := cmd.CombinedOutput()
	if ctx.Err() != nil {
		return fmt.Errorf("legacy audit: compiler deadline exceeded")
	}
	if err != nil || strings.TrimSpace(string(output)) != "" {
		return fmt.Errorf("legacy audit requires zero diagnostics (warnings included): %v\n%s", err, output)
	}
	config, err := filepath.Abs(project)
	if err != nil {
		return err
	}
	if info, err := os.Stat(config); err == nil && info.IsDir() {
		config = filepath.Join(config, "tsconfig.json")
	}
	fs := bundled.WrapFS(osvfs.FS())
	parsed, diags := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(config)), &core.CompilerOptions{}, nil, fs, nil)
	if len(diags) != 0 {
		return fmt.Errorf("legacy audit config: %s", diags[0].String())
	}
	if parsed == nil {
		return fmt.Errorf("legacy audit: no project config")
	}
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(fs, bundled.LibPath(), nil, nil, nil)})
	program.BindSourceFiles()
	checker, done := program.GetTypeChecker(ctx)
	defer done()
	var sites []string
	for _, file := range program.SourceFiles() {
		name := file.FileName().AsString()
		if file.IsDeclarationFile || !(strings.HasSuffix(name, ".vibe") || strings.HasSuffix(name, ".vibex")) {
			continue
		}
		for _, node := range vibelang.LegacySyntaxSites(checker, file) {
			pos := scanner.SkipTrivia(file.Text(), node.Pos())
			line := strings.Count(file.Text()[:pos], "\n") + 1
			sites = append(sites, fmt.Sprintf("%s:%d: retired service shorthand or effect try statement", name, line))
		}
	}
	if len(sites) != 0 {
		return fmt.Errorf("legacy audit requires zero diagnostics and zero legacy sites: %d legacy sites\n%s", len(sites), strings.Join(sites, "\n"))
	}
	fmt.Println("0 legacy sites")
	return nil
}
