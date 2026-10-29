package lint

import (
	"context"
	"fmt"
	"io/fs"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/diagnosticwriter"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/etscore"
	"github.com/microsoft/TypeScript/tsc/internal/effecttsgo/internal/rules"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

const usage = `Usage: vibelang lint [-c <oxlint config>] [-p <project>] [--deny-warnings] [<path>...]

Runs Effect's type-aware lint rules (effect-tsgo's effecttsgo/* rules) on the
.vibe files under each path (default: the current directory). The Oxlint
configuration selects the rules, their severities, overrides and
ignorePatterns, as it does for Oxlint on .ts files; the default is
.oxlintrc.json, then oxlint.config.ts, in the current directory. Each file is
checked in the nearest project that includes it. Each directory prefers
vibe.config.json, then tsconfig.json, then jsconfig.json; -p selects a file
or directory.
The status is 1 when an error is reported, a warning with --deny-warnings,
or a .vibe file no project includes, since it would go unchecked. Invalid
project settings return status 2.
`

// Command runs `vibelang lint`.
func Command(ctx context.Context, sys tsc.System, args []string) int {
	out, errOut := sys.Writer(), sys.ErrorWriter()
	var configPath, project string
	var denyWarnings bool
	var paths []string
	for i := 0; i < len(args); i++ {
		switch arg := args[i]; arg {
		case "-c", "--config", "-p", "--project":
			if i+1 == len(args) {
				fmt.Fprintf(errOut, "vibelang lint: %s needs a value\n\n%s", arg, usage)
				return 2
			}
			i++
			if arg == "-c" || arg == "--config" {
				configPath = args[i]
			} else {
				project = args[i]
			}
		case "--deny-warnings":
			denyWarnings = true
		case "-h", "--help":
			fmt.Fprint(out, usage)
			return 0
		default:
			if strings.HasPrefix(arg, "-") {
				fmt.Fprintf(errOut, "vibelang lint: unknown option %s\n\n%s", arg, usage)
				return 2
			}
			paths = append(paths, arg)
		}
	}
	cwd := sys.GetCurrentDirectory().AsString()
	if configPath == "" {
		for _, name := range []string{".oxlintrc.json", "oxlint.config.ts"} {
			if _, err := os.Stat(filepath.Join(cwd, name)); err == nil {
				configPath = name
				break
			}
		}
		if configPath == "" {
			fmt.Fprintf(errOut, "vibelang lint: no .oxlintrc.json or oxlint.config.ts here; name one with -c.\n")
			return 2
		}
	}
	if !filepath.IsAbs(configPath) {
		configPath = filepath.Join(cwd, configPath)
	}
	config, err := LoadConfig(configPath)
	if err != nil {
		fmt.Fprintf(errOut, "vibelang lint: %v\n", err)
		return 2
	}
	if len(paths) == 0 {
		paths = []string{"."}
	}
	files, err := vibeFiles(cwd, paths, config)
	if err != nil {
		fmt.Fprintf(errOut, "vibelang lint: %v\n", err)
		return 2
	}

	var unchecked int
	byProject := map[string][]string{}
	var projects []string
	for _, file := range files {
		p := project
		if p == "" {
			p = nearestProject(file)
		} else if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		if info, err := os.Stat(p); err == nil && info.IsDir() {
			p = projectInDirectory(p)
		}
		if p == "" {
			fmt.Fprintf(errOut, "vibelang lint: %s: no project config above it includes it; not linted.\n", relative(cwd, file))
			unchecked++
			continue
		}
		if _, seen := byProject[p]; !seen {
			projects = append(projects, p)
		}
		byProject[p] = append(byProject[p], file)
	}

	format := &diagnosticwriter.FormattingOptions{
		CaseSensitivity:  sys.FS().CaseSensitivity(),
		CurrentDirectory: sys.GetCurrentDirectory(),
		NewLine:          "\n",
	}
	var errorCount, warningCount, linted int
	for _, p := range projects {
		diags, skipped, err := lintProject(ctx, sys, p, byProject[p], config)
		if err != nil {
			fmt.Fprintf(errOut, "vibelang lint: %s: %v\n", relative(cwd, p), err)
			return 2
		}
		linted += len(byProject[p]) - len(skipped)
		for _, file := range skipped {
			// A file no project checks is not linted: say so, rather than pass it.
			fmt.Fprintf(errOut, "vibelang lint: %s: %s does not include it; not linted.\n", relative(cwd, file), relative(cwd, p))
			unchecked++
		}
		for _, d := range diags {
			diagnosticwriter.WriteFormatDiagnostic(out, diagnosticwriter.WrapASTDiagnostic(d), format)
			if d.Category() == diagnostics.CategoryError {
				errorCount++
			} else {
				warningCount++
			}
		}
	}
	fmt.Fprintf(out, "vibelang lint: %d error(s) and %d warning(s) in %d .vibe file(s).\n", errorCount, warningCount, linted)
	if errorCount > 0 || unchecked > 0 || denyWarnings && warningCount > 0 {
		return 1
	}
	return 0
}

// lintProject reports the configured rules on files, which belong to the project configFile.
func lintProject(ctx context.Context, sys tsc.System, configFile string, files []string, config *Config) (result []*ast.Diagnostic, skipped []string, err error) {
	name := tspath.RootedFilePath(tspath.NormalizePath(configFile))
	path := sys.FS().CaseSensitivity().PathKey(tspath.RootedPath(name))
	parsed, errs := tsoptions.GetParsedCommandLineOfConfigFilePath(name, path, nil, nil, sys.FS(), &tsc.ExtendedConfigCache{})
	if parsed == nil {
		if len(errs) > 0 {
			return nil, nil, fmt.Errorf("%s", errs[0].MessageText())
		}
		return nil, nil, fmt.Errorf("cannot read it")
	}
	for _, d := range append(errs, parsed.Errors...) {
		if d.Category() == diagnostics.CategoryError {
			return nil, nil, fmt.Errorf("TS%d: %s", d.Code(), d.MessageText())
		}
	}
	enableVibePorts(parsed.CompilerOptions(), config)
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: compiler.NewCompilerHost(sys.FS(), sys.DefaultLibraryPath(), nil, nil, nil)})
	base := program.Options().Effect
	if base == nil {
		base = etscore.ParseFromPlugins([]any{map[string]any{"name": etscore.EffectPluginName}})
	}
	for _, file := range files {
		sf := program.GetSourceFile(tspath.RootedFilePath(tspath.NormalizePath(file)))
		if sf == nil {
			skipped = append(skipped, file)
			continue
		}
		options := *base
		options.Diagnostics = true
		options.Overrides = nil
		options.DiagnosticSeverity = severityFor(config, file)
		// Checking the file reports the VibeLang ports (vibeAnswers) and records what some rules read.
		diags := vibePortDiagnostics(program.GetSemanticDiagnostics(ctx, sf), options.DiagnosticSeverity)
		c, done := program.GetTypeCheckerForFile(ctx, sf)
		diags = append(diags, run(ctx, program, c, sf, &options)...)
		done()
		slices.SortFunc(diags, func(a, b *ast.Diagnostic) int { return a.Pos() - b.Pos() })
		result = append(result, diags...)
	}
	return result, skipped, nil
}

// severityFor turns every rule the configuration leaves out off, as Oxlint does.
func severityFor(config *Config, file string) map[string]etscore.Severity {
	severity := config.SeverityFor(file)
	for _, r := range rules.All {
		if _, ok := severity[r.Name]; !ok {
			severity[r.Name] = etscore.SeverityOff
		}
	}
	severity["unusedDirective"] = etscore.SeverityOff
	return severity
}

func vibeFiles(cwd string, paths []string, config *Config) ([]string, error) {
	var files []string
	for _, p := range paths {
		if !filepath.IsAbs(p) {
			p = filepath.Join(cwd, p)
		}
		err := filepath.WalkDir(p, func(file string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				if name := entry.Name(); file != p && (name == "node_modules" || strings.HasPrefix(name, ".")) || config.Ignored(file+"/") {
					return filepath.SkipDir
				}
				return nil
			}
			if strings.HasSuffix(file, ".vibe") && !config.Ignored(file) {
				files = append(files, file)
			}
			return nil
		})
		if err != nil {
			return nil, err
		}
	}
	slices.Sort(files)
	return slices.Compact(files), nil
}

// nearestProject uses the same per-directory config precedence as the compiler.
func nearestProject(file string) string {
	for dir := filepath.Dir(file); ; dir = filepath.Dir(dir) {
		candidate := projectInDirectory(dir)
		if _, err := os.Stat(candidate); err == nil && includes(candidate, file) {
			return candidate
		}
		if parent := filepath.Dir(dir); parent == dir {
			return ""
		}
	}
}

func projectInDirectory(dir string) string {
	return tsoptions.ConfigFileInDirectory(tspath.RootedDirectoryPathFromAbsolute(dir), func(name tspath.RootedFilePath) bool {
		info, err := os.Stat(name.AsString())
		return err == nil && !info.IsDir()
	}).AsString()
}

func includes(configFile string, file string) bool {
	text, err := os.ReadFile(configFile)
	if err != nil {
		return false
	}
	// A solution file (files: [] with references) checks nothing itself.
	s := string(stripJSONC(text))
	return !strings.Contains(strings.ReplaceAll(s, " ", ""), `"files":[]`)
}

func relative(cwd, file string) string {
	if rel, err := filepath.Rel(cwd, file); err == nil {
		return rel
	}
	return file
}

// enableVibePorts turns on, as warnings, the VibeLang diagnostics that port a
// rule the configuration enables for any file (vibeAnswers), so that the check
// reports them; vibePortDiagnostics then sets each file's severity.
func enableVibePorts(options *core.CompilerOptions, config *Config) {
	enabled := map[string]bool{}
	mark := func(rules map[string]etscore.Severity) {
		for name, severity := range rules {
			if answer := vibeAnswers[name]; answer.ek != "" && severity != etscore.SeverityOff {
				enabled[answer.ek] = true
			}
		}
	}
	mark(config.Rules)
	for _, o := range config.Overrides {
		mark(o.Rules)
	}
	vibelang := core.VibeLangOptions{}
	if options.VibeLang != nil {
		vibelang = *options.VibeLang
	}
	codes := maps.Clone(vibelang.Diagnostics)
	if codes == nil {
		codes = map[string]string{}
	}
	for code := range enabled {
		if slices.Contains(core.VibeLangAdjustableCodes, code) {
			codes[code] = "warning"
		}
	}
	vibelang.Diagnostics = codes
	options.VibeLang = &vibelang
}

// vibePortDiagnostics keeps the VibeLang diagnostics that port a rule severity
// enables, at the strongest severity among the rules each one ports.
func vibePortDiagnostics(checked []*ast.Diagnostic, severity map[string]etscore.Severity) []*ast.Diagnostic {
	var result []*ast.Diagnostic
	for _, d := range checked {
		if d.Source() != "EK" {
			continue
		}
		code := fmt.Sprintf("EK%d", d.Code())
		strongest := etscore.SeverityOff
		for name, answer := range vibeAnswers {
			if answer.ek == code {
				switch severity[name] {
				case etscore.SeverityError:
					strongest = etscore.SeverityError
				case etscore.SeverityWarning:
					if strongest == etscore.SeverityOff {
						strongest = etscore.SeverityWarning
					}
				}
			}
		}
		switch strongest {
		case etscore.SeverityError:
			d.SetCategory(diagnostics.CategoryError)
		case etscore.SeverityWarning:
			d.SetCategory(diagnostics.CategoryWarning)
		default:
			continue
		}
		result = append(result, d)
	}
	return result
}
