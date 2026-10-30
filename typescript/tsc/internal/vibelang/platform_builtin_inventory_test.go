package vibelang

import (
	"encoding/json"
	"os/exec"
	"strings"
	"testing"
)

// Node owns the builtin inventory, including undocumented bare names and
// prefix-only names. Avoid a second expected list that can share our omissions.
func TestPlatformNodeBuiltinInventory(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("Node is unavailable for the runtime builtin inventory")
	}
	command := exec.Command(node, "-e", `const {builtinModules,isBuiltin}=require("node:module");process.stdout.write(JSON.stringify({version:process.version,names:builtinModules,controls:Object.fromEntries(["_http_custom","_stream_custom","_tls_fake","test","test/reporters","sea","sqlite"].map(name=>[name,isBuiltin(name)]))}))`)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Node builtin inventory: %v\n%s", err, output)
	}
	var inventory struct {
		Version  string
		Names    []string
		Controls map[string]bool
	}
	if err := json.Unmarshal(output, &inventory); err != nil {
		t.Fatal(err)
	}
	t.Logf("Node %s: %d builtin modules", inventory.Version, len(inventory.Names))
	if len(inventory.Names) == 0 {
		t.Fatal("empty Node builtin inventory")
	}
	for _, name := range inventory.Names {
		t.Run(name, func(t *testing.T) {
			if _, platform := platformModuleOf(name); !platform {
				t.Errorf("Node builtin %q is not a platform import", name)
			}
			if !strings.HasPrefix(name, "node:") {
				if _, platform := platformModuleOf("node:" + name); !platform {
					t.Errorf("prefixed builtin %q is not a platform import", name)
				}
			}
		})
	}
	for name, want := range inventory.Controls {
		if _, got := platformModuleOf(name); got != want {
			t.Errorf("%q: platform=%v, Node isBuiltin=%v", name, got, want)
		}
	}
}
