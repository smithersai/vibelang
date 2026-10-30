package main

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// The npm launcher supplies its own module path, including when the binary
// lives in a separate optional platform package. Checkout builds find it
// beside native/vibelang or above typescript/built/local.
func formatModule() string {
	if path := os.Getenv("VIBELANG_FORMAT_MODULE"); path != "" {
		return path
	}
	executable, _ := os.Executable()
	if resolved, err := filepath.EvalSymlinks(executable); err == nil {
		executable = resolved
	}
	for directory := filepath.Dir(executable); ; directory = filepath.Dir(directory) {
		for _, path := range []string{
			filepath.Join(directory, "format.mjs"),
			filepath.Join(directory, "packages", "compiler", "format.mjs"),
		} {
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				return path
			}
		}
		if filepath.Dir(directory) == directory {
			break
		}
	}
	return ""
}

func formatVibeSource(ctx context.Context, path, text string) (string, error) {
	module := formatModule()
	if module == "" {
		return "", fmt.Errorf("VibeLang formatter module not found; launch the language server through the vibelang npm package")
	}
	node := os.Getenv("VIBELANG_FORMAT_NODE")
	if node == "" {
		node = "node"
	}
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	const script = "import { readFileSync } from 'node:fs';\n" +
		"import { pathToFileURL } from 'node:url';\n" +
		"const { formatSource } = await import(pathToFileURL(process.argv[1]).href);\n" +
		"process.stdout.write(formatSource(readFileSync(0, 'utf8'), process.argv[2]));"
	command := exec.CommandContext(ctx, node, "--input-type=module", "-e", script, module, path)
	command.WaitDelay = 2 * time.Second
	command.Dir = filepath.Dir(path)
	command.Stdin = strings.NewReader(text)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	output, err := command.Output()
	if err != nil {
		return "", fmt.Errorf("VibeLang formatting failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return string(output), nil
}
