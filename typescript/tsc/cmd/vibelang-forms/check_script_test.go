package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestCheckScriptRequiresApprovalsForCurrentSnapshot(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("check-forms-table.sh requires Bash")
	}
	script, err := os.ReadFile("../../../../scripts/check-forms-table.sh")
	if os.IsNotExist(err) {
		t.Skip("repository scripts were not included")
	}
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	writeFixture(t, root, "scripts/check-forms-table.sh", string(script))
	writeFixture(t, root, "typescript/tsc/internal/vibelang/export.go", "func FormsOfType")
	const mapper = "typescript/tsc/internal/vibelangmapper/"
	writeFixture(t, root, mapper+"forms_table.jsonl", "table\n")
	writeFixture(t, root, mapper+"forms_decisions.txt", "a.vibe:2:1 lambda effectFn table\n")
	writeFixture(t, root, mapper+"forms_decisions_approved.txt", "# approvals\n")
	for name, body := range map[string]string{
		"git": `#!/bin/sh
case "$3" in
  merge-base) echo base ;;
  show)
    case "$4" in
      base:*/forms_decisions.txt) echo 'a.vibe:1:1 lambda plain table' ;;
      base:*/forms_decisions_approved.txt) echo '# historical approvals' ;;
      *) exit 2 ;;
    esac ;;
  *) exit 2 ;;
esac
`,
		"generator": `#!/bin/sh
previous= approved= historical=
while [ "$#" -gt 0 ]; do
  case "$1" in
    -previous) previous="$2" ;;
    -approved) approved="$2" ;;
    -previous-approved) historical="$2" ;;
    -o) printf 'table\n' > "$2" ;;
    -decisions) printf 'a.vibe:2:1 lambda effectFn table\n' > "$2" ;;
  esac
  shift 2
done
if [ "$(cat "$previous")" = 'a.vibe:1:1 lambda plain table' ] &&
   [ "$(cat "$approved")" = '# approvals' ] &&
   [ "$(cat "$historical")" = '# historical approvals' ]; then
  echo 'decisions moved without an approval' >&2
  exit 1
fi
`,
		"bun": "#!/bin/sh\nexit 0\n",
	} {
		path := filepath.Join(root, "bin", name)
		writeFixture(t, root, "bin/"+name, body)
		if err := os.Chmod(path, 0755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(root, "typescript/tsc/cmd/vibelang-data-methods/node_modules"), 0755); err != nil {
		t.Fatal(err)
	}
	cmd := exec.Command("bash", filepath.Join(root, "scripts/check-forms-table.sh"))
	cmd.Env = append(os.Environ(),
		"PATH="+filepath.Join(root, "bin")+string(os.PathListSeparator)+os.Getenv("PATH"),
		"FORMS_BINARY="+filepath.Join(root, "bin/generator"),
		"VIBELANG_FORMS_EXPORT=",
		"FORMS_NODE_MODULES=",
	)
	out, err := cmd.CombinedOutput()
	if status, ok := err.(*exec.ExitError); !ok || status.ExitCode() != 1 || !strings.Contains(string(out), "decisions moved without an approval") {
		t.Fatalf("check did not enforce approvals with an up-to-date snapshot: %v\n%s", err, out)
	}
}
