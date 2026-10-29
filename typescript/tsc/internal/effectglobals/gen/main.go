// Command gen writes internal/effectglobals/exports_generated.go, the
// exports of effect/Effect, from the installed effect package's
// dist/Effect.d.ts. Run it in typescript/tsc:
//
//	go run ./internal/effectglobals/gen [node_modules]
//
// node_modules defaults to $EFFECT_NODE_MODULES, then to the repository's
// experiments/node_modules. scripts/build-vibelang.sh runs it when effect is
// installed, so an Effect upgrade updates the globals of a .vibe file.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"

	"github.com/microsoft/TypeScript/tsc/internal/effectglobals"
)

func main() {
	modules := os.Getenv("EFFECT_NODE_MODULES")
	if len(os.Args) > 1 {
		modules = os.Args[1]
	}
	if modules == "" {
		modules = filepath.Join("..", "..", "experiments", "node_modules")
	}
	declarations, err := os.ReadFile(filepath.Join(modules, "effect", "dist", "Effect.d.ts"))
	if err != nil {
		fmt.Fprintln(os.Stderr, "effectglobals: effect is not installed:", err)
		os.Exit(1)
	}
	var manifest struct{ Version string }
	if data, err := os.ReadFile(filepath.Join(modules, "effect", "package.json")); err == nil {
		_ = json.Unmarshal(data, &manifest)
	}
	out := filepath.Join("internal", "effectglobals", "exports_generated.go")
	text := effectglobals.Generated(manifest.Version, effectglobals.ParseExports(string(declarations)))
	if old, err := os.ReadFile(out); err == nil && string(old) == text {
		return
	}
	if err := os.WriteFile(out, []byte(text), 0o644); err != nil {
		fmt.Fprintln(os.Stderr, "effectglobals:", err)
		os.Exit(1)
	}
	fmt.Println("effectglobals: wrote", out, "from effect@"+manifest.Version)
}
