package vibelangfuzz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
)

// stockTypeScript locates the version pinned for the mapper's stock consumer
// checks (Chapter 27 rule 4, D366). Absence is optional; malformed metadata is
// an error. Both the parity target and the declaration consumer use this path.
var stockTypeScript = sync.OnceValues(func() (string, error) {
	version := os.Getenv("TS7_VERSION")
	if version == "" {
		data, err := os.ReadFile(filepath.Join(Root(), "packages/ts-mapper/package.json"))
		if err != nil {
			return "", err
		}
		var manifest struct {
			DevDependencies map[string]string `json:"devDependencies"`
		}
		if err := json.Unmarshal(data, &manifest); err != nil {
			return "", err
		}
		version = manifest.DevDependencies["typescript"]
		if version == "" {
			return "", fmt.Errorf("packages/ts-mapper/package.json pins no typescript")
		}
	}
	tsc := filepath.Join(Root(), "packages/ts-mapper/test/.cache", "typescript-"+version, "node_modules/.bin/tsc")
	if _, err := os.Stat(tsc); err != nil {
		return "", fmt.Errorf("stock TypeScript %s is not installed at %s; see CONTRIBUTING.md for the existing optional stock-compiler setup: %w", version, tsc, err)
	}
	return tsc, nil
})

var stockCode = regexp.MustCompile(`\b(?:error|warning) TS(\d+):`)

// inputs are the declaration files the project supplies itself, which the
// mirror copies beside the emitted ones.
func (oc *OutputChecker) checkStockConsumer(dir string, inputs []string) {
	tsc, err := stockTypeScript()
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) || os.Getenv("VIBELANG_FUZZ_REQUIRE") == "1" {
			// A gate that requires its dependencies does not pass by
			// checking half of D366.
			oc.G.Add("feature:declaration-consumer", "cannot locate stock TypeScript: %v", err)
		} else if oc.Logf != nil {
			oc.Logf("declaration consumer: stock TypeScript half unavailable: %v", err)
		}
		return
	}
	config, err := stockConsumerConfig(dir)
	if err != nil {
		oc.G.Add("feature:declaration-consumer", "cannot write the stock consumer's configuration: %v", err)
		return
	}
	ctx, cancel := context.WithTimeout(oc.Ctx, 2*HangLimit)
	defer cancel()
	cmd := exec.CommandContext(ctx, tsc, "-p", config, "--pretty", "false")
	cmd.Dir = dir
	out, runErr := cmd.CombinedOutput()
	if runErr == nil {
		return
	}
	// An error inside an installed package, such as effect's own use of a
	// lib the consumer leaves out, is not the emitted declarations' (D366
	// concerns the files the compiler writes and the calls through them).
	reported := false
	for _, line := range strings.Split(string(out), "\n") {
		match := stockCode.FindStringSubmatch(line)
		if match == nil {
			continue
		}
		reported = true
		if strings.Contains(line, "/node_modules/") {
			continue
		}
		// So is an error inside a declaration file the project supplies, such
		// as a case's stub of a package the harness does not install: the
		// compiler did not write it.
		if slices.ContainsFunc(inputs, func(input string) bool { return strings.HasPrefix(line, input+"(") }) {
			continue
		}
		oc.G.Add("feature:declaration-consumer-TS"+match[1], "Chapter 27 rules 1 and 4 (D366): stock TypeScript rejected the emitted declarations and calls: %s\n%.1000s", line, out)
	}
	if !reported {
		oc.G.Add("feature:declaration-consumer", "Chapter 27 rules 1 and 4 (D366): stock TypeScript consumer failed: %v: %.1000s", runErr, out)
	}
}

// stockConsumerConfig writes the configuration of a TypeScript consumer of
// the emitted declarations beside the mirror's and returns its name. A
// consumer of a published package has its own configuration, not the
// producer's, which may hold VibeLang's own settings (D275) that stock
// TypeScript rejects; it keeps the producer's native module/resolution policy, target, lib and types, which
// the declarations may rely on, and its paths, through which a case's stub
// stands in for a package the harness does not install. The mirror holds a
// copy of each stub at the same relative name, so each path still resolves.
func stockConsumerConfig(dir string) (string, error) {
	var mirror struct {
		Files []string `json:"files"`
	}
	data, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(data, &mirror); err != nil {
		return "", err
	}
	options := map[string]any{
		"noEmit": true, "strict": true, "skipLibCheck": false, "rootDir": ".",
		"target": "ES2022", "module": "NodeNext", "moduleResolution": "NodeNext",
	}
	var project struct {
		CompilerOptions map[string]any `json:"compilerOptions"`
	}
	if data, err := os.ReadFile(filepath.Join(dir, "..", "tsconfig.json")); err == nil && json.Unmarshal(data, &project) == nil {
		for _, name := range []string{"target", "lib", "types", "paths", "module", "moduleResolution", "allowImportingTsExtensions"} {
			if value, ok := project.CompilerOptions[name]; ok {
				options[name] = value
			}
		}
	}
	config, err := json.MarshalIndent(map[string]any{"compilerOptions": options, "files": mirror.Files}, "", "  ")
	if err != nil {
		return "", err
	}
	const name = "tsconfig.stock.json"
	return name, os.WriteFile(filepath.Join(dir, name), config, 0o600)
}

// stockSpan is a diagnostic's UTF-16 span, including its exclusive end.
// D266 preserves TypeScript's entire diagnostic location, not just its start.
type stockSpan struct {
	File     string `json:"file"`
	Start    int    `json:"start"`
	End      int    `json:"end"`
	Code     int32  `json:"code"`
	Category string `json:"category"`
}

func (s stockSpan) String() string {
	return fmt.Sprintf("%s[%d,%d): %s TS%d", s.File, s.Start, s.End, s.Category, s.Code)
}

// stockSpans uses the installed compiler's API because its plain CLI omits
// diagnostic end positions. It performs no package installation. The full
// pre-emit diagnostics match CompileOrdered's requests, rather than the CLI's
// early stop after syntax errors. Native TypeScript 7 uses LSP when it ships
// no JS API; the boolean then restricts end comparisons to source files.
func stockSpans(ctx context.Context, tsc, dir string, files ...string) ([]stockSpan, bool, error) {
	api := filepath.Join(filepath.Dir(filepath.Dir(tsc)), "typescript/lib/typescript.js")
	if _, err := os.Stat(api); errors.Is(err, os.ErrNotExist) {
		spans, err := stockLSPSpans(ctx, tsc, dir, files)
		return spans, true, err
	}
	const script = `const ts = require(process.argv[1]);
const path = require("node:path");
const dir = process.cwd();
const configErrors = [];
const parsed = ts.getParsedCommandLineOfConfigFile(path.join(dir, "tsconfig.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: d => configErrors.push(d) });
const program = parsed && ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options, projectReferences: parsed.projectReferences, configFileParsingDiagnostics: parsed.errors });
const ds = [...configErrors, ...(parsed?.errors ?? []), ...(program ? ts.getPreEmitDiagnostics(program) : [])];
console.log(JSON.stringify(ds.map(d => ({ file: d.file ? path.relative(dir, d.file.fileName).split(path.sep).join("/") : "", start: d.start ?? 0, end: (d.start ?? 0) + (d.length ?? 0), code: d.code, category: ts.DiagnosticCategory[d.category].toLowerCase() }))));`
	cmd := exec.CommandContext(ctx, "node", "-e", script, api)
	cmd.Dir = dir
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, false, fmt.Errorf("stock diagnostic span API: %w: %.600s", err, out)
	}
	var spans []stockSpan
	if err := json.Unmarshal(out, &spans); err != nil {
		return nil, false, err
	}
	return spans, false, nil
}

func spanStrings(spans []stockSpan) []string {
	seen := map[string]bool{}
	for _, span := range spans {
		seen[span.String()] = true
	}
	return mapKeys(seen)
}
