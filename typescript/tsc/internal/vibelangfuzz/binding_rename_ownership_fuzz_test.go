package vibelangfuzz

import (
	"fmt"
	"slices"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vibelang"
)

const bindingRenameMigrationQuote = "Every breaking change ships a `vibelang --fix` codemod, so code that compiled under the previous release migrates mechanically."

func TestBindingRenameOwnershipQuoted(t *testing.T) {
	text := SpecText("007-tooling.md")
	for _, quote := range []string{bindingRenameMigrationQuote, "The rewrite preserves runtime behavior."} {
		if !strings.Contains(text, quote) {
			t.Fatalf("chapter 007 no longer says %q", quote)
		}
	}
}

// This editor/codemod oracle checks which source references a rename edits,
// not a second runtime/Exit model. The templates explicitly distinguish the
// old positive branch's binding from the parameter/local used on failure.
// RC-7: current duplicate-symbol resolution alone cannot tell them apart.
func FuzzBindingRenameOwnership(f *testing.F) {
	startShortBudget(f)
	keys := []string{"parameter", "local", "closure", "else"}
	for _, key := range keys {
		f.Add(key, uint8(0))
	}
	w := NewWorkspace(f)
	f.Fuzz(func(t *testing.T, key string, mutation uint8) {
		index := slices.Index(keys, key)
		if index < 0 {
			if key == "" {
				return
			}
			index = int(key[0]) % len(keys)
			key = keys[index]
		}
		source, want := bindingRenameOwnershipSource(key, mutation)
		toolsGuard(t, "FuzzBindingRenameOwnership", func() {
			r := toolsCompile(t, w, "FuzzBindingRenameOwnership", map[string]string{"main.vibe": source})
			defer r.Remove()
			config := toolsConfig(w, r.Dir)
			if config == nil || len(config.Errors) > 0 {
				t.Fatal("invalid generated project")
			}
			var result *vibelang.FixResult
			toolsRun(t, "FuzzBindingRenameOwnership", "fix", source, nil, func() {
				result = vibelang.FixProjectWithOptions(t.Context(), w.fs, bundled.LibPath(), config, vibelang.FixOptions{MigrationOnly: mutation&32 != 0})
			})
			if result.Err != nil || len(result.Refused) != 0 || len(result.Files) != 1 {
				Gap(t, "FuzzBindingRenameOwnership", "rename:old-positive-ownership", "migration did not apply: %+v\n%s", result, source)
				return
			}
			for _, fixed := range result.Files {
				if !bindingRenameOwnedTokens(fixed.Text, want) {
					Gap(t, "FuzzBindingRenameOwnership", "rename:old-positive-ownership", "rename captured an outer read or missed an owned read\nsource:\n%s\ngot:\n%s\nwant:\n%s", source, fixed.Text, want)
				}
			}
		})
	})
}

func bindingRenameOwnershipSource(key string, mutation uint8) (string, string) {
	name := []string{"id", "count", "item", "value"}[mutation&3]
	fresh := name + "2"
	render := func(binding, use string) string {
		parameter := "," + name + ":number"
		prefix := ""
		fallback := "return " + name + ";"
		if key == "local" {
			parameter = ""
			prefix = "const " + name + "=7; "
		}
		if key == "closure" {
			fallback = "return ()=>" + name + ";"
		}
		field := "id:let " + binding
		if mutation&4 != 0 {
			field = "let " + binding
			if binding != name {
				field = name + ":let " + binding
			}
		}
		condition := "a is { " + field + " }"
		if mutation&8 != 0 {
			condition = "true && (" + condition + ") && " + use + "!==undefined"
		}
		success := "return " + use + ";"
		if mutation&16 != 0 {
			success = "return ()=>" + use + ";"
		}
		if key == "else" {
			fallback = "else " + fallback
		}
		return fmt.Sprintf("export function probe(a:unknown%s):unknown { %sif (%s) { %s } %s }\n", parameter, prefix, condition, success, fallback)
	}
	return render(name, name), render(fresh, fresh)
}

// Migration permits equivalent layout. Compare scanner tokens rather than
// incidental spaces in an expanded shorthand; keep every identifier/operator
// and comment. Return is the templates' line-break-sensitive production.
func bindingRenameOwnedTokens(a, b string) bool {
	left, right := toolsScan(a), toolsScan(b)
	if !slices.EqualFunc(left, right, func(x, y toolsToken) bool { return x.kind == y.kind && x.text == y.text }) {
		return false
	}
	for i, token := range left {
		if token.text != "return" {
			continue
		}
		j := i + 1
		for j < len(left) && toolsIsComment(left[j]) {
			j++
		}
		if j < len(left) && strings.ContainsAny(a[token.end:left[j].start], "\r\n\u2028\u2029") != strings.ContainsAny(b[right[i].end:right[j].start], "\r\n\u2028\u2029") {
			return false
		}
	}
	return true
}

func TestBindingRenameOwnershipTokenOracle(t *testing.T) {
	for _, tc := range []struct {
		a, b  string
		equal bool
	}{
		{"id:let id2", "id: let id2", true},
		{"return id;", "return id2;", false},
		{"return id;", "return\nid;", false},
		{"return /* note\n */ id;", "return /* note */ id;", false},
		{"/* keep */ return id;", "return id;", false},
	} {
		if got := bindingRenameOwnedTokens(tc.a, tc.b); got != tc.equal {
			t.Errorf("token oracle(%q,%q)=%t, want%t", tc.a, tc.b, got, tc.equal)
		}
	}
}
