package grammaradmission

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// An admitted dispatch or matching helper does not grant authority to its
// undefined branches. Keep the surveyed gaps visible in both inventory views.
func TestSurveyedBranchesRemainPending(t *testing.T) {
	root := repositoryRoot(t)
	want := map[string]string{
		"parser/vibelang.go:Parser.parseVibeLangDeclaration@ambient-custom-declaration":   "admission:ambient-custom-declaration",
		"parser/vibelang_match.go:Parser.parseMatchPrimaryPattern@pattern-name-object":    "admission:pattern-name-object",
		"parser/vibelang_match.go:Parser.parseMatchValueExpression@pattern-super-element": "admission:pattern-super-element",
	}
	for _, table := range []string{"docs/design/registry/grammar-admission.tsv", Table} {
		t.Run(filepath.Base(filepath.Dir(table)), func(t *testing.T) {
			data, err := os.ReadFile(filepath.Join(root, table))
			if err != nil {
				t.Fatal(err)
			}
			found := map[string]bool{}
			for _, line := range strings.Split(string(data), "\n") {
				fields := strings.Split(line, "\t")
				if len(fields) != 5 {
					continue
				}
				key, ok := want[fields[0]]
				if !ok {
					continue
				}
				found[fields[0]] = true
				if fields[1] != key || fields[2] != "-" || fields[3] != "pending" {
					t.Errorf("undefined branch must remain pending without authority: %s", line)
				}
			}
			for hook := range want {
				if !found[hook] {
					t.Errorf("missing pending branch %s in %s", hook, table)
				}
			}
		})
	}
}
