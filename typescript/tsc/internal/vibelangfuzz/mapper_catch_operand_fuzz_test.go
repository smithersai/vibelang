package vibelangfuzz

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/vibelangmapper"
)

func TestMapperCatchOperandsQuoted(t *testing.T) {
	chapterSays(t, "002-running.md", "The handler is always a function literal, and its syntax alone decides its kind")
	chapterSays(t, "002-running.md", "Every operand is evaluated once, left to right as written")
	chapterSays(t, "002-running.md", "its type is assignable to `Effect.Effect<any, any, any>`")
}

func FuzzMapperCatchOperandAdmission(f *testing.F) {
	startShortBudget(f)
	for _, key := range []string{"identifier", "as", "satisfies", "conditional", "property", "element", "written-try"} {
		for flags := uint8(0); flags < 4; flags++ {
			f.Add(key, flags)
		}
	}
	w := NewWorkspace(f)
	packageDir := filepath.Join(w.Dir, "node_modules", "vibelang-ts-mapper")
	if err := os.MkdirAll(packageDir, 0o700); err != nil {
		f.Fatal(err)
	}
	for _, name := range []string{"package.json", "prelude.d.ts"} {
		data, err := os.ReadFile(filepath.Join(Root(), "packages", "ts-mapper", name))
		if err != nil {
			f.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(packageDir, name), data, 0o600); err != nil {
			f.Fatal(err)
		}
	}
	f.Fuzz(func(t *testing.T, key string, flags uint8) {
		TestMapperCatchOperandsQuoted(t)
		operand := "held"
		switch key {
		case "as":
			operand = "(held as Job)"
		case "satisfies":
			operand = "(held satisfies Job)"
		case "conditional":
			operand = "(true ? held : E.succeed(99))"
		case "property":
			operand = "box.held"
		case "element":
			operand = "box[\"held\"]"
		case "written-try":
			operand = "(try E.succeed(held))"
		}
		if flags&1 != 0 {
			operand = "(/* operand */ " + operand + ")"
		}
		source := `import {Effect as E} from "effect";type Job=E.Effect<number,string>;declare const held:Job;const box={held};export effect function sample(){const value:number=` + operand + ` catch ()=>99;return value}`
		if flags&2 != 0 {
			source = "// café 😀\r\n" + strings.ReplaceAll(source, ";", ";\r\n")
		}
		for _, p := range []vibelangmapper.Projection{vibelangmapper.Project(source, vibelangmapper.FileContext{}), vibelangmapper.Executable(source, vibelangmapper.FileContext{})} {
			if len(p.Diagnostics) != 0 {
				Gap(t, "FuzzMapperCatchOperandAdmission", key, "valid Effect operand reports %v", p.Diagnostics)
			}
		}
		projected := vibelangmapper.Project(source, vibelangmapper.FileContext{})
		checked := toolsCompile(t, w, "FuzzMapperCatchOperandAdmission", map[string]string{"main.ts": projected.Text})
		defer checked.Remove()
		if HasError(checked.Diagnostics) {
			Gap(t, "FuzzMapperCatchOperandAdmission", key, "an Effect<number> operand and numeric fallback must give a number: %v\n%s", checked.Diagnostics, projected.Text)
		}
		js, _, diags := vibelangmapper.Emit(source, vibelangmapper.FileContext{})
		if len(diags) != 0 {
			Gap(t, "FuzzMapperCatchOperandAdmission", key, "valid catch does not emit: %v", diags)
		}
		cmd := exec.CommandContext(t.Context(), "node", "--input-type=module", "--check")
		cmd.Stdin = strings.NewReader(js)
		if out, err := cmd.CombinedOutput(); err != nil {
			Gap(t, "FuzzMapperCatchOperandAdmission", key, "emitted JavaScript does not parse: %v\n%s\n%s", err, out, js)
		}
	})
}
