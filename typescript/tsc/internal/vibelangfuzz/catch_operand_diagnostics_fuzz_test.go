package vibelangfuzz

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func catchOperandDiagnosticsQuoted(t testing.TB) {
	t.Helper()
	const quote = "Native lexical, syntax and static errors keep their"
	text := SpecText("007-tooling.md")
	if !strings.Contains(text, quote) || !strings.Contains(text, "including independent errors in embedded expressions and types") {
		t.Fatal("ordinary TypeScript diagnostics rule missing")
	}
}
func TestCatchOperandDiagnosticsQuoted(t *testing.T) { catchOperandDiagnosticsQuoted(t) }
func FuzzCatchOperandDiagnostics(f *testing.F) {
	startShortBudget(f)
	for _, kind := range []string{"argument", "overload", "body", "constraint", "satisfaction", "object"} {
		for _, wrapper := range []string{"direct", "paren", "as", "nonnull", "satisfies"} {
			f.Add(kind, wrapper, false)
			f.Add(kind, wrapper, true)
		}
	}
	w := NewWorkspace(f)
	tsc := StockTypeScript(f)
	version, versionErr := exec.CommandContext(f.Context(), tsc, "--version").CombinedOutput()
	if versionErr != nil {
		f.Fatalf("stock compiler version: %v: %s", versionErr, version)
	}
	f.Logf("stock oracle: %s", strings.TrimSpace(string(version)))
	f.Fuzz(func(t *testing.T, kind, wrapper string, good bool) {
		catchOperandDiagnosticsQuoted(t)
		decl := "declare function take(n:number):number;"
		call, handler := "take(1)", "() => 0"
		code := 2345
		switch kind {
		case "overload":
			decl += "declare function take(n:boolean):number;"
			code = 2769
		case "body":
			code = 2322
		case "satisfaction":
			call = "take(1) satisfies number"
			code = 1360
		case "object":
			decl = "declare function take(n:{value:number}):number;"
			call = "take({value:1})"
			code = 2322
		case "constraint":
			decl = "declare function take<T extends number>(n:T):number;"
			call = "take<number>(1)"
			code = 2344
		default:
			kind = "argument"
		}
		if !good {
			switch kind {
			case "body":
				handler = "() => { const n:number = \"bad\"; return n }"
			case "satisfaction":
				call = "take(1) satisfies string"
			case "object":
				call = "take({value:\"bad\"})"
			case "constraint":
				call = "take<string>(\"bad\")"
			default:
				call = "take(\"bad\")"
			}
		} else {
			code = 0
		}
		switch wrapper {
		case "paren":
			call = "(" + call + ")"
		case "as":
			call = call + " as number"
		case "nonnull":
			call = "(" + call + ")!"
		case "satisfies":
			call = call + " satisfies number"
		}
		stock := decl + "\n" + call + ";\n"
		if kind == "body" && !good {
			stock += "const n:number = \"bad\";\n"
		}
		dir := t.TempDir()
		if err := os.WriteFile(filepath.Join(dir, "main.ts"), []byte(stock), 0600); err != nil {
			t.Fatal(err)
		}
		config := `{"compilerOptions":{"strict":true,"noEmit":true,"skipLibCheck":true,"target":"es2022","module":"nodenext","types":[]},"files":["main.ts"]}`
		if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(config), 0600); err != nil {
			t.Fatal(err)
		}
		ctx, cancel := context.WithTimeout(t.Context(), 2*HangLimit)
		defer cancel()
		cmd := exec.CommandContext(ctx, tsc, "-p", dir, "--pretty", "false")
		out, err := cmd.CombinedOutput()
		matches := regexp.MustCompile("error TS([0-9]+):").FindAllStringSubmatch(string(out), -1)
		if code == 0 {
			if err != nil || len(matches) != 0 {
				t.Fatalf("stock valid control: %v %s", err, out)
			}
		} else {
			if err == nil || len(matches) != 1 {
				t.Fatalf("stock expected TS%d: %v %s", code, err, out)
			}
			got, _ := strconv.Atoi(matches[0][1])
			if got != code {
				t.Fatalf("stock got TS%d want TS%d: %s", got, code, out)
			}
		}

		source := decl + "\nexport effect function main(){ " + call + " catch " + handler + "; return 0 }"
		result, err := w.Compile(t.Context(), Project{Files: map[string]string{"main.vibe": source}})
		if err != nil {
			t.Fatal(err)
		}
		defer result.Remove()
		outer, inner := 0, 0
		for _, d := range result.Diagnostics {
			if IsEK(d) && d.Code() == 506 {
				outer++
				continue
			}
			if !IsEK(d) && code != 0 && int(d.Code()) == code {
				inner++
				continue
			}
			t.Fatalf("unexpected diagnostic at %q: %s", source[d.Pos():d.End()], d.String())
		}
		if outer != 1 || (code != 0 && inner != 1) {
			t.Fatalf("%s/%s: want EK0506 and TS%d, got outer=%d inner=%d", kind, wrapper, code, outer, inner)
		}
	})
}
