package vibelangfuzz

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/wrapvfs"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const relicMigrationTarget = "FuzzRelicControlMigration"
const relicMigrationQuote = "Compiled code gives the same `Exit` as that Effect TypeScript, with finalizers in the same order (VIP-31)."
const relicBindingQuote = "A local declaration or import shadows one, as with any global, so a local `fiber` or `TypeId` silently replaces Effect's."

const relicServiceKeyQuote = "has no derived key: omitting `static readonly key` there is a compile error"

func TestRelicControlMigrationQuoted(t *testing.T) { relicMigrationQuoted(t) }
func relicMigrationQuoted(t testing.TB) {
	chapter, err := os.ReadFile(SpecPath("000-intro.md"))
	if err != nil {
		t.Fatal(err)
	}
	services, err := os.ReadFile(SpecPath("005-services.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range []string{relicMigrationQuote, relicBindingQuote, relicServiceKeyQuote} {
		if !strings.Contains(string(chapter)+string(services), quote) {
			t.Fatalf("stale migration oracle: %q", quote)
		}
	}
}

// This target checks static migration admission/refusal and native bindings.
// It adds no runtime differential generator; semantic Effect constructs belong
// in FuzzVIPDifferential. The CLI regression separately proves the migration's
// public declaration bytes and Exit against the saved original and stock TS.
func FuzzRelicControlMigration(f *testing.F) {
	startShortBudget(f)
	relicMigrationQuoted(f)
	keys := []string{"safe", "safe-unnamed", "safe-named", "control", "handle", "resume", "abandon", "select", "native-control", "native-handle", "native-resume", "native-abandon", "native-select", "safe-boolean", "safe-multi", "safe-string", "safe-zero", "runtime-computed", "native-computed", "runtime-key", "native-key", "export-alias", "direct-eval", "bare-resume", "safe-parens", "shorthand", "prototype-op", "rest-binding", "default-binding"}
	for _, key := range keys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key := string(data)
		known := false
		for _, k := range keys {
			if key == k {
				known = true
			}
		}
		if !known {
			if len(data) == 0 {
				return
			}
			key = keys[int(data[0])%len(keys)]
		}
		n := 4
		if len(data) > len(key) {
			n = int(data[len(data)-1])
		}
		source := fmt.Sprintf("control Ask { ask(x: number): number!! }\nexport effect function probe() { try { return try Ask.ask(%d) } handle Ask.ask(x) { return try resume(x + 2) } }\n", n)
		switch key {
		case "runtime-key":
			source = `import * as Old from "vibelang-runtime"; const key="resume" as const; export const legacy=Old[key]`
		case "native-key":
			source = `const object={resume(n: number){return n}}; const key="resume" as const; export const value=object[key](1)`
		case "runtime-computed":
			source = `import * as Old from "vibelang-runtime"; export const legacy = Old["resume"]`
		case "native-computed":
			source = `const object = {handle(n: number){return n}, resume(n: number){return n}, abandon(n: number){return n}}; export const values=[object["handle"](1),object["resume"](1),object["abandon"](1)]`
		case "safe-zero":
			source = `control Ask {ask(): number!!} export effect function probe(){try {return try Ask.ask()} handle Ask.ask(){return try resume(6)}}`
		case "safe-boolean":
			source = `control Ask {ask(x: string): boolean!!} export effect function probe(){try {return try Ask.ask("deploy")} handle Ask.ask(x){return try resume(true)}}`
		case "safe-multi":
			source = `control Ask {ask(x: number, y: number): number!!} export effect function probe(){try {return try Ask.ask(4,2)} handle Ask.ask(x,y){return try resume(x+y)}}`
		case "safe-string":
			source = `control Ask {ask(x: string): string!!} export effect function probe(){try {return try Ask.ask("request")} handle Ask.ask(x){return try resume(x)}}`

		case "rest-binding":
			source = "control Ask {ask(x: number): string!!} export effect function probe(){try {return try Ask.ask(4)} handle Ask.ask(...x){return try resume(\"\"+x)}}"
		case "default-binding":
			source = strings.Replace(source, "handle Ask.ask(x)", "handle Ask.ask(x = 4)", 1)

		case "prototype-op":
			source = strings.ReplaceAll(source, "ask", "__proto__")
		case "shorthand":
			source += "\nconst observed = { Ask }; export const observe = () => Object.keys(observed.Ask)"
		case "export-alias":
			source += "\nexport { Ask as default }"
		case "direct-eval":
			source += "\nexport const observe = () => eval(\"Ask\")"
		case "bare-resume":
			source = strings.Replace(source, "return try resume(x + 2)", "return resume(x + 2)", 1)
		case "safe-parens":
			source = strings.Replace(source, fmt.Sprintf("try Ask.ask(%d)", n), fmt.Sprintf("try (Ask.ask(%d))", n), 1)
			source = strings.Replace(source, "try resume(x + 2)", "try (resume(x + 2))", 1)

		case "control":
			source = "export " + source
		case "handle":
			source = strings.Replace(source, "return try resume(x + 2)", "const result = try resume(x + 2); return result + 1", 1)
		case "resume":
			source = strings.Replace(source, "return try resume(x + 2)", "try resume(x); try resume(x)", 1)
		case "abandon":
			source = strings.Replace(source, "return try resume(x + 2)", "return try abandon()", 1)
		case "select":
			source = "export effect function probe() { select { default: return 1 } }\n"
		}
		if strings.HasPrefix(key, "native-") && key != "native-computed" && key != "native-key" {
			name := strings.TrimPrefix(key, "native-")
			source = "export function probe(" + name + ": (n: number) => number) { return " + name + "(1) }\nexport const obj = { " + name + "(n: number) { return n } }\n"
		}
		files := map[string]string{"main.vibe": source}
		if key == "safe-unnamed" {
			files["package.json"] = "{\"type\":\"module\"}"
		} else if key == "safe-named" {
			files["package.json"] = "{\"name\":\"@vibelang/relic-keys\",\"type\":\"module\"}"
		}
		before := toolsCompile(t, w, relicMigrationTarget, files)
		defer before.Remove()
		config := toolsConfig(w, before.Dir)
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
		if result.Err != nil {
			Gap(t, relicMigrationTarget, "converge:"+key, "%v", result.Err)
			return
		}
		fixed := source
		for name, file := range result.Files {
			if strings.HasSuffix(name.AsString(), "/main.vibe") {
				fixed = file.Text
			}
		}

		// The full VIP fixer may repair this initially ill-typed call before
		// proposing the service migration. A direct migration must refuse it
		// (covered by TestRelicControlRefusesContinuationAndABI). If another
		// repair inserts try first, require the same final source as fixing
		// that explicitly corrected supported program.
		if key == "bare-resume" {
			if strings.Contains(fixed, "control Ask") {
				if len(result.Refused) == 0 {
					Gap(t, relicMigrationTarget, "refusal:"+key, "untried tail resume has no refusal; fixed=%s", fixed)
				}
				return
			}
			corrected := strings.Replace(source, "return resume(", "return try resume(", 1)
			// Keep the corrected input in the SAME module/package scope. A
			// different temporary directory correctly has a different legacy key.
			path := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(before.Dir, "main.vibe")))
			overlay := wrapvfs.Wrap(w.fs, wrapvfs.Replacements{ReadFile: func(name tspath.RootedFilePath) (string, bool) {
				if name == path {
					return corrected, true
				}
				return w.fs.ReadFile(name)
			}})
			repaired := vibelang.FixProjectWithOptions(t.Context(), overlay, bundled.LibPath(), config, vibelang.FixOptions{VIPOnly: true})
			if repaired.Err != nil {
				t.Fatal(repaired.Err)
			}
			want := corrected
			for name, file := range repaired.Files {
				if strings.HasSuffix(name.AsString(), "/main.vibe") {
					want = file.Text
				}
			}
			if fixed != want || !strings.Contains(fixed, "service Ask") || !strings.Contains(fixed, "provide Ask") || strings.Contains(fixed, "resume(") {
				Gap(t, relicMigrationTarget, "repair:"+key, "VIP repair differs from explicitly corrected supported source:\nfixed=%s\nwant=%s", fixed, want)
			}
			return
		}

		if strings.HasPrefix(key, "safe") {
			if key == "safe-unnamed" && !strings.Contains(fixed, "static readonly key =") {
				Gap(t, relicMigrationTarget, "key:"+key, "migration without a derived key lost its explicit legacy key: %s", fixed)
			}
			if !strings.Contains(fixed, "service Ask") || !strings.Contains(fixed, "provide Ask") || strings.Contains(fixed, "resume(") {
				Gap(t, relicMigrationTarget, "admit:"+key, "local service migration missing:\n%s", fixed)
			}
		} else if !strings.HasPrefix(key, "native-") && len(result.Refused) == 0 {
			Gap(t, relicMigrationTarget, "refusal:"+key, "unsupported continuation has no explicit refusal")
		} else if fixed != source {
			Gap(t, relicMigrationTarget, "refuse:"+key, "unsupported continuation or native binding changed:\n%s", fixed)
		}
	})
}
