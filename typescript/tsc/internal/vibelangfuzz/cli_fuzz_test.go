package vibelangfuzz

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/ast"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangestree"
)

// FuzzCommandLine runs the vibelang binary that cmd/tsc builds, as a user
// runs it, on a project archive and an argument list that the fuzzer's bytes
// choose from cliFlags: every flag the specification documents, the entry
// points cmd/tsc/main.go dispatches (--lsp, --api, --estree, dprint's
// --parent-pid and --write-dprint-plugin), and every TypeScript option, with
// values. A process is the only way to reach main.go's dispatch, its signal
// handling and its exit status. Its oracles:
//
//   - The process never panics and never hangs, whatever the arguments.
//   - Chapter 28, "Diagnostics": "vibelang exits non-zero when it reports
//     any error". A run that reports only warnings exits 0: lint "never
//     changes emit or the exit status" (D241), and TypeScript's ExitStatus
//     is Success when a compilation reports no error.
//   - Chapter 28, "Diagnostics" (D61): the diagnostics printed for a project
//     are the compiler's for the same project, by code, file, position and
//     category, an EK diagnostic printed as `error EK1003:`; `--pretty
//     false` output parses line by line.
//   - D291 and Chapter 28: --fix changes only the project's own .vibe files,
//     writes a file only when the fixed program reports no error the original
//     did not, and a second run changes nothing ("Idempotence", D372, D382).
//     Without --fix a compilation never rewrites a source: TypeScript reports
//     TS5055 instead of overwriting an input file.
//   - Chapter 28, "Linting" (D277): `vibelang --estree <file>` writes the
//     JSON that the library conversion, vibelangestree.Parse, gives for the
//     same text.
//   - TypeScript's command line: --help and --version print and exit 0 with
//     any project, and Chapter 28, "The editor" (D75): with --version the
//     binary identifies as the specification's example does.
//   - Chapter 27, "Settings belong to the source package": --ignoreConfig
//     with files named compiles them; TypeScript reports TS5112 for files
//     named beside a tsconfig.json without it.
//   - Chapter 28: --watch watches, rebuilding after an edit, and Ctrl+C
//     (SIGINT) stops it; the launcher forwards signals.
//   - Chapter 28, "The editor" (D32): `vibelang --lsp --stdio` answers
//     initialize, a documentSymbol request and shutdown without an error, and
//     exits 0 after exit (the Language Server Protocol's exit notification).
//     `--api --async` answers initialize and parseCommandLine, and ends when
//     its input closes.
func FuzzCommandLine(f *testing.F) {
	for _, seed := range cliSeeds() {
		f.Add(seed.archive, cliEncode(seed.args...))
	}
	w := NewWorkspace(f)
	binary := cliBuild(f, w.Dir)
	f.Fuzz(func(t *testing.T, archive string, choice []byte) {
		project := ProjectFromArchive(archive)
		if reason := cliAdmissible(project); reason != "" {
			t.Skip(reason)
		}
		args := cliDecode(choice)
		g := &Gaps{Target: cliTarget, Input: fmt.Sprintf("vibelang %s", cliQuote(args))}
		key := cliCorpusKey(t)
		if key != "" {
			g.Input = "testdata/fuzz/" + cliTarget + "/" + strings.TrimPrefix(key, "corpus:") + ": " + g.Input
		}
		var r *Result
		Within("compile", func() {
			var err error
			r, err = w.Compile(t.Context(), project)
			if err != nil {
				t.Fatal(err)
			}
		})
		defer r.Remove()
		Within("command line", func() {
			cliCheck(t, g, w, binary, r, project, args)
		})
		g.FinishInput(t, key)
	})
}

const cliTarget = "FuzzCommandLine"

// cliLog logs each run's command line, status and output when
// VIBELANG_FUZZ_CLI_LOG=1, to see what a seed exercises.
var cliLog = os.Getenv("VIBELANG_FUZZ_CLI_LOG") == "1"

// cliDeadline bounds one stage of a process. A process parses effect's
// declarations afresh, which a Workspace parses once, so it gets three times
// HangLimit; a stage that takes longer is a hang.
var cliDeadline = 3 * HangLimit

// A cliFlag is one entry of the argument table: a flag, or with no Name a
// positional argument, and the values the fuzzer chooses from.
type cliFlag struct {
	Name   string
	Values []string // cliBare writes the flag alone
	Source string   // where the flag is documented
}

// cliBare is the value that writes a flag without one.
const cliBare = "\x00"

var cliBareOnly = []string{cliBare}

// cliExcluded names the TypeScript and entry-point options the table leaves
// out, each with the reason. Each is safe to leave out: the reason is the
// harness's, not the compiler's.
var cliExcluded = map[string]string{
	"runExternalCode": "it runs the content mappers a configuration names; a fuzzed configuration must not run programs on the build host",
	"pipe":            "--api --pipe waits for a client to connect to its socket, by design",
	"callbacks":       "--api --callbacks asks the client for each file system call, which this harness does not answer",
}

// cliForeignFlags are the flag-shaped code spans of the specification that
// are other tools' flags, not vibelang's.
var cliForeignFlags = map[string]string{
	"--enable-source-maps": "Node's flag (Chapter 28, Building and testing)",
	"--no-install":         "bun x's and create-vibelang's flag (Chapter 28)",
	"-trimpath":            "go build's flag (Chapter 27)",
	"-browser":             "a package name's suffix (Chapter 11)",
	"-bun":                 "a package name's suffix (Chapter 11)",
	"--install-extension":  "VS Code's flag (Chapter 28, The editor)",
}

// cliFlags is the argument table: the entry points and VibeLang flags first,
// then every TypeScript command-line option, by its long and short names.
var cliFlags = sync.OnceValue(func() []cliFlag {
	pid := strconv.Itoa(os.Getpid())
	flags := []cliFlag{
		{"", []string{"main.vibe", "main.ts", "missing.vibe", "tsconfig.json"}, "Chapter 27: files named on the command line"},
		{"--fix", cliBareOnly, "Chapter 28, Diagnostics (D291)"},
		{"--fix-migration-only", cliBareOnly, "D382; internal/vibelang/fix.go"},
		{"--loader-root", []string{".", "sub", "missing"}, "Chapter 28, Building and testing; internal/vibelang/loaderroot.go"},
		{"--lsp", cliBareOnly, "Chapter 28, The editor (D32)"},
		{"--stdio", cliBareOnly, "Chapter 28, The editor (D32)"},
		{"--clientProcessId", []string{pid, "0", "x"}, "cmd/tsc/lsp.go"},
		{"--socket", []string{"sock"}, "cmd/tsc/lsp.go"},
		{"--api", cliBareOnly, "Chapter 28, Packages and versions"},
		{"--async", cliBareOnly, "cmd/tsc/api.go"},
		{"--timing", cliBareOnly, "cmd/tsc/api.go"},
		{"--cwd", []string{".", "sub"}, "cmd/tsc/api.go"},
		{"--useCaseSensitiveFileNames", cliBareOnly, "cmd/tsc/api.go"},
		{"--estree", cliBareOnly, "Chapter 28, Linting (D277)"},
		{"--parent-pid", []string{pid, "nope"}, "cmd/tsc/dprint.go"},
		{"--write-dprint-plugin", []string{"plugin"}, "cmd/tsc/dprint.go"},
	}
	seen := map[string]bool{}
	for _, flag := range flags {
		seen[strings.ToLower(flag.Name)] = true
	}
	for _, option := range slices.Concat(tsoptions.OptionsDeclarations, tsoptions.OptionsForBuild) {
		if option.IsTSConfigOnly || option.Kind == tsoptions.CommandLineOptionTypeObject || cliExcluded[option.Name] != "" || seen["--"+strings.ToLower(option.Name)] {
			continue
		}
		seen["--"+strings.ToLower(option.Name)] = true
		values := cliValues(option)
		flags = append(flags, cliFlag{"--" + option.Name, values, "TypeScript's command line"})
		if option.ShortName != "" && !seen["-"+strings.ToLower(option.ShortName)] {
			seen["-"+strings.ToLower(option.ShortName)] = true
			flags = append(flags, cliFlag{"-" + option.ShortName, values, "TypeScript's command line"})
		}
	}
	return flags
})

// cliValues returns the values the fuzzer gives a TypeScript option: each of
// an enum's names, both booleans, and relative paths that stay inside the
// project's directory, plus one invalid value of each kind.
func cliValues(option *tsoptions.CommandLineOption) []string {
	switch option.Name {
	case "project":
		return []string{"tsconfig.json", ".", "sub", "missing.json"}
	case "locale":
		return []string{"en", "de", "zz"}
	case "outDir", "declarationDir", "rootDir", "generateTrace", "pprofDir", "baseUrl":
		return []string{"out2", "sub", "."}
	case "outFile", "tsBuildInfoFile", "generateCpuProfile":
		return []string{"out2/x.js", "x.tsbuildinfo"}
	}
	switch option.Kind {
	case tsoptions.CommandLineOptionTypeBoolean:
		return []string{cliBare, "true", "false"}
	case tsoptions.CommandLineOptionTypeNumber:
		return []string{"0", "1", "-1", "x"}
	case tsoptions.CommandLineOptionTypeEnum:
		return append(slices.Collect(option.EnumMap().Keys()), "nope")
	case tsoptions.CommandLineOptionTypeList, tsoptions.CommandLineOptionTypeListOrElement:
		if element := option.Elements(); element != nil && element.Kind == tsoptions.CommandLineOptionTypeEnum {
			keys := slices.Collect(element.EnumMap().Keys())
			values := []string{"nope", ""}
			if len(keys) > 0 {
				values = append(values, keys[0], keys[len(keys)-1], keys[0]+","+keys[len(keys)-1])
			}
			return values
		}
		return []string{"a,b", "sub", ""}
	}
	return []string{".", "sub", "x.json", ""}
}

// cliDecode turns the fuzzer's bytes into an argument list: each pair of
// bytes chooses a flag and its value. No bytes is bare vibelang, which
// Chapter 28 says "checks and emits".
func cliDecode(choice []byte) []string {
	flags := cliFlags()
	var args []string
	for i := 0; i+1 < len(choice) && i < 24; i += 2 {
		flag := flags[int(choice[i])%len(flags)]
		value := flag.Values[int(choice[i+1])%len(flag.Values)]
		if flag.Name != "" {
			args = append(args, flag.Name)
		}
		if value != cliBare {
			args = append(args, value)
		}
	}
	return args
}

// cliEncode is cliDecode's inverse for the seeds' argument lists. It panics
// on an argument the table cannot write, since a seed must decode to itself.
func cliEncode(args ...string) []byte {
	flags := cliFlags()
	var choice []byte
	for i := 0; i < len(args); i++ {
		at := slices.IndexFunc(flags, func(f cliFlag) bool { return f.Name == args[i] })
		value := cliBare
		if at < 0 {
			at, value = 0, args[i]
		} else if i+1 < len(args) && slices.Contains(flags[at].Values, args[i+1]) {
			value = args[i+1]
			i++
		}
		v := slices.Index(flags[at].Values, value)
		if v < 0 || at > 255 || v > 255 {
			panic(fmt.Sprintf("cliEncode: the table cannot write %q in %q", args[i], args))
		}
		choice = append(choice, byte(at), byte(v))
	}
	if got := cliDecode(choice); !slices.Equal(got, args) {
		panic(fmt.Sprintf("cliEncode: %q decodes as %q", args, got))
	}
	return choice
}

func cliQuote(args []string) string {
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = arg
		if arg == "" || strings.ContainsAny(arg, " \t\n\"'") {
			quoted[i] = strconv.Quote(arg)
		}
	}
	return strings.Join(quoted, " ")
}

type cliSeed struct {
	archive string
	args    []string
}

// cliSeeds pairs a few acceptance cases with the command lines the
// specification shows: Chapter 28's bare vibelang, --noEmit, -p
// tsconfig.json --fix, --watch, -b, --lsp --stdio, --api, --version and
// --estree, Chapter 27's --ignoreConfig with a file named, and the
// --fix-migration-only run of docs/tools/fix-snippets.ts.
func cliSeeds() []cliSeed {
	lines := [][]string{
		{},
		{"--noEmit"},
		{"-p", "tsconfig.json", "--fix", "--noEmit"},
		{"--pretty", "false"},
		{"--version"},
		{"--help"},
		{"-b"},
		{"--watch"},
		{"--lsp", "--stdio"},
		{"--api", "--async"},
		{"--estree", "main.vibe"},
		{"--ignoreConfig", "main.vibe"},
		{"--fix", "--fix-migration-only", "--noEmit", "--pretty", "false", "-p", "tsconfig.json"},
	}
	var cases []Seed
	for _, seed := range CaseSeeds() {
		if seed.Pending == "" && seed.Files["main.vibe"] != "" && len(seed.Files) <= 4 {
			cases = append(cases, seed)
		}
	}
	if len(cases) == 0 {
		panic("cliSeeds: no acceptance case with a main.vibe")
	}
	// The tsforms cases have warnings and quick fixes, the others errors and
	// runnable programs; take both kinds, spread over the list.
	var seeds []cliSeed
	tsforms := slices.IndexFunc(cases, func(s Seed) bool { return strings.HasPrefix(s.Name, "tsforms-") })
	for i, args := range lines {
		seed := cases[(i*37)%len(cases)]
		if tsforms >= 0 && (slices.Contains(args, "--fix") || i == 0) {
			seed = cases[tsforms]
		}
		seeds = append(seeds, cliSeed{Archive(seed.Files), args})
	}
	return seeds
}

func cliAdmissible(project Project) string {
	if len(project.Files) == 0 || len(project.Files) > 24 {
		return "no files, or too many"
	}
	size := len(project.Config)
	for _, text := range project.Files {
		size += len(text)
	}
	if size > 64<<10 {
		return "too large"
	}
	return ConfinedProject(project)
}

// cliCorpusKey returns "corpus:<file>" for an input in testdata/fuzz, or "".
func cliCorpusKey(t *testing.T) string {
	name := path.Base(t.Name())
	if strings.HasPrefix(name, "seed#") || name == cliTarget {
		return ""
	}
	if _, err := os.Stat(filepath.Join(repoTestdata(), "fuzz", cliTarget, name)); err != nil {
		return ""
	}
	return "corpus:" + name
}

// cliBuild builds cmd/tsc, the vibelang binary, into dir. A target that
// cannot build it skips: the go command is the build host's.
func cliBuild(tb testing.TB, dir string) string {
	tb.Helper()
	gocmd, err := exec.LookPath("go")
	if err != nil {
		tb.Skipf("go is not on PATH, so the vibelang binary cannot be built: %v", err)
	}
	binary := filepath.Join(dir, "vibelang")
	cmd := exec.Command(gocmd, "build", "-o", binary, "./cmd/tsc")
	cmd.Dir = filepath.Join(Root(), "typescript/tsc")
	cliIsolate(cmd)
	if out, err := cmd.CombinedOutput(); err != nil {
		tb.Fatalf("go build ./cmd/tsc: %v\n%s", err, out)
	}
	return binary
}

// A cliRun is what one process did.
type cliRun struct {
	Status         int
	Stdout, Stderr string
	Hung           string // the stage that did not end, or ""
	Watching       bool   // it printed a watch status
	Rebuilt        bool   // it printed a second one after an edit
	Edited         map[string]string
}

// A cliBuffer is a bytes.Buffer that the process's writer and the test read
// at the same time.
type cliBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *cliBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *cliBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

const cliWatching = "Watching for file changes"

// cliWatchDeadline guards the wait for a rebuild's status; the status, not
// this time, decides that the watcher rebuilt. cliRetouch is how often the
// sources are written again until it does.
var cliWatchDeadline, cliRetouch = 3 * cliDeadline, 2 * time.Second

// cliIsolate runs a child in a process group of its own, so that a signal it
// sends to its group, or one the harness sends it, never reaches the fuzz
// worker: a worker that dies of SIGINT looks to the fuzz engine like a user
// pressing Ctrl+C, and is not restarted. WaitDelay ends Wait when a
// grandchild keeps one of its pipes open.
func cliIsolate(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = time.Second
}

// cliSignal sends sig to a started child's process group: the child and
// any process it started.
func cliSignal(cmd *exec.Cmd, sig syscall.Signal) {
	if cmd.Process != nil {
		_ = syscall.Kill(-cmd.Process.Pid, sig)
	}
}

// cliTouch writes the edited sources.
func cliTouch(dir string, edited map[string]string) {
	for name, text := range edited {
		_ = os.WriteFile(filepath.Join(dir, filepath.FromSlash(name)), []byte(text), 0o600)
	}
}

func cliCommand(binary, dir string, args []string) *exec.Cmd {
	cmd := exec.Command(binary, args...)
	cmd.Dir = dir
	var env []string
	for _, kv := range os.Environ() {
		// Colors and watch logs would depend on the host's environment.
		if !strings.HasPrefix(kv, "FORCE_COLOR=") && !strings.HasPrefix(kv, "TS_WATCH_DEBUG=") && !strings.HasPrefix(kv, "NO_COLOR=") {
			env = append(env, kv)
		}
	}
	cmd.Env = append(env, "NO_COLOR=1")
	cliIsolate(cmd)
	return cmd
}

// cliExec runs the binary in dir with stdin. When the process prints a
// watch status, it appends a newline to each source of project, waits for
// the rebuild's status, and sends SIGINT, as Ctrl+C does. The watcher may
// print its status before its watches are in place, so an edit made at once
// can go unseen; the sources are written again every cliRetouch, each time
// with a new modification time, until the watcher's own rebuild status
// shows that it saw one. Only a watcher that prints none within
// cliWatchDeadline hangs.
func cliExec(binary, dir string, args []string, stdin string, project Project) cliRun {
	cmd := cliCommand(binary, dir, args)
	stdout, stderr := &cliBuffer{}, &cliBuffer{}
	cmd.Stdout, cmd.Stderr = stdout, stderr
	cmd.Stdin = strings.NewReader(stdin)
	run := cliRun{Status: -1}
	if err := startChild(cmd); err != nil {
		run.Hung = "start: " + err.Error()
		return run
	}
	done := make(chan struct{})
	go func() {
		_ = waitChild(cmd)
		close(done)
	}()
	stage, deadline := "run", time.Now().Add(cliDeadline)
	var touched time.Time
	for ended := false; !ended; {
		select {
		case <-done:
			ended = true
			continue
		case <-time.After(20 * time.Millisecond):
		}
		statuses := strings.Count(stdout.String(), cliWatching)
		switch {
		case stage == "run" && statuses >= 1:
			run.Watching = true
			run.Edited = map[string]string{}
			for name, text := range project.Files {
				if isSource(name) {
					run.Edited[name] = text + "\n"
				}
			}
			cliTouch(dir, run.Edited)
			touched = time.Now()
			stage, deadline = "rebuild", time.Now().Add(cliWatchDeadline)
		case stage == "rebuild" && statuses >= 2:
			run.Rebuilt = true
			cliSignal(cmd, syscall.SIGINT)
			stage, deadline = "signal", time.Now().Add(cliDeadline)
		case time.Now().After(deadline):
			run.Hung = stage
			cliSignal(cmd, syscall.SIGKILL)
			<-done
			ended = true
		case stage == "rebuild" && time.Since(touched) >= cliRetouch:
			cliTouch(dir, run.Edited)
			touched = time.Now()
		}
	}
	if run.Hung == "" {
		run.Status = cmd.ProcessState.ExitCode()
	}
	run.Stdout, run.Stderr = stdout.String(), stderr.String()
	return run
}

// cliCrashed reports whether a Go process panicked or died of a runtime
// error: it printed a goroutine trace.
func cliCrashed(run cliRun) bool {
	text := run.Stdout + run.Stderr
	return (strings.Contains(text, "panic:") || strings.Contains(text, "fatal error:")) && strings.Contains(text, "\ngoroutine ")
}

// A printed diagnostic, from its header line.
type cliDiagnostic struct {
	File      string // "" for a global diagnostic
	Line, Col int
	Category  string
	Prefix    string // "TS" or "EK"
	Code      int
}

func (d cliDiagnostic) String() string {
	if d.File == "" {
		return fmt.Sprintf("%s %s%d", d.Category, d.Prefix, d.Code)
	}
	return fmt.Sprintf("%s(%d,%d): %s %s%d", d.File, d.Line, d.Col, d.Category, d.Prefix, d.Code)
}

var (
	cliANSI = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")
	// tsc prints `file(line,col): error TS1005: …` without --pretty and
	// `file:line:col - error TS1005: …` with it; a global diagnostic has no
	// location.
	cliHeader = regexp.MustCompile(`^(?:(\S[^\n]*?)\((\d+),(\d+)\): |(\S[^\n]*?):(\d+):(\d+) - )?(error|warning|message|suggestion) (TS|EK)(\d+): `)
)

// cliParse returns the diagnostics a run printed, one per header line.
func cliParse(stdout string) []cliDiagnostic {
	var found []cliDiagnostic
	for line := range strings.SplitSeq(cliANSI.ReplaceAllString(stdout, ""), "\n") {
		if strings.HasPrefix(line, "vibelang --fix:") {
			continue // --fix's report quotes the errors it refused to add
		}
		m := cliHeader.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		d := cliDiagnostic{Category: m[7], Prefix: m[8]}
		d.Code, _ = strconv.Atoi(m[9])
		switch {
		case m[1] != "":
			d.File = m[1]
			d.Line, _ = strconv.Atoi(m[2])
			d.Col, _ = strconv.Atoi(m[3])
		case m[4] != "":
			d.File = m[4]
			d.Line, _ = strconv.Atoi(m[5])
			d.Col, _ = strconv.Atoi(m[6])
		}
		found = append(found, d)
	}
	return found
}

// cliLibrary returns the compiler's diagnostics as the command line would
// print them from dir.
func cliLibrary(dir string, ds []*ast.Diagnostic) []cliDiagnostic {
	var found []cliDiagnostic
	for _, d := range ds {
		c := cliDiagnostic{Category: d.Category().Name(), Prefix: "TS", Code: int(d.Code())}
		if IsEK(d) {
			c.Prefix = "EK" // D61: the CLI prints `error EK1003:`
		}
		if d.File() != nil {
			// D283: a module declaration's body is a source file of its own
			// whose positions are its VibeLang file's, and Chapter 28 (D61)
			// prints a diagnostic at the .vibe span.
			file := d.File()
			if canonical := file.CanonicalSourceFile(); canonical != nil && file.EmbeddedModule() != nil {
				file = canonical
			}
			rel, err := filepath.Rel(dir, filepath.FromSlash(file.FileName().AsString()))
			if err != nil {
				rel = file.FileName().AsString()
			}
			c.File = filepath.ToSlash(rel)
			c.Line, c.Col = LineAndColumn(d)
		}
		found = append(found, c)
	}
	return found
}

func cliSet(ds []cliDiagnostic) map[string]bool {
	set := map[string]bool{}
	for _, d := range ds {
		set[d.String()] = true
	}
	return set
}

// cliOptions parses an argument list as tsc does, without touching the
// project, or returns nil for an entry point that is not tsc's.
func cliOptions(w *Workspace, dir string, args []string) *tsoptions.ParsedCommandLine {
	if len(args) > 0 && cliDispatched(args[0]) || cliBuildMode(args) {
		return nil
	}
	rest := slices.DeleteFunc(slices.Clone(args), func(arg string) bool {
		return strings.EqualFold(arg, "--fix") || strings.EqualFold(arg, "--fix-migration-only")
	})
	return tsoptions.ParseCommandLine(rest, w.fs, tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(dir)))
}

// cliDispatched reports whether main.go hands the first argument to an
// entry point other than tsc's.
func cliDispatched(first string) bool {
	switch first {
	case "--lsp", "--api", "--parent-pid", "--write-dprint-plugin", "--estree":
		return true
	}
	return false
}

func cliBuildMode(args []string) bool {
	if len(args) == 0 {
		return false
	}
	switch strings.ToLower(args[0]) {
	case "-b", "--b", "-build", "--build":
		return true
	}
	return false
}

func cliHasFix(args []string) bool {
	return slices.ContainsFunc(args, func(arg string) bool { return strings.EqualFold(arg, "--fix") })
}

// cliNeutral reports whether a command line compiles the project as its
// tsconfig.json says, so that its diagnostics are the library's: only -p
// naming that file, --pretty false and --noEmit.
func cliNeutral(args []string, options *tsoptions.ParsedCommandLine) bool {
	if options == nil || len(options.Errors) > 0 || len(options.FileNames()) > 0 || options.CompilerOptions().Pretty.IsTrue() {
		return false
	}
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--fix", "--fix-migration-only":
		case "--noEmit":
			if i+1 < len(args) && (args[i+1] == "true" || args[i+1] == "false") {
				i++
			}
		case "--pretty":
			if i+1 >= len(args) || args[i+1] != "false" {
				return false
			}
			i++
		case "-p", "--project":
			if i+1 >= len(args) || (args[i+1] != "tsconfig.json" && args[i+1] != ".") {
				return false
			}
			i++
		default:
			return false
		}
	}
	return true
}

// cliSources reads the project's files back from dir.
func cliSources(dir string, project Project) map[string]string {
	files := map[string]string{}
	for name := range project.Files {
		if data, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(name))); err == nil {
			files[name] = string(data)
		}
	}
	return files
}

// cliChanged returns the names of the files whose text differs from before.
func cliChanged(before, after map[string]string) []string {
	var changed []string
	for name, text := range before {
		if got, ok := after[name]; !ok || got != text {
			changed = append(changed, name)
		}
	}
	slices.Sort(changed)
	return changed
}

// cliErrorCounts counts a compilation's errors by file and code.
func cliErrorCounts(r *Result) map[string]int {
	counts := map[string]int{}
	for _, d := range r.Diagnostics {
		if d.Category() != diagnostics.CategoryError {
			continue
		}
		file := ""
		if d.File() != nil {
			file = strings.TrimPrefix(d.File().FileName().AsString(), filepath.ToSlash(r.Dir)+"/")
		}
		counts[fmt.Sprintf("%s %s%d", file, cmp(d.Source(), "TS"), d.Code())]++
	}
	return counts
}

// cliMainFile returns the project's first .vibe source, or its first file.
func cliMainFile(project Project) string {
	names := slices.Sorted(maps.Keys(project.Files))
	for _, name := range names {
		if strings.HasSuffix(name, ".vibe") {
			return name
		}
	}
	return names[0]
}

// cliCheck runs one argument list in the compiled project's directory and
// applies the oracles that hold for it.
func cliCheck(t *testing.T, g *Gaps, w *Workspace, binary string, r *Result, project Project, args []string) {
	dir := r.Dir
	if len(args) > 0 && args[0] == "--lsp" && slices.Contains(args, "--stdio") {
		cliCheckLSP(g, binary, dir, args, project)
		return
	}
	if len(args) > 0 && args[0] == "--api" && slices.Contains(args, "--async") {
		cliCheckAPI(g, binary, dir, args)
		return
	}
	if slices.ContainsFunc(args, func(arg string) bool { return strings.EqualFold(arg, "-w") || strings.EqualFold(arg, "--watch") }) {
		// A translated watch status would not be recognized.
		for i := 0; i < len(args); i++ {
			if strings.EqualFold(args[i], "--locale") {
				args = slices.Delete(slices.Clone(args), i, min(i+2, len(args)))
				i--
			}
		}
	}
	main := cliMainFile(project)
	stdin := ""
	if len(args) > 0 && args[0] == "--estree" {
		stdin = project.Files[main]
	}
	before := cliSources(dir, project)
	run := cliExec(binary, dir, args, stdin, project)
	report := func() string {
		return fmt.Sprintf("vibelang %s\nexit status %d\nstdout:\n%s\nstderr:\n%s", cliQuote(args), run.Status, cliTail(run.Stdout), cliTail(run.Stderr))
	}
	if cliLog {
		t.Logf("%s", report())
	}
	if cliCrashed(run) {
		g.Add("crash", "the process panicked:\n%s", report())
		return
	}
	if run.Hung != "" {
		g.Add("hang:"+run.Hung, "the process did not end its %s stage within %v:\n%s", run.Hung, cliDeadline, report())
		return
	}
	if len(args) > 0 && cliDispatched(args[0]) {
		if args[0] == "--estree" && len(args) == 2 {
			cliCheckESTree(g, run, args[1], stdin, report)
			// Chapter 28, Linting: --estree converts the VibeLang parser's
			// tree, so a file the compiler parses without a syntax error
			// converts without one. A module body is a source file of its
			// own, so the check asks the whole program.
			if args[1] == main && r.SourceFile(main) != nil && len(r.Program.GetSyntacticDiagnostics(t.Context(), nil)) == 0 && strings.HasPrefix(run.Stdout, `{"error"`) {
				g.Add("estree:syntax", "the compiler parses %s without a syntax error, but --estree reports one:\n%s\n%s", main, report(), project.Files[main])
			}
		}
		return
	}
	if run.Watching {
		// Chapter 28: "--watch watches", and Ctrl+C stops it (checked by
		// cliExec's signal stage ending). A watcher that never rebuilds is
		// a hang of the rebuild stage; one that ends before it rebuilt
		// stopped watching.
		if !run.Rebuilt {
			g.Add("watch:rebuild", "the watcher ended without a rebuild status after every source changed:\n%s", report())
		}
		for name, text := range run.Edited {
			before[name] = text
		}
	}
	options := cliOptions(w, dir, args)
	printed := cliParse(run.Stdout)
	errors := slices.ContainsFunc(printed, func(d cliDiagnostic) bool { return d.Category == "error" })
	// Chapter 28: "vibelang exits non-zero when it reports any error". A run
	// that reports only warnings exits 0: lint "never changes emit or the
	// exit status" (D241), and TypeScript's ExitStatus is Success when a
	// compilation reports no error. Where the library decides what the run
	// reports, the status is checked against it, whatever the run printed:
	// the command line's own errors (options.Errors) always, and the
	// program's errors for a neutral run that compiles the project as its
	// tsconfig.json says without --fix, whose own reports the library
	// compile does not make, and changed no file. --noEmit skips the declaration
	// emitter's errors, which Compile reports, so a --noEmit run is decided
	// only when the library reports no error. Any other run is judged by
	// what it printed. --quiet hides the errors it would report.
	quiet := options != nil && options.CompilerOptions().Quiet.IsTrue()
	after := cliSources(dir, project)
	changed := cliChanged(before, after)
	library, decided := cliLibraryStatus(r, options, cliNeutral(args, options) && len(changed) == 0 && !cliHasFix(args))
	switch {
	case run.Watching:
	case decided && library && run.Status == 0:
		g.Add("status:error-exit-zero", "the compiler reports an error for this command line, and it exited 0:\n%s", report())
	case decided && !library && run.Status != 0 && !quiet:
		g.Add("status:no-error-nonzero", "the compiler reports no error for this command line, and it exited %d:\n%s", run.Status, report())
	case !decided && errors && run.Status == 0:
		g.Add("status:error-exit-zero", "it printed an error and exited 0:\n%s", report())
	case !decided && !errors && !quiet && run.Status != 0 && run.Stderr == "":
		g.Add("status:no-error-nonzero", "it printed no error and exited %d:\n%s", run.Status, report())
	}
	// TypeScript's --help and --version print and exit 0 with any project;
	// Chapter 28 (D75) gives the form --version prints.
	if options != nil && len(options.Errors) == 0 && !cliHasFix(args) && !options.CompilerOptions().Init.IsTrue() {
		switch {
		case options.CompilerOptions().Version.IsTrue():
			if run.Status != 0 || !cliVersion().MatchString(run.Stdout) {
				g.Add("version", "--version did not print %q and exit 0:\n%s", cliVersion().String(), report())
			}
		case options.CompilerOptions().Help.IsTrue() || options.CompilerOptions().All.IsTrue():
			if run.Status != 0 || strings.TrimSpace(run.Stdout) == "" {
				g.Add("help", "--help did not print and exit 0:\n%s", report())
			}
		}
	}
	// Chapter 27 and TypeScript: files named beside a tsconfig.json are
	// TS5112 without --ignoreConfig, and compile with it.
	if options != nil && len(options.Errors) == 0 && len(options.FileNames()) > 0 && options.CompilerOptions().Project == "" &&
		!options.CompilerOptions().Version.IsTrue() && !options.CompilerOptions().Help.IsTrue() && !options.CompilerOptions().All.IsTrue() && !options.CompilerOptions().Init.IsTrue() {
		reported := slices.ContainsFunc(printed, func(d cliDiagnostic) bool { return d.Code == 5112 })
		if ignore := options.CompilerOptions().IgnoreConfig.IsTrue(); ignore == reported && !quiet {
			g.Add("ignoreConfig", "with --ignoreConfig %v, TS5112 was reported: %v:\n%s", ignore, reported, report())
		}
	}
	if !cliHasFix(args) {
		// TypeScript reports TS5055 rather than overwrite an input file.
		for _, name := range changed {
			if isSource(name) && !strings.HasSuffix(name, ".d.ts") {
				g.Add("compile:input", "the compilation rewrote the source %s:\n%s", name, report())
			}
		}
	}
	neutral := cliNeutral(args, options)
	// A --fix run that changed a file compiles the fixed program, whose
	// diagnostics cliCheckFix compares instead.
	if neutral && !run.Watching && len(changed) == 0 {
		cliCheckDiagnostics(t, g, r, printed, options.CompilerOptions().NoEmit.IsTrue(), report)
	}
	if cliHasFix(args) && !cliBuildMode(args) && !run.Watching {
		cliCheckFix(t, g, w, binary, r, project, args, before, after, changed, neutral, report)
	}
}

// cliLibraryStatus reports whether the library reports an error for a
// command line, and whether it decides that: an error among the command
// line's own diagnostics, or, for a neutral run, the program's errors as
// Compile reports them. A --noEmit run is decided only when Compile reports
// no error, since --noEmit skips the declaration emitter's.
func cliLibraryStatus(r *Result, options *tsoptions.ParsedCommandLine, neutral bool) (errors, decided bool) {
	if options == nil {
		return false, false
	}
	if HasError(options.Errors) {
		return true, true
	}
	if !neutral {
		return false, false
	}
	errors = HasError(r.Diagnostics)
	if errors && options.CompilerOptions().NoEmit.IsTrue() {
		return false, false
	}
	return errors, true
}

// cliCheckDiagnostics compares what a neutral run printed with the
// compiler's diagnostics for the same project (Chapter 28, D61).
func cliCheckDiagnostics(t *testing.T, g *Gaps, r *Result, printed []cliDiagnostic, noEmit bool, report func() string) {
	library := cliSet(cliLibrary(r.Dir, r.Diagnostics))
	cli := cliSet(printed)
	var extra, missing []string
	for d := range cli {
		if !library[d] {
			extra = append(extra, d)
		}
	}
	// tsc stops after syntax errors, and --noEmit skips the declaration
	// emitter's diagnostics; Compile reports both, so equality holds only
	// without them, and without configuration diagnostics, which tsc reports
	// alone.
	syntax := r.Program == nil || len(r.Program.GetSyntacticDiagnostics(t.Context(), nil)) > 0
	global := slices.ContainsFunc(r.Diagnostics, func(d *ast.Diagnostic) bool {
		return d.File() == nil || strings.HasSuffix(d.File().FileName().AsString(), ".json")
	})
	if !syntax && !global && !noEmit {
		for d := range library {
			if !cli[d] {
				missing = append(missing, d)
			}
		}
	}
	slices.Sort(extra)
	slices.Sort(missing)
	if len(extra) > 0 {
		g.Add("diagnostics:extra", "the command line printed diagnostics the compiler does not report for the project: %s\ncompiler: %s\n%s", strings.Join(extra, "; "), strings.Join(slices.Sorted(maps.Keys(library)), "; "), report())
	}
	if len(missing) > 0 {
		g.Add("diagnostics:missing", "the command line did not print the compiler's diagnostics %s\n%s", strings.Join(missing, "; "), report())
	}
}

// cliCheckFix checks D291 and Chapter 28's "Rewrites keep meaning" for a run
// with --fix.
func cliCheckFix(t *testing.T, g *Gaps, w *Workspace, binary string, r *Result, project Project, args []string, before, after map[string]string, changed []string, neutral bool, report func() string) {
	if len(changed) == 0 {
		return
	}
	// Chapter 28: --fix applies its fixes "to a project's own .vibe files".
	for _, name := range changed {
		if !strings.HasSuffix(name, ".vibe") {
			g.Add("fix:scope", "--fix changed %s, which is not one of the project's own .vibe files:\n%s", name, report())
		}
	}
	// D291: --fix writes a file only when the fixed program reports no error
	// the original did not. The comparison holds when the command line adds
	// no compiler option, so that the library compiles the same program.
	if neutral {
		var fixed *Result
		Within("compile fixed", func() {
			var err error
			fixed, err = w.Compile(t.Context(), Project{Files: after, Config: project.Config})
			if err != nil {
				t.Fatal(err)
			}
		})
		defer fixed.Remove()
		baseline := cliErrorCounts(r)
		var added []string
		for key, n := range cliErrorCounts(fixed) {
			if n > baseline[key] {
				added = append(added, key)
			}
		}
		if len(added) > 0 {
			slices.Sort(added)
			g.Add("fix:new-error", "--fix wrote files whose program reports errors the original did not: %s\nfixed:\n%s\n%s", strings.Join(added, "; "), Archive(after), report())
		}
	}
	// "Idempotence": a second run changes nothing (D372, D382).
	again := cliExec(binary, r.Dir, args, "", project)
	if cliCrashed(again) || again.Hung != "" {
		g.Add("fix:second-run", "the second --fix run crashed or hung (%q):\n%s\n%s", again.Hung, cliTail(again.Stdout), cliTail(again.Stderr))
		return
	}
	if second := cliChanged(after, cliSources(r.Dir, project)); len(second) > 0 {
		g.Add("fix:idempotence", "a second --fix changed %s:\nfixed:\n%s\nthen:\n%s", strings.Join(second, ", "), Archive(after), Archive(cliSources(r.Dir, project)))
	}
}

// cliCheckESTree compares `vibelang --estree <file>` with the library
// conversion of the same text (Chapter 28, Linting, D277).
func cliCheckESTree(g *Gaps, run cliRun, name, text string, report func() string) {
	var got any
	if err := json.Unmarshal([]byte(run.Stdout), &got); err != nil {
		g.Add("estree:json", "--estree did not write JSON (%v):\n%s", err, report())
		return
	}
	tree, failure := vibelangestree.Parse(name, text)
	var want any
	if failure != nil {
		encoded, _ := json.Marshal(map[string]any{"error": failure})
		_ = json.Unmarshal(encoded, &want)
	} else if err := json.Unmarshal([]byte(`{"ast":`+tree+`}`), &want); err != nil {
		g.Add("estree:library", "vibelangestree.Parse returned JSON that does not parse (%v)", err)
		return
	}
	if !reflect.DeepEqual(got, want) {
		g.Add("estree:library", "--estree %s wrote JSON that differs from vibelangestree.Parse for the same text:\n%s", name, report())
	}
}

// cliVersion is the form Chapter 28 gives `vibelang --version`, read from
// its example "identifies as `VibeLang 0.0.11 (TypeScript 7.1.0-dev)`", with
// each version number a pattern.
var cliVersion = sync.OnceValue(func() *regexp.Regexp {
	m := regexp.MustCompile("identifies as\\s+`([^`]+)`").FindStringSubmatch(SpecText("428-part4-ch28-tooling.md"))
	if m == nil {
		panic("Chapter 28 no longer gives the form of --version")
	}
	pattern := regexp.MustCompile(`\d+`).ReplaceAllString(regexp.QuoteMeta(m[1]), `\d+`)
	return regexp.MustCompile(pattern)
})

func cliTail(text string) string {
	if len(text) > 4000 {
		return "…" + text[len(text)-4000:]
	}
	return text
}

// A cliSession speaks JSON-RPC with Content-Length framing, as the language
// server and the async API do, to a process's stdin and stdout.
type cliSession struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	replies chan map[string]any
	stderr  *cliBuffer
	done    chan struct{}
}

func cliStartSession(binary, dir string, args []string) (*cliSession, error) {
	cmd := cliCommand(binary, dir, args)
	s := &cliSession{cmd: cmd, replies: make(chan map[string]any, 64), stderr: &cliBuffer{}, done: make(chan struct{})}
	cmd.Stderr = s.stderr
	var err error
	if s.stdin, err = cmd.StdinPipe(); err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := startChild(cmd); err != nil {
		return nil, err
	}
	go func() {
		reader := bufio.NewReader(stdout)
		for {
			message, err := cliReadMessage(reader)
			if err != nil {
				break
			}
			if _, isRequest := message["method"]; isRequest {
				if id, ok := message["id"]; ok {
					// Answer the server's own requests, such as
					// workspace/configuration, so that it never waits.
					s.send(map[string]any{"jsonrpc": "2.0", "id": id, "result": nil})
				}
				continue
			}
			s.replies <- message
		}
		_ = waitChild(cmd)
		close(s.done)
	}()
	return s, nil
}

func cliReadMessage(reader *bufio.Reader) (map[string]any, error) {
	length := -1
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimSpace(line)
		if line == "" {
			break
		}
		if value, ok := strings.CutPrefix(strings.ToLower(line), "content-length:"); ok {
			length, _ = strconv.Atoi(strings.TrimSpace(value))
		}
	}
	if length < 0 {
		return nil, fmt.Errorf("a message without Content-Length")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(reader, body); err != nil {
		return nil, err
	}
	var message map[string]any
	return message, json.Unmarshal(body, &message)
}

var cliSendMu sync.Mutex

func (s *cliSession) send(message map[string]any) error {
	body, _ := json.Marshal(message)
	cliSendMu.Lock()
	defer cliSendMu.Unlock()
	_, err := fmt.Fprintf(s.stdin, "Content-Length: %d\r\n\r\n%s", len(body), body)
	return err
}

// call sends a request and returns its reply, or why there is none.
func (s *cliSession) call(id int, method string, params any) (map[string]any, string) {
	message := map[string]any{"jsonrpc": "2.0", "id": id, "method": method}
	if params != nil {
		message["params"] = params
	}
	if err := s.send(message); err != nil {
		return nil, "exited"
	}
	timeout := time.After(cliDeadline)
	for {
		select {
		case reply := <-s.replies:
			if got, ok := reply["id"].(float64); ok && int(got) == id {
				return reply, ""
			}
		case <-s.done:
			// The reader queued every reply before the process ended, and
			// select picks among ready cases at random: read them first.
			for {
				select {
				case reply := <-s.replies:
					if got, ok := reply["id"].(float64); ok && int(got) == id {
						return reply, ""
					}
				default:
					return nil, "exited"
				}
			}
		case <-timeout:
			return nil, "hang"
		}
	}
}

// log prints a reply when VIBELANG_FUZZ_CLI_LOG=1.
func (s *cliSession) log(method string, reply map[string]any, why string) {
	if cliLog {
		encoded, _ := json.Marshal(reply)
		fmt.Fprintf(os.Stderr, "%s %s: %s %s\n", cliQuote(s.cmd.Args[1:]), method, why, cliTail(string(encoded)))
	}
}

// wait closes stdin and waits for the process to end, or kills its process
// group. The reader of its output ends when every process holding the pipe
// is gone, and only then waits for the process, so the kill reaches the whole
// group; a process that left the group and holds the pipe cannot block the
// target past another deadline.
func (s *cliSession) wait() (int, bool) {
	_ = s.stdin.Close()
	select {
	case <-s.done:
		return s.cmd.ProcessState.ExitCode(), true
	case <-time.After(cliDeadline):
		cliSignal(s.cmd, syscall.SIGKILL)
		select {
		case <-s.done:
		case <-time.After(cliDeadline):
		}
		return -1, false
	}
}

// cliSessionArgs are the command lines Chapter 28 documents for a session:
// the language server (The editor, D32) and the async API.
var cliSessionArgs = [][]string{{"--lsp", "--stdio"}, {"--api", "--async"}}

// cliSessionEnded checks a session that ended before it answered its first
// request. A documented command line must be answered (Chapter 28, The
// editor, D32). Any other one may be a command line the entry point
// rejects, which is an error: Chapter 28, Diagnostics, "vibelang exits
// non-zero when it reports any error", and the error is reported, so the
// process exits non-zero and says why on stderr.
func cliSessionEnded(g *Gaps, s *cliSession, kind, request string, args []string) {
	status, ended := s.wait()
	switch {
	case !ended:
		g.Add("hang:"+kind+"-exit", "the %s did not end after it stopped answering (vibelang %s)", kind, cliQuote(args))
	case slices.ContainsFunc(cliSessionArgs, func(documented []string) bool { return slices.Equal(documented, args) }):
		g.Add(kind+":no-reply", "the %s exited %d before it answered %s (vibelang %s):\n%s", kind, status, request, cliQuote(args), cliTail(s.stderr.String()))
	case status == 0 || strings.TrimSpace(s.stderr.String()) == "":
		g.Add(kind+":silent-exit", "the %s exited %d before it answered %s, without an error on stderr (vibelang %s):\n%s", kind, status, request, cliQuote(args), cliTail(s.stderr.String()))
	}
}

// cliCheckLSP runs a language server session (Chapter 28, The editor, D32).
func cliCheckLSP(g *Gaps, binary, dir string, args []string, project Project) {
	s, err := cliStartSession(binary, dir, args)
	if err != nil {
		g.Add("lsp:start", "%v", err)
		return
	}
	uri := "file://" + filepath.ToSlash(dir)
	main := cliMainFile(project)
	// A server that answered initialize answers each later request (the
	// Language Server Protocol; Chapter 28, The editor, D32).
	failed := func(stage string, reply map[string]any, why string) bool {
		if why == "exited" && stage == "initialize" {
			cliSessionEnded(g, s, "lsp", stage, args)
			return true
		}
		if why == "exited" {
			g.Add("lsp:exited", "the language server exited before it answered %s (vibelang %s):\n%s", stage, cliQuote(args), cliTail(s.stderr.String()))
			return true
		}
		if why == "hang" {
			g.Add("hang:lsp", "the language server did not answer %s within %v (vibelang %s)", stage, cliDeadline, cliQuote(args))
			return true
		}
		if reply["error"] != nil {
			g.Add("lsp:error", "the language server answered %s with an error %v (vibelang %s)", stage, reply["error"], cliQuote(args))
		}
		return false
	}
	reply, why := s.call(1, "initialize", map[string]any{"processId": nil, "rootUri": uri, "capabilities": map[string]any{}})
	s.log("initialize", reply, why)
	if !failed("initialize", reply, why) {
		_ = s.send(map[string]any{"jsonrpc": "2.0", "method": "initialized", "params": map[string]any{}})
		document := map[string]any{"uri": uri + "/" + main}
		_ = s.send(map[string]any{"jsonrpc": "2.0", "method": "textDocument/didOpen", "params": map[string]any{
			"textDocument": map[string]any{"uri": document["uri"], "languageId": "vibe", "version": 1, "text": project.Files[main]},
		}})
		reply, why = s.call(2, "textDocument/documentSymbol", map[string]any{"textDocument": document})
		s.log("textDocument/documentSymbol", reply, why)
		if !failed("textDocument/documentSymbol", reply, why) {
			reply, why = s.call(3, "shutdown", nil)
			if !failed("shutdown", reply, why) {
				_ = s.send(map[string]any{"jsonrpc": "2.0", "method": "exit"})
				status, ended := s.wait()
				// The Language Server Protocol: after shutdown, exit ends the
				// server with status 0.
				if !ended {
					g.Add("hang:lsp-exit", "the language server did not end after exit (vibelang %s)", cliQuote(args))
				} else if status != 0 {
					g.Add("lsp:status", "the language server exited %d after shutdown and exit (vibelang %s):\n%s", status, cliQuote(args), cliTail(s.stderr.String()))
				}
				return
			}
		}
	}
	if _, ended := s.wait(); !ended {
		g.Add("hang:lsp-exit", "the language server did not end when its input closed (vibelang %s)", cliQuote(args))
	}
	if stderr := s.stderr.String(); strings.Contains(stderr, "panic:") && strings.Contains(stderr, "\ngoroutine ") {
		g.Add("crash", "the language server panicked (vibelang %s):\n%s", cliQuote(args), cliTail(stderr))
	}
}

// cliCheckAPI runs an async API session: initialize, parseCommandLine, and
// the end of its input (Chapter 28, Packages and versions).
func cliCheckAPI(g *Gaps, binary, dir string, args []string) {
	s, err := cliStartSession(binary, dir, args)
	if err != nil {
		g.Add("api:start", "%v", err)
		return
	}
	for i, request := range []struct {
		method string
		params any
	}{{"initialize", nil}, {"parseCommandLine", map[string]any{"commandLine": []string{"-p", "tsconfig.json"}}}} {
		reply, why := s.call(i+1, request.method, request.params)
		s.log(request.method, reply, why)
		if why == "hang" {
			g.Add("hang:api", "the API did not answer %s within %v (vibelang %s)", request.method, cliDeadline, cliQuote(args))
			break
		}
		if why == "exited" && i == 0 {
			cliSessionEnded(g, s, "api", request.method, args)
			break
		}
		if why == "exited" {
			// An API that answered initialize answers each later request.
			g.Add("api:exited", "the API exited before it answered %s (vibelang %s):\n%s", request.method, cliQuote(args), cliTail(s.stderr.String()))
			break
		}
		if reply["error"] != nil {
			g.Add("api:error", "the API answered %s with an error %v (vibelang %s)", request.method, reply["error"], cliQuote(args))
		}
	}
	if _, ended := s.wait(); !ended {
		g.Add("hang:api-exit", "the API did not end when its input closed (vibelang %s)", cliQuote(args))
	}
	if stderr := s.stderr.String(); strings.Contains(stderr, "panic:") && strings.Contains(stderr, "\ngoroutine ") {
		g.Add("crash", "the API panicked (vibelang %s):\n%s", cliQuote(args), cliTail(stderr))
	}
}

// TestCommandLineFlagsCoverSpec reads every flag the specification shows for
// vibelang and checks that FuzzCommandLine's table writes it, so that a flag
// the specification adds fails here until the target fuzzes it. A flag-shaped
// code span is vibelang's when it follows `vibelang ` in a code span or a
// fenced command line, or is a span of its own; another tool's flag must be
// named in cliForeignFlags.
func TestCommandLineFlagsCoverSpec(t *testing.T) {
	spans := regexp.MustCompile("`([^`\n]+)`")
	command := regexp.MustCompile(`(?:^|\s)vibelang\s+(.*)$`)
	flag := regexp.MustCompile(`^--?[A-Za-z][\w-]*$`)
	found := map[string]string{}
	names, err := SpecGlob("*.md")
	if err != nil || len(names) == 0 {
		t.Fatalf("no specification chapters: %v", err)
	}
	for _, name := range names {
		text := SpecText(filepath.Base(name))
		var candidates []string
		for _, m := range spans.FindAllStringSubmatch(text, -1) {
			span := m[1]
			if strings.HasPrefix(span, "-") {
				candidates = append(candidates, strings.Fields(span)...)
			} else if c := command.FindStringSubmatch(span); c != nil {
				candidates = append(candidates, strings.Fields(c[1])...)
			}
		}
		for line := range strings.SplitSeq(text, "\n") {
			if !strings.Contains(line, "`") {
				if c := command.FindStringSubmatch(line); c != nil {
					candidates = append(candidates, strings.Fields(c[1])...)
				}
			}
		}
		for _, candidate := range candidates {
			if flag.MatchString(candidate) {
				found[candidate] = filepath.Base(name)
			}
		}
	}
	if len(found) < 8 {
		t.Fatalf("read only %d flags from the specification; the extraction is broken: %v", len(found), found)
	}
	table := map[string]bool{}
	for _, f := range cliFlags() {
		table[strings.ToLower(f.Name)] = true
	}
	for _, name := range slices.Sorted(maps.Keys(found)) {
		if cliForeignFlags[name] != "" {
			continue
		}
		if !table[strings.ToLower(name)] {
			t.Errorf("%s documents the flag %s, which FuzzCommandLine's table (cliFlags) does not write; add it, or name it in cliForeignFlags if it is another tool's", found[name], name)
		}
	}
	// The seeds' argument lists decode to themselves.
	for _, seed := range cliSeeds() {
		cliEncode(seed.args...)
	}
}
