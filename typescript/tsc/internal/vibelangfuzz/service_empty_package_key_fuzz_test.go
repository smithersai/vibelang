package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const emptyPackageKeyTarget = "FuzzServiceEmptyPackageKey"
const emptyPackageKeyQuote = "the `name` in the package's `package.json`, `/`, the file's package-relative path without its extension, `#`, the service name."
const emptyPackageNearestQuote = "The package is the file's Node package scope, the nearest ancestor directory with a `package.json`"
const emptyPackageFixPreservationQuote = "Diagnostics retain their existing codes, categories and eligibility; compiling a file does not apply a source rewrite."

func TestServiceEmptyPackageKeyQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", emptyPackageKeyQuote)
	chapterSays(t, "005-services.md", emptyPackageNearestQuote)
	chapterSays(t, "007-tooling.md", emptyPackageFixPreservationQuote)
}

func FuzzServiceEmptyPackageKey(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "005-services.md", emptyPackageKeyQuote)
	chapterSays(f, "005-services.md", emptyPackageNearestQuote)
	for _, key := range []string{"empty", "named", "scoped", "explicit", "empty-explicit", "nearest-empty", "nearest-named", "namespace", "whole-shape", "reference", "unicode", "multi-dot"} {
		f.Add(key, byte(0))
		f.Add(key, byte(3))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		prefix, path, name, body, context := "", "src/main.vibe", "Named", "readonly value: number", "export SERVICE"
		pkg := `{"name":"","type":"module"}`
		nested := ""
		explicit := false
		switch key {
		case "named":
			prefix, pkg = "app", `{"name":"app","type":"module"}`
		case "scoped":
			prefix, pkg = "@scope/app", `{"name":"@scope/app","type":"module"}`
		case "explicit":
			prefix, explicit = "chosen/key", true
		case "empty-explicit":
			explicit = true
		case "nearest-empty":
			pkg, nested = `{"name":"outer","type":"module"}`, `{"name":"","type":"module"}`
		case "nearest-named":
			prefix, nested = "inner", `{"name":"inner","type":"module"}`
		case "namespace":
			context = "export namespace Keys { export SERVICE }"
		case "whole-shape":
			body = ""
		case "reference":
			body = "static readonly defaultValue = () => ({value: 1}); readonly value: number"
		case "unicode":
			name = "Café"
		case "multi-dot":
			path = "src/deep/main.part.vibe"
		default:
			key = "empty"
		}
		if mode&1 != 0 {
			path = strings.TrimSuffix(path, ".vibe") + ".vibex"
		}
		declaration := "service " + name + " { " + body + " }"
		if key == "whole-shape" {
			declaration = "service " + name + ": number {}"
		}
		want := prefix + "/" + strings.TrimSuffix(path, filepath.Ext(path)) + "#" + name
		if nested != "" {
			want = prefix + "/" + strings.TrimPrefix(strings.TrimSuffix(path, filepath.Ext(path)), "src/") + "#" + name
		}
		if explicit {
			declaration = "service " + name + " { static readonly key = " + strconv.Quote(prefix) + "; readonly value: number }"
			want = prefix
		}
		source := strings.ReplaceAll(context, "SERVICE", declaration) + "\nexport {}\n"
		if mode&2 != 0 {
			source = "// retained 😀\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		files := map[string]string{path: source, "package.json": pkg}
		if nested != "" {
			files["src/package.json"] = nested
		}
		config := fmt.Sprintf(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"declaration":true,"outDir":"out","rootDir":".","jsx":"preserve","types":[]},"files":[%q]}`, path)
		result, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		if !toolsErrorFree(result) {
			Gap(t, emptyPackageKeyTarget, key, "unexpected diagnostics: %v", SortedKeys(Keys(result.Dir, result.Diagnostics)))
			return
		}
		out := "out/" + strings.TrimSuffix(path, filepath.Ext(path)) + ".d.ts"
		// The native Context.Service key is a literal parameter of ServiceClass.
		// Reference output may erase the key parameter, so inspect its emitted constructor.
		emitted := result.Outputs[out]
		if key == "reference" {
			extension := ".js"
			if strings.HasSuffix(path, ".vibex") {
				extension = ".jsx"
			}
			emitted = result.Outputs["out/"+strings.TrimSuffix(path, filepath.Ext(path))+extension]
		}
		if !containsServicePackageKey(emitted, want) {
			Gap(t, emptyPackageKeyTarget, key, "%s; want literal %q in %s:\n%s", emptyPackageKeyQuote, want, out, emitted)
			return
		}
		mapperContext := vibelangmapper.FileContextOf(filepath.ToSlash(filepath.Join(result.Dir, path)))
		projected := vibelangmapper.Project(source, mapperContext)
		if !containsServicePackageKey(projected.Text, want) {
			Gap(t, emptyPackageKeyTarget, key, "mapper must preserve the same native key %q, module context %q:\n%s", want, mapperContext.ModuleKey, projected.Text)
			return
		}
		ExpectPending(t, emptyPackageKeyTarget, specCorpusKey(t))
	})
}

var servicePackageKeyStrings = regexp.MustCompile(`"(?:\\.|[^"\\])*"`)

func containsServicePackageKey(source, want string) bool {
	for _, token := range servicePackageKeyStrings.FindAllString(source, -1) {
		var value string
		if json.Unmarshal([]byte(token), &value) == nil && value == want {
			return true
		}
	}
	return false
}
