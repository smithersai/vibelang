package vibelang

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/compiler"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/scanner"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// vibelang prove (VIP-43, Appendix F "The proof command"): check the
// program, lower each module with a root for LemmaScript, run LemmaScript's
// lsc with Dafny on it, and report each root.

// The pinned releases (Appendix F "Steps").
const (
	pinnedLemmaScript = "0.6.6"
	pinnedDafny       = "4.11.0"
)

var (
	// EK4315: an obligation Dafny could not prove. {0} is the declaration, {1} Dafny's message.
	EK4315 = message(4315, errorCategory, "{0} is not proved: {1}")
	// EK4316: the proof environment is unusable. {0} says what is wrong.
	EK4316 = message(4316, errorCategory, "vibelang prove can't run: {0}. Install lemmascript@0.6.6 as a development dependency and Dafny 4.11.0; exclude the proof directory in the config, or choose another vibe.proofDir.")
	// EK4317: LemmaScript or Dafny rejected the lowering. {0} is their message.
	EK4317 = message(4317, errorCategory, "LemmaScript rejected the lowering of this module: {0}. Keep reached code inside LemmaScript's subset.")
	// EK4318: the hand-written P.dfy conflicts with the new generation. {0} is the file.
	EK4318 = message(4318, errorCategory, "{0} changes a generated line or conflicts with the new generation. Restore the generated lines, or resolve the merge from {0}.merged.")
	// EK4319: with --strict, a call to a function from another file. {0} is its name.
	EK4319 = message(4319, errorCategory, "{0} comes from a TypeScript or JavaScript file, so proofs trust it, and --strict refuses implicit trust. Prove it in a .vibe module, or write a declare function and accept the trust explicitly.")
)

func init() {
	for _, m := range []*Message{EK4315, EK4316, EK4317, EK4318, EK4319} {
		registry[m.Code] = m
	}
}

const proveUsage = "Usage: vibelang prove [-p <project>] [--strict]"

// ProveCommand runs vibelang prove with args and returns its exit status:
// 0 when every root is proved and no error was reported, or the project has
// no root, and 1 otherwise.
func ProveCommand(ctx context.Context, sys tsc.System, args []string) int {
	project := ""
	strict := false
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "-p", "--project":
			if i+1 == len(args) {
				fmt.Fprintln(sys.ErrorWriter(), "vibelang prove: "+args[i]+" needs a project path.\n"+proveUsage)
				return 1
			}
			i++
			project = args[i]
		case "--strict":
			strict = true
		default:
			fmt.Fprintln(sys.ErrorWriter(), "vibelang prove: unknown argument "+args[i]+". The command takes no file arguments.\n"+proveUsage)
			return 1
		}
	}
	configFile, ok := proveConfigFile(sys, project)
	if !ok {
		return 1
	}
	parsed, configErrors := tsoptions.GetParsedCommandLineOfConfigFile(configFile, &core.CompilerOptions{}, nil, sys.FS(), nil)
	report := tsc.CreateDiagnosticReporter(sys, sys.Writer(), parsed.Locale(), parsed.CompilerOptions())
	failed := false
	for _, d := range configErrors {
		report(d)
		failed = failed || d.Category() == diagnostics.CategoryError
	}
	if failed {
		return 1
	}
	host := compiler.NewCompilerHost(sys.FS(), sys.DefaultLibraryPath(), nil, nil, nil)
	program := compiler.NewProgram(compiler.ProgramOptions{Config: parsed, Host: host})
	// Step 1: check the program as the compiler does.
	for _, d := range compiler.GetDiagnosticsOfAnyProgram(ctx, program, nil, false, program.GetBindDiagnostics, program.GetSemanticDiagnostics) {
		report(d)
		failed = failed || d.Category() == diagnostics.CategoryError
	}
	c, done := program.GetTypeChecker(ctx)
	defer done()
	configDirectory := tspath.GetDirectoryPath(configFile.AsString())
	modules := LowerProofs(program, c, configDirectory)
	if strict {
		for _, module := range modules {
			for _, trusted := range module.Trusted {
				if trusted.Imported {
					report(proveDiagnostic(trusted.File, trusted.Node.Name(), EK4319, trusted.Name))
					failed = true
				}
			}
		}
	}
	if failed {
		return 1
	}
	// Step 2.
	if len(modules) == 0 {
		fmt.Fprintln(sys.Writer(), "Nothing to prove.")
		return 0
	}
	// Step 3: the pinned toolchain.
	lsc, lemmaScriptVersion, problem := resolveLemmaScript(configDirectory)
	if problem == "" {
		lemmaScriptVersion, problem = checkLemmaScriptVersion(lemmaScriptVersion)
	}
	dafnyVersion := ""
	if problem == "" {
		dafnyVersion, problem = dafnyRelease()
	}
	if problem != "" {
		report(proveDiagnostic(nil, nil, EK4316, problem))
		return 1
	}
	// Step 4: the proof directory. A module outside the config's directory
	// would write its lowering outside the proof directory.
	for _, module := range modules {
		if module.Source == ".." || strings.HasPrefix(module.Source, "../") {
			report(proveDiagnostic(module.Roots[0].File, module.Roots[0].Node.Name(), EK4316, "the module "+module.Source+", which declares "+module.Roots[0].Name+", is outside the selected config's directory "+configDirectory))
			return 1
		}
	}
	proofDirectory := filepath.Join(configDirectory, "proofs")
	if problem := checkProofDirectory(program, proofDirectory); problem != "" {
		report(proveDiagnostic(nil, nil, EK4316, problem))
		return 1
	}
	if err := writeProofDirectory(proofDirectory, parsed.CompilerOptions(), modules); err != nil {
		report(proveDiagnostic(nil, nil, EK4316, "the proof directory can't be written: "+err.Error()))
		return 1
	}
	// Steps 5 and 7.
	proved := map[*ast.Node]bool{}
	for _, module := range modules {
		ok := runLemmaScript(ctx, lsc, proofDirectory, module, func(d *ast.Diagnostic) { report(d) })
		for _, root := range module.Roots {
			proved[root.Node] = ok
		}
	}
	return printProofSummary(sys, configDirectory, modules, proved, lemmaScriptVersion, dafnyVersion)
}

// proveConfigFile finds the selected config, as the compiler does.
func proveConfigFile(sys tsc.System, project string) (tspath.RootedFilePath, bool) {
	if project == "" {
		configFile := tsoptions.FindConfigFile(sys.GetCurrentDirectory(), sys.FS().FileExists)
		if configFile == "" {
			fmt.Fprintln(sys.ErrorWriter(), "vibelang prove: no tsconfig.json in "+sys.GetCurrentDirectory().AsString()+" or above.\n"+proveUsage)
			return "", false
		}
		return configFile, true
	}
	rooted := tspath.ToRootedPath(project, sys.GetCurrentDirectory())
	if directory := tspath.RootedDirectoryPathFromPath(rooted); sys.FS().DirectoryExists(directory) {
		configFile := tsoptions.ConfigFileInDirectory(directory, sys.FS().FileExists)
		if !sys.FS().FileExists(configFile) {
			fmt.Fprintln(sys.ErrorWriter(), "vibelang prove: no tsconfig.json in "+project+".")
			return "", false
		}
		return configFile, true
	}
	configFile := tspath.RootedFilePathFromPath(rooted)
	if !sys.FS().FileExists(configFile) {
		fmt.Fprintln(sys.ErrorWriter(), "vibelang prove: "+project+" does not exist.")
		return "", false
	}
	return configFile, true
}

// proveDiagnostic is an EK diagnostic of vibelang prove at node in file, or
// for the project when file is nil.
func proveDiagnostic(file *ast.SourceFile, node *ast.Node, m *Message, args ...any) *ast.Diagnostic {
	loc := core.NewTextRange(0, 0)
	if file != nil && node != nil {
		loc = core.NewTextRange(scanner.SkipTrivia(file.Text(), node.Pos()), node.End())
	}
	return ast.NewExternalDiagnostic(file, loc, diagnosticSource, errorCategory, m.Code, format(m.Text, args))
}

// resolveLemmaScript resolves lemmascript/package.json from directory with
// Node's module resolution, and returns the path of its lsc script and its
// version, or a problem.
func resolveLemmaScript(directory string) (string, string, string) {
	for dir := directory; ; {
		packageFile := filepath.Join(dir, "node_modules", "lemmascript", "package.json")
		if data, err := os.ReadFile(packageFile); err == nil {
			var manifest struct {
				Version string          `json:"version"`
				Bin     json.RawMessage `json:"bin"`
			}
			if err := json.Unmarshal(data, &manifest); err != nil {
				return "", "", packageFile + " is not valid JSON"
			}
			var bins map[string]string
			if json.Unmarshal(manifest.Bin, &bins) != nil || bins["lsc"] == "" {
				return "", "", packageFile + " names no lsc command"
			}
			return filepath.Join(filepath.Dir(packageFile), bins["lsc"]), manifest.Version, ""
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", "", "lemmascript is not installed in " + directory + " or a directory above it"
		}
		dir = parent
	}
}

func checkLemmaScriptVersion(version string) (string, string) {
	if version != pinnedLemmaScript {
		return version, "lemmascript is " + version + ", not the pinned " + pinnedLemmaScript
	}
	return version, ""
}

// dafnyRelease runs dafny --version and returns its release, such as 4.11.0,
// or a problem.
func dafnyRelease() (string, string) {
	output, err := exec.Command("dafny", "--version").Output()
	if err != nil {
		return "", "dafny --version failed: " + err.Error()
	}
	line, _, _ := strings.Cut(strings.TrimSpace(string(output)), "\n")
	release, _, _ := strings.Cut(strings.TrimSpace(line), "+")
	if release != pinnedDafny {
		return release, "dafny is " + release + ", not the pinned " + pinnedDafny
	}
	return release, ""
}

// generatedConfigLine is the first line of the proof directory's
// tsconfig.json, which marks the directory as vibelang prove's.
const generatedConfigLine = "// Generated by vibelang prove. Do not edit."

// checkProofDirectory returns a problem when the proof directory holds a
// program file, or is neither absent, empty nor marked as vibelang prove's.
func checkProofDirectory(program *compiler.Program, directory string) string {
	prefix := filepath.Clean(directory) + string(filepath.Separator)
	for _, file := range program.SourceFiles() {
		if strings.HasPrefix(filepath.Clean(file.FileName().AsString()), prefix) {
			return "the proof directory " + directory + " holds the program file " + file.FileName().AsString()
		}
	}
	entries, err := os.ReadDir(directory)
	if err != nil || len(entries) == 0 {
		return ""
	}
	data, err := os.ReadFile(filepath.Join(directory, "tsconfig.json"))
	if err != nil {
		return "the proof directory " + directory + " holds files vibelang prove did not write"
	}
	if first, _, _ := strings.Cut(string(data), "\n"); strings.TrimRight(first, "\r") != generatedConfigLine {
		return "the proof directory " + directory + " holds files vibelang prove did not write"
	}
	return ""
}

// writeProofDirectory writes lemmascript.json, tsconfig.json and each
// module's lowering file.
func writeProofDirectory(directory string, options *core.CompilerOptions, modules []ProofModule) error {
	files := map[string]string{
		"lemmascript.json": `{ "string-semantics": "javascript-utf16", "dafny-library": "local", "safe-slice": true, "extern-default": "impure" }` + "\n",
		"tsconfig.json":    generatedConfigLine + "\n" + proofTSConfig(options) + "\n",
	}
	for _, module := range modules {
		files[module.Source+".ts"] = module.Text
	}
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	for _, name := range names {
		path := filepath.Join(directory, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		if err := os.WriteFile(path, []byte(files[name]), 0o644); err != nil {
			return err
		}
	}
	return nil
}

// proofTSConfig is the proof directory's compiler configuration: the
// project's target, lib and noUncheckedIndexedAccess.
func proofTSConfig(options *core.CompilerOptions) string {
	target := strings.ToLower(options.GetEmitScriptTarget().String())
	var b strings.Builder
	b.WriteString(`{ "compilerOptions": { "strict": true, "target": ` + strconv.Quote(target))
	if len(options.Lib) > 0 {
		libs := make([]string, 0, len(options.Lib))
		for _, lib := range options.Lib {
			// The parsed option holds file names, lib.es2022.d.ts for es2022.
			libs = append(libs, strconv.Quote(strings.TrimSuffix(strings.TrimPrefix(lib, "lib."), ".d.ts")))
		}
		b.WriteString(`, "lib": [` + strings.Join(libs, ", ") + `]`)
	}
	b.WriteString(`, "module": "ESNext", "noUncheckedIndexedAccess": ` + strconv.FormatBool(options.NoUncheckedIndexedAccess.IsTrue()))
	b.WriteString(`, "skipLibCheck": true }, "include": ["**/*.ts"] }`)
	return b.String()
}

// lemmaScriptRun is a record of LemmaScript's .lemmascript/runs.jsonl.
type lemmaScriptRun struct {
	Cmd     string   `json:"cmd"`
	File    string   `json:"file"`
	Stage   string   `json:"stage"`
	Partial bool     `json:"partial"`
	Failed  []string `json:"failed"`
}

// dafnyError matches a Dafny error line: P.dfy(L,C): Error: M.
var dafnyError = regexp.MustCompile(`^(.*\.dfy)\((\d+),(\d+)\): Error: (.*)$`)

// runLemmaScript runs lsc regen on module's lowering file, reports what
// failed, and returns whether every root of module is proved.
func runLemmaScript(ctx context.Context, lsc string, proofDirectory string, module ProofModule, report func(*ast.Diagnostic)) bool {
	lowering := module.Source + ".ts"
	cmd := exec.CommandContext(ctx, "node", lsc, "regen", "--backend=dafny", lowering)
	cmd.Dir = proofDirectory
	cmd.Env = append(os.Environ(), "LSC_RUN_LOG=true")
	var output bytes.Buffer
	cmd.Stdout = &output
	cmd.Stderr = &output
	_ = cmd.Run() // the run log, not the exit status, holds the verdict
	file := module.Roots[0].File
	run, found := lastLemmaScriptRun(proofDirectory, lowering)
	switch {
	case !found:
		report(proveDiagnostic(file, nil, EK4317, firstLine(output.String())))
		return false
	case run.Stage == "ok" && !run.Partial:
		return true
	case run.Stage == "resolve":
		report(proveDiagnostic(file, nil, EK4317, firstDafnyError(output.String())))
	case run.Stage == "conflict" || run.Stage == "diff":
		report(proveDiagnostic(file, nil, EK4318, module.Source+".dfy"))
	default:
		reportDafnyErrors(proofDirectory, module, output.String(), report)
	}
	return false
}

// lastLemmaScriptRun returns the last regen record for lowering.
func lastLemmaScriptRun(proofDirectory string, lowering string) (lemmaScriptRun, bool) {
	data, err := os.ReadFile(filepath.Join(proofDirectory, ".lemmascript", "runs.jsonl"))
	if err != nil {
		return lemmaScriptRun{}, false
	}
	var last lemmaScriptRun
	found := false
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 0, 64*1024), 16*1024*1024)
	for scanner.Scan() {
		var run lemmaScriptRun
		if json.Unmarshal(scanner.Bytes(), &run) == nil && run.Cmd == "regen" && filepath.ToSlash(run.File) == lowering {
			last, found = run, true
		}
	}
	return last, found
}

func firstLine(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			return line
		}
	}
	return "lsc wrote no run record"
}

func firstDafnyError(text string) string {
	for _, line := range strings.Split(text, "\n") {
		if m := dafnyError.FindStringSubmatch(strings.TrimSpace(line)); m != nil {
			return m[4]
		}
	}
	return firstLine(text)
}

// reportDafnyErrors reports rule 4315 for each Dafny error in output, at the
// declaration whose Dafny member holds its line (Appendix F "Source
// locations").
func reportDafnyErrors(proofDirectory string, module ProofModule, output string, report func(*ast.Diagnostic)) {
	dfy, _ := os.ReadFile(filepath.Join(proofDirectory, filepath.FromSlash(module.Source)+".dfy"))
	lines := strings.Split(string(dfy), "\n")
	declarations := map[string]ProofDeclaration{}
	for _, root := range module.Roots {
		declarations[root.Name] = root
	}
	reported := false
	for _, line := range strings.Split(output, "\n") {
		m := dafnyError.FindStringSubmatch(strings.TrimSpace(line))
		if m == nil {
			continue
		}
		at := module.Roots[0]
		n, _ := strconv.Atoi(m[2])
		if member := dafnyMemberAt(lines, n); member != "" {
			if d, ok := declarations[strings.TrimSuffix(member, "_ensures")]; ok {
				at = d
			}
		}
		report(proveDiagnostic(at.File, at.Node.Name(), EK4315, at.Name, m[4]))
		reported = true
	}
	if !reported {
		at := module.Roots[0]
		report(proveDiagnostic(at.File, at.Node.Name(), EK4315, at.Name, firstLine(output)))
	}
}

// dafnyMember matches the first line of a Dafny member.
var dafnyMember = regexp.MustCompile(`^(?:(?:ghost|opaque|static)\s+)*(?:function|predicate|method|lemma)\s+(?:\{[^}]*\}\s*)*([A-Za-z_][A-Za-z0-9_]*)`)

// dafnyMemberAt returns the name of the member that holds line n, 1-based.
func dafnyMemberAt(lines []string, n int) string {
	for i := min(n, len(lines)) - 1; i >= 0; i-- {
		if m := dafnyMember.FindStringSubmatch(lines[i]); m != nil {
			return m[1]
		}
	}
	return ""
}

// printProofSummary prints one line per root and trusted function, the
// summary, the model and the credit, and returns the exit status.
func printProofSummary(sys tsc.System, configDirectory string, modules []ProofModule, proved map[*ast.Node]bool, lemmaScript string, dafny string) int {
	type row struct{ status, name, at string }
	var rows []row
	var trusted []string
	provedCount, failedCount := 0, 0
	for _, module := range modules {
		for _, root := range module.Roots {
			status := "failed"
			if proved[root.Node] {
				status = "proved"
				provedCount++
			} else {
				failedCount++
			}
			rows = append(rows, row{status, root.Name, relativeProofPath(root.File, configDirectory) + ":" + strconv.Itoa(root.Line)})
		}
	}
	seen := map[*ast.Node]bool{}
	for _, module := range modules {
		for _, t := range module.Trusted {
			if !seen[t.Node] {
				seen[t.Node] = true
				trusted = append(trusted, t.Name)
				rows = append(rows, row{"trusted", t.Name, relativeProofPath(t.File, configDirectory) + ":" + strconv.Itoa(t.Line)})
			}
		}
	}
	width := 0
	for _, r := range rows {
		width = max(width, len(r.name))
	}
	w := sys.Writer()
	for _, r := range rows {
		fmt.Fprintf(w, "%-8s%-*s%s\n", r.status, width+2, r.name, r.at)
	}
	summary := fmt.Sprintf("%d proved, %d not proved, %d trusted", provedCount, failedCount, len(trusted))
	if len(trusted) > 0 {
		summary += ": " + strings.Join(trusted, ", ")
	}
	fmt.Fprintln(w, summary+".")
	fmt.Fprintln(w, "Model: number is an unbounded integer: NaN, infinities, -0, fractions and the 2^53 limit are outside these proofs.")
	fmt.Fprintf(w, "Verified by LemmaScript %s (MIT, Midspiral, https://github.com/midspiral/LemmaScript) with Dafny %s.\n", lemmaScript, dafny)
	if failedCount > 0 {
		return 1
	}
	return 0
}
