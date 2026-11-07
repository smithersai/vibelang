package vibelangfuzz

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

const emptyPackageKeyTarget = "FuzzServiceEmptyPackageKey"
const emptyPackageKeyQuote = "the `name` in the package's `package.json`, `/`, the file's package-relative path without its extension, `#`, the service name."
const emptyPackageNearestQuote = "The package is the file's Node package scope, the nearest ancestor directory with a `package.json`"
const emptyPackageFixPointQuote = "One `vibelang --fix` run applies fixes until none applies; running it again changes nothing."
const emptyPackageFixPreservationQuote = "A rewrite that can't preserve types, behavior and declaration output refuses at that site."
const emptyPackageWritableQuote = "This opt-in modifier leaves writable shapes writable and does not select former readonly defaults."

func TestServiceEmptyPackageKeyQuoted(t *testing.T) {
	chapterSays(t, "005-services.md", emptyPackageKeyQuote)
	chapterSays(t, "005-services.md", emptyPackageNearestQuote)
	chapterSays(t, "007-tooling.md", emptyPackageFixPointQuote)
	chapterSays(t, "007-tooling.md", emptyPackageFixPreservationQuote)
	chapterSays(t, "007-tooling.md", emptyPackageWritableQuote)
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

func FuzzServiceEmptyPackageKeyMigration(f *testing.F) {
	startShortBudget(f)
	chapterSays(f, "007-tooling.md", emptyPackageFixPointQuote)
	chapterSays(f, "007-tooling.md", emptyPackageFixPreservationQuote)
	chapterSays(f, "007-tooling.md", emptyPackageWritableQuote)
	chapterSays(f, "005-services.md", emptyPackageKeyQuote)
	for _, key := range []string{"body", "writable", "whole-shape", "reference", "namespace", "modern-control", "explicit-control"} {
		f.Add(key, byte(0))
		f.Add(key, byte(1))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mode byte) {
		declaration := "service Named { readonly value: number }"
		switch key {
		case "writable":
			declaration = "service Named { value: number }"
		case "whole-shape":
			declaration = "service Named: number {}"
		case "reference":
			declaration = "service Named: number { static readonly defaultValue = () => 1 }"
		case "namespace":
			declaration = "namespace Keys { export " + declaration + " }"
		case "modern-control":
		case "explicit-control":
			declaration = `service Named { static readonly key = "explicit"; readonly value: number }`
		default:
			key = "body"
		}
		source := declaration + "\nexport {}\n"
		if key == "writable" {
			source += "export function update(value: Named.Shape) { value.value = 2 }\n"
		}
		if mode&1 != 0 {
			source = "// preserve 😀\r\n" + strings.ReplaceAll(source, "\n", "\r\n")
		}
		before := toolsCompile(t, w, emptyPackageKeyTarget, map[string]string{"main.vibe": source, "package.json": `{"name":"","type":"module"}`})
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		if config == nil || len(config.Errors) != 0 {
			t.Fatal("invalid migration config")
		}
		options := vibelang.FixOptions{}
		var remainingFlags []string
		if key != "modern-control" {
			remainingFlags, options = vibelang.FixOptionsArguments([]string{"--fix-legacy-service-keys"})
		}
		var progress strings.Builder
		options.Progress = &progress
		options.ProgressEvery = time.Nanosecond
		migrated := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, options)
		if migrated.Err != nil || len(migrated.Refused) != 0 {
			Gap(t, "FuzzServiceEmptyPackageKeyMigration", key, "migration refused: %+v", migrated)
			return
		}
		fixed := migrated.Files[tspath.RootedFilePath(filepath.ToSlash(before.Dir)+"/main.vibe")]
		if strings.HasSuffix(key, "control") {
			if fixed != nil {
				Gap(t, "FuzzServiceEmptyPackageKeyMigration", key, "control changed: %s", fixed.Text)
			}
			return
		}
		oldKey := filepath.Base(before.Dir) + "/main#Named"
		if fixed == nil || !strings.Contains(fixed.Text, "static readonly key = "+strconv.Quote(oldKey)) {
			Gap(t, "FuzzServiceEmptyPackageKeyMigration", key, "historical key %q not made explicit; directory=%q context=%v remaining-flags=%q changed=%v result-error=%v refusals=%v progress=%s", oldKey, before.Dir, t.Context().Err(), remainingFlags, migrated.Order, migrated.Err, migrated.Refused, progress.String())
			return
		}
		after := toolsCompile(t, w, emptyPackageKeyTarget, map[string]string{"main.vibe": fixed.Text, "package.json": `{"name":"","type":"module"}`})
		defer after.Remove()
		if !toolsErrorFree(after) {
			Gap(t, "FuzzServiceEmptyPackageKeyMigration", key, "fixed source errors: %v", SortedKeys(Keys(after.Dir, after.Diagnostics)))
		}
		ExpectPending(t, "FuzzServiceEmptyPackageKeyMigration", specCorpusKey(t))
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
