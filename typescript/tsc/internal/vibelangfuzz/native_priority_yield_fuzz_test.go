package vibelangfuzz

import (
	"fmt"
	"maps"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

var priorityYieldKeys = []string{"literal", "undefined", "optional", "comments", "callee-comments", "parenthesized", "multiple", "untried", "shadow", "import", "disabled"}

func priorityYieldMigrationQuoted(t testing.TB) {
	t.Helper()
	for _, quote := range []string{
		"One `vibelang --fix` run applies fixes until none applies; running it again changes nothing.",
	} {
		if !strings.Contains(SpecText("007-tooling.md"), quote) {
			t.Fatalf("Chapter7 no longer says %q", quote)
		}
	}
	if !strings.Contains(SpecText("005-services.md"), "The non-function value exports are globals too") {
		t.Fatal("native Effect value rule moved")
	}
}

func TestPriorityYieldMigrationQuoted(t *testing.T) { priorityYieldMigrationQuoted(t) }

// A static codemod oracle: priority calls must migrate, preserve argument
// evaluation count and comments, typecheck, and converge; local/imported bindings
// and disabled globals retain their ordinary meaning. Runtime constructs remain
// in FuzzVIPDifferential rather than a second runtime comparison.
func FuzzPriorityYieldMigration(f *testing.F) {
	startShortBudget(f)
	priorityYieldMigrationQuoted(f)
	for _, key := range priorityYieldKeys {
		for mode := 0; mode < 3; mode++ {
			f.Add([]byte(fmt.Sprintf("%s@%d", key, mode)))
		}
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, modeText, _ := strings.Cut(string(data), "@")
		if !slices.Contains(priorityYieldKeys, key) {
			key = priorityYieldKeys[0]
			if len(data) > 0 {
				key = priorityYieldKeys[int(data[0])%len(priorityYieldKeys)]
			}
		}
		mode := 0
		if len(modeText) > 0 {
			mode = int(modeText[0]) % 3
		}
		options := vibelang.FixOptions{VIPOnly: mode == 1, MigrationOnly: mode == 2}
		n := len(data)%17 - 8
		arg := fmt.Sprint(n)
		header := ""
		parameters := ""
		callee := "yieldNow"
		expression := "try " + callee + "(" + arg + ")"
		unchanged := false
		config := DefaultConfig
		switch key {
		case "undefined":
			arg = "undefined"
		case "optional":
			arg = "priority"
			parameters = "priority?: number"
		case "comments":
			arg = "/* priority before */ " + arg + " /* priority after */,"
		case "callee-comments":
			callee = "/* before callee */ (/* inside callee */ yieldNow)"
		case "parenthesized":
			callee = "((yieldNow))"
		case "untried":
		case "multiple":
		case "shadow":
			header = "const yieldNow = (priority: number): number => priority;\n"
			unchanged = true
		case "import":
			header = "import { yieldNow } from \"effect/Effect\";\n"
			unchanged = true
		case "disabled":
			config = strings.TrimSuffix(config, "\n}") + ",\n\"vibe\":{\"effectGlobals\":false}\n}"
			unchanged = true
		}
		expression = "try " + callee + "(" + arg + ")"
		if key == "untried" || key == "shadow" {
			expression = callee + "(" + arg + ")"
		}
		if key == "multiple" {
			expression += "; try yieldNow(" + fmt.Sprint(n+1) + ")"
		}
		source := header + "export effect function main(" + parameters + ") { " + expression + " }\n"
		files := map[string]string{"main.vibe": source, "package.json": `{"name":"priority-yield","type":"module"}`}
		before, err := w.Compile(t.Context(), Project{Files: files, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), options)
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if result.Err != nil {
			Gap(t, "FuzzPriorityYieldMigration", key+":converge", "%v", result.Err)
		}
		if unchanged {
			if fixed["main.vibe"] != source {
				Gap(t, "FuzzPriorityYieldMigration", key+":binding", "changed an ordinary binding:\n%s", fixed["main.vibe"])
			}
			return
		}
		if fixed["main.vibe"] == source || !strings.Contains(fixed["main.vibe"], "yieldNowWith") {
			Gap(t, "FuzzPriorityYieldMigration", key+":missing", "priority needs a preserving migration; refused=%+v\n%s", result.Refused, source)
			return
		}
		for _, comment := range []string{"/* before callee */", "/* inside callee */", "/* priority before */", "/* priority after */"} {
			if strings.Count(source, comment) != strings.Count(fixed["main.vibe"], comment) {
				Gap(t, "FuzzPriorityYieldMigration", key+":comment-count", "comment duplicated or lost: %s", comment)
			}
		}
		if lost := toolsLostComments(source, fixed["main.vibe"]); len(lost) > 0 {
			Gap(t, "FuzzPriorityYieldMigration", key+":comments", "lost %q", lost)
		}
		after, err := w.Compile(t.Context(), Project{Files: fixed, Config: config})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if errors := legacyErrors(after); len(errors) > 0 {
			Gap(t, "FuzzPriorityYieldMigration", key+":types", "fixed source rejected: %v\n%s", errors, fixed["main.vibe"])
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), options)
		if again.Err != nil || len(again.Files) > 0 {
			Gap(t, "FuzzPriorityYieldMigration", key+":fixed-point", "second run changes source: err=%v files=%+v", again.Err, again.Files)
		}
	})
}
