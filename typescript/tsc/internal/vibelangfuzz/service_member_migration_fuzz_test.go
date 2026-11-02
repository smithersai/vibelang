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

var serviceMemberMigrationKeys = []string{"effect-try", "effect-held", "plain", "plain-try", "multiline-group", "line-comment-group", "paren", "optional", "native-key", "unknown-return", "generic-return", "value-try", "value-run", "value-chain", "value-args", "value-native", "value-member", "file-tree-named-key", "file-tree-namespace-key", "file-tree-plain-path"}

func TestServiceMemberMigrationQuoted(t *testing.T) {
	serviceLookupQuoted(t)
	const quote = "`vibelang --fix` rewrites `S.m(args)` to `(try S).m(args)`."
	if !strings.Contains(SpecText("../vips/0010-service-call-shorthand-denied.md"), quote) {
		t.Fatalf("VIP10 no longer says %q", quote)
	}
}

// Mutation coverage checks the static codemod contract: binding boundaries,
// single argument sites, comments, typechecking and convergence. Finite phase
// regressions measure calls/runs; language runtime generation stays in VIPDifferential.
func FuzzServiceMemberMigration(f *testing.F) {
	startShortBudget(f)
	serviceLookupQuoted(f)
	for _, key := range serviceMemberMigrationKeys {
		f.Add([]byte(key))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, data []byte) {
		key, variant, _ := strings.Cut(string(data), "\x00")
		if !slices.Contains(serviceMemberMigrationKeys, key) {
			key = serviceMemberMigrationKeys[0]
			if len(data) > 0 {
				key = serviceMemberMigrationKeys[int(data[0])%len(serviceMemberMigrationKeys)]
			}
		}
		n := len(variant) % 31
		body := "return try Users.find(arg())"
		unchanged := false
		members := "find(n:number):number!!; value():number; name():string"
		switch key {
		case "effect-held":
			body = "return Users.find(arg())"
		case "plain":
			body = "return Users.value()"
		case "plain-try":
			body = "return try Users.value()"
		case "multiline-group":
			body = "return try (\nUsers.value()\n)"
		case "line-comment-group":
			body = "return try (// receiver note\nUsers.value())"
		case "paren":
			body = "return try (Users.value())"
		case "optional":
			body = "return Users.find?.(arg())"
			unchanged = true
		case "native-key":
			body = "return Users.key"
			unchanged = true
		case "unknown-return":
			members = "read():unknown"
			body = "return try Users.read()"
			unchanged = true
		case "value-try", "value-run", "value-chain", "value-args", "value-native", "value-member":
			members = "readonly read:number!!; readonly name:number!!"
			switch key {
			case "value-try":
				body = "return try Users.read()"
			case "value-run":
				body = "return Users.read()"
			case "value-chain":
				body = "return (Users.read()).toFixed()"
			case "value-args":
				body, unchanged = "return try Users.read(arg())", true
			case "value-native":
				body, unchanged = "return Users.name()", true
			case "value-member":
				body, unchanged = "return Users.read", true
			}
		case "generic-return":
			members = "read<T>(n:T):T"
			body = "return try Users.read(arg())"
			unchanged = true
		}
		source := fmt.Sprintf("interface Shape{%s}\nservice Users:Shape{static readonly key=\"migration/users\"}\nfunction arg(){return %d}\nexport effect function f(){%s}\n", members, n, body)
		lookupWant := "(try Users)"
		switch key {
		case "file-tree-named-key", "file-tree-namespace-key":
			imp, lookup := "import {FileSystem} from \"effect/FileSystem\"", "(try FileSystem)"
			if key == "file-tree-namespace-key" {
				imp, lookup = "import * as FileSystem from \"effect/FileSystem\"", "(try FileSystem.FileSystem)"
			}
			source = fmt.Sprintf("%s\nexport effect function f(){return try FileSystem.readDirectory(\"root-%d\")}\n", imp, n)
			lookupWant = lookup
		case "file-tree-plain-path":
			source = fmt.Sprintf("import {Path} from \"effect/Path\"\nexport effect function f(){return try Path.join(\"root\",\"file-%d\")}\n", n)
			lookupWant = "(try Path)"
		}
		files := map[string]string{"main.vibe": source, "package.json": servicesPackage}
		before, err := w.Compile(t.Context(), Project{Files: files})
		if err != nil {
			t.Fatal(err)
		}
		defer before.Remove()
		result := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, before.Dir), vibelang.FixOptions{MigrationOnly: true})
		fixed := maps.Clone(files)
		for name, file := range result.Files {
			fixed[strings.TrimPrefix(name.AsString(), filepath.ToSlash(before.Dir)+"/")] = file.Text
		}
		if result.Err != nil {
			Gap(t, "FuzzServiceMemberMigration", key+":converge", "%v", result.Err)
			return
		}
		if unchanged {
			if fixed["main.vibe"] != source {
				Gap(t, "FuzzServiceMemberMigration", key+":boundary", "changed a non-migration binding or uncertain call:\n%s", fixed["main.vibe"])
			}
			return
		}
		if fixed["main.vibe"] == source || !strings.Contains(fixed["main.vibe"], lookupWant) {
			Gap(t, "FuzzServiceMemberMigration", key+":missing", "refused=%+v\n%s", result.Refused, source)
			return
		}
		if strings.Count(source, "arg()") != strings.Count(fixed["main.vibe"], "arg()") || len(toolsLostComments(source, fixed["main.vibe"])) > 0 {
			Gap(t, "FuzzServiceMemberMigration", key+":source", "evaluation/comment sites changed:\n%s", fixed["main.vibe"])
		}
		after, err := w.Compile(t.Context(), Project{Files: fixed})
		if err != nil {
			t.Fatal(err)
		}
		defer after.Remove()
		if errs := legacyErrors(after); len(errs) > 0 {
			Gap(t, "FuzzServiceMemberMigration", key+":types", "%v\n%s", errs, fixed["main.vibe"])
		}
		again := vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), toolsConfig(w, after.Dir), vibelang.FixOptions{MigrationOnly: true})
		if again.Err != nil || len(again.Files) > 0 {
			Gap(t, "FuzzServiceMemberMigration", key+":fixed-point", "%+v", again)
		}
	})
}
