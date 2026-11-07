package vibelang

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/diagnostics"
	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// adviceTypingPending names the advice examples whose repair is in the merge
// queue but not landed. A row here must still fail; drop its line once the
// repair lands, or the test reports it as passing unexpectedly.
var adviceTypingPending = map[string]string{}

// adviceFreeNames are the placeholders the examples use for a caller's values.
var adviceFreeNames = []string{
	"a", "app", "args", "atime", "b", "blob", "bytes", "ciphertext", "command", "data", "directory", "element",
	"body", "headers", "request", "response", "signal", "startNanos",
	"fiber", "from", "gid", "items", "key", "killSignal", "max", "message", "min", "mode", "mtime", "name",
	"nonce", "onResize", "options", "parts", "path", "pattern", "pid", "plaintext", "port", "privateKey",
	"program", "publicKey", "query", "rows", "signature", "size", "spawn", "target", "text", "to", "uid", "url",
	"value", "values",
}

var (
	adviceReceiver = regexp.MustCompile(`(?:^|[^.\w"/])([A-Z]\w*)\.`)
	adviceTry      = regexp.MustCompile(`(^|[^.\w])try\s+`)
	adviceGlobal   = regexp.MustCompile(`(^|[^.\w])([a-z]\w*)\(`)
	adviceImport   = regexp.MustCompile(`import \{ ([^}]*) \} from ("[^"]+")|import \* as (\w+) from ("[^"]+")`)
)

// adviceCounterpart writes the Effect TypeScript twin of a VibeLang advice
// example: try e becomes yield* e inside Effect.gen, fork effect { s } becomes
// yield* Effect.forkChild(Effect.gen(function* () { s })), bare Effect globals
// get their Effect. prefix, and each namespace the example names is imported
// from the module the prelude or the service's import gives it.
func adviceCounterpart(example, imports string) (string, error) {
	named := map[string]string{} // namespace -> import line
	for _, m := range adviceImport.FindAllStringSubmatch(imports, -1) {
		if m[3] != "" {
			named[m[3]] = "import * as " + m[3] + " from " + m[4]
			continue
		}
		for _, name := range strings.Split(m[1], ",") {
			name = strings.TrimSpace(name)
			if name != "" {
				named[name] = "import { " + name + " } from " + m[2]
			}
		}
	}
	var lines []string
	seen := map[string]bool{}
	for _, m := range adviceReceiver.FindAllStringSubmatch(example, -1) {
		name := m[1]
		if seen[name] {
			continue
		}
		seen[name] = true
		switch {
		case named[name] != "":
			lines = append(lines, named[name])
		case name == "Effect":
		case name == "Experimental":
			lines = append(lines, `import * as Experimental from "vibelang-runtime/experimental"`)
		case preludeModules[name] != "":
			lines = append(lines, "import * as "+name+" from \"effect/"+name+"\"")
		case effectRootNames[name].module != "":
			lines = append(lines, "import * as "+name+" from \""+effectRootNames[name].module+"\"")
		case effectSubpathNames[name].module != "":
			lines = append(lines, "import * as "+name+" from \""+effectSubpathNames[name].module+"\"")
		case isECMAScriptGlobalName(name):
		default:
			return "", fmt.Errorf("%s names %s, which no prelude table or import declares", example, name)
		}
	}
	body := example
	if block, ok := strings.CutPrefix(body, "fork effect {"); ok {
		if statements, ok := strings.CutSuffix(block, "}"); ok {
			body = "yield* Effect.forkChild(Effect.gen(function* () {" + statements + "}))"
		}
	}
	body = adviceTry.ReplaceAllString(body, "${1}yield* ")
	body = adviceGlobal.ReplaceAllStringFunc(body, func(call string) string {
		m := adviceGlobal.FindStringSubmatch(call)
		if effectglobals.Names[m[2]] && !slices.Contains(adviceFreeNames, m[2]) {
			return m[1] + "Effect." + m[2] + "("
		}
		return call
	})
	sort.Strings(lines)
	declared := make([]string, len(adviceFreeNames))
	for i, name := range adviceFreeNames {
		declared[i] = "declare const " + name + ": any"
	}
	declared = append(declared, "declare const address: string")
	if named["Effect"] == "" {
		lines = append([]string{"import * as Effect from \"effect/Effect\""}, lines...)
	}
	return strings.Join(lines, "\n") + "\n" + strings.Join(declared, "\n") +
		"\nexport const checked = Effect.gen(function* () {\n  const result = " + body + "\n  return result\n})\n", nil
}

// isECMAScriptGlobalName reports the receivers the examples use that are
// ECMAScript or web data utilities the platform rule allows.
func isECMAScriptGlobalName(name string) bool {
	switch name {
	case "Number", "String", "JSON", "Math", "Date", "URL", "TextEncoder", "TextDecoder", "Promise", "Object", "Array":
		return true
	}
	return false
}

// Chapter 005: "Platform access is only through injected Effect services",
// and "There is no `Path.join(…)` shorthand for a service member; write
// `(try Path.Path).join(…)`". Every example a platform diagnostic gives must
// therefore typecheck as the Effect TypeScript it stands for, against the
// pinned declarations. The transitional compiler still accepts the D311
// shorthand, so the check runs on the TypeScript twin, where a namespace
// member that does not exist is TS2339 and a value called as a function is
// TS2349.
func TestPlatformAdviceExamplesTypecheck(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	type row struct{ where, example, imports string }
	var rows []row
	for name, s := range platformServices {
		// An example that is a declaration (import, export) is not an expression to run.
		if s.example != "" && !strings.HasPrefix(s.example, "import ") && !strings.HasPrefix(s.example, "export ") {
			rows = append(rows, row{"platformServices[" + name + "]", s.example, s.imports})
		}
	}
	for api, entry := range platformAPIs {
		if s := platformServices[entry.service]; s != nil && entry.example != "" {
			rows = append(rows, row{"platformAPIs[" + api + "]", entry.example, s.imports})
		}
	}
	for read, entry := range clockReads {
		// A clock read's use leads with the replacement expression; prose follows ": " or ", which".
		example := entry.use
		for _, stop := range []string{": ", ", which"} {
			if i := strings.Index(example, stop); i >= 0 {
				example = example[:i]
			}
		}
		imports := ""
		if s := platformServices[entry.service]; s != nil {
			imports = s.imports
		}
		rows = append(rows, row{"clockReads[" + read + "]", example, imports})
	}
	// Check the displayed introduction examples too. Some intentionally differ
	// from diagnostic shorthand (bytes, inherited stdio and elapsed clocks);
	// exact table comparisons alone cannot prove their APIs still exist.
	docRows, problems := platformIntroductionRows(platformIntroductionPage(t))
	for _, problem := range problems {
		t.Error(problem)
	}
	for _, doc := range docRows {
		example, _, ok := platformDocCode(doc.effect)
		if !ok {
			t.Errorf("%s: replacement is not inline code", doc.call)
			continue
		}
		rows = append(rows, row{"platform introduction " + doc.call, example, ""})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].where < rows[j].where })
	fixture := t.TempDir()
	for name, text := range map[string]string{
		"package.json":  `{"name":"advice","type":"module","dependencies":{"@effect/platform-browser":"*"}}`,
		"tsconfig.json": `{"compilerOptions":{"target":"ES2022","lib":["ESNext","DOM"],"module":"NodeNext","moduleResolution":"NodeNext","strict":true,"types":[],"skipLibCheck":true,"noEmit":true},"include":["*.ts"]}`,
	} {
		if err := os.WriteFile(filepath.Join(fixture, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	dir := copyCompilerFixture(t, fixture, root)
	for i, r := range rows {
		source, err := adviceCounterpart(r.example, r.imports)
		if err != nil {
			t.Errorf("%s: %v", r.where, err)
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, fmt.Sprintf("advice%d.ts", i)), []byte(source), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	fs := bundled.WrapFS(osvfs.FS())
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	program := fixProgram(fs, bundled.LibPath(), config, &fixParsedFiles{}, map[tspath.RootedFilePath]string{})
	failed := map[int][]string{}
	for _, d := range commandLineDiagnostics(t, nil, program) {
		if d.Category() != diagnostics.CategoryError || d.File() == nil {
			continue
		}
		var i int
		if _, err := fmt.Sscanf(filepath.Base(d.File().FileName().AsString()), "advice%d.ts", &i); err != nil {
			t.Errorf("outside the examples: %s", d.String())
			continue
		}
		failed[i] = append(failed[i], d.String())
	}
	for i, r := range rows {
		reason, pending := adviceTypingPending[r.where]
		switch {
		case len(failed[i]) != 0 && !pending:
			t.Errorf("%s: %s does not typecheck as Effect TypeScript:\n  %s", r.where, r.example, strings.Join(failed[i], "\n  "))
		case len(failed[i]) == 0 && pending:
			t.Errorf("%s typechecks now; drop it from adviceTypingPending (%s)", r.where, reason)
		}
	}
}
