package vibelang

import (
	"fmt"
	"regexp"
	"slices"
	"sort"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
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
