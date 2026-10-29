package vibelang

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/core"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// vibelang --fix-vip-only writes try before each call that runs where it
// stands (VIP-5): a call, a method call, a call in a statement, and a call
// whose value a member access continues, in parentheses, with a semicolon
// where the parenthesis would continue the line before. It writes none in an
// await operation's element, fork's operand, a held const, a function
// literal's expression body, the left side of catch, a plain function's
// call, or a call that already has try. It rewrites the retired try(…)
// hatch as Effect.try (EK4616). A second run finds nothing to write.
func TestFixVIPWritesTryWhereCallsRun(t *testing.T) {
	source := `error Bad { cause: unknown }

function load(n: number) {
  yieldNow()
  return { n }
}

class Box {
  get(n: number) {
    yieldNow()
    return n
  }
}

function plainDouble(n: number): number {
  return n * 2
}

export function main() {
  const box = new Box()
  const a = load(1)
  box.get(2)
  const b = load(3).n
  const all = await.all [load(4), load(5)]
  const f = fork load(6)
  const p: { n: number }!! = load(7)
  const later = () => load(8)
  const d = plainDouble(1)
  load(11).n
  const c = try load(9)
  const e = load(12) catch { n: 0 }
  const parsed = try((text) => JSON.parse(text), (cause) => new Bad({ cause }), "1")
  join f
  return a.n + b + all[0].n + d + c.n + e.n + parsed + box.get(10)
}
`
	want := `error Bad { cause: unknown }

function load(n: number) {
  try yieldNow()
  return { n }
}

class Box {
  get(n: number) {
    try yieldNow()
    return n
  }
}

function plainDouble(n: number): number {
  return n * 2
}

export function main() {
  const box = new Box()
  const a = try load(1)
  try box.get(2)
  const b = (try load(3)).n
  const all = await.all [load(4), load(5)]
  const f = fork load(6)
  const p: { n: number }!! = load(7)
  const later = () => load(8)
  const d = plainDouble(1)
  ;(try load(11)).n
  const c = try load(9)
  const e = load(12) catch { n: 0 }
  const parsed = try Effect.try({ try: () => ((text) => JSON.parse(text))("1"), catch: (cause) => new Bad({ cause }) })
  join f
  return a.n + b + all[0].n + d + c.n + e.n + parsed + try box.get(10)
}
`
	_, file, _, _ := editorProgram(t, source)
	dir := filepath.Dir(file.FileName().AsString())
	if err := os.WriteFile(filepath.Join(dir, "tsconfig.json"), []byte(`{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true},"files":["main.vibe"]}`), 0o600); err != nil {
		t.Fatal(err)
	}
	fs := bundled.WrapFS(osvfs.FS())
	configPath := tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json")))
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(configPath, &core.CompilerOptions{}, nil, fs, nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	result := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	fixed := result.Files[file.FileName()]
	if fixed == nil || fixed.Text != want {
		got := ""
		if fixed != nil {
			got = fixed.Text
		}
		t.Fatalf("--fix-vip-only wrote\n%s\nwant\n%s\nrefused %+v", got, want, result.Refused)
	}
	if fixed.Rewrites[tryLabel] != 7 || fixed.Counts[EK4616.Code] != 1 {
		t.Errorf("rewrites %v, fixes %v; want 7 tries and one EK4616 fix", fixed.Rewrites, fixed.Counts)
	}
	var report strings.Builder
	result.Report(&report, func(name tspath.RootedFilePath) string { return filepath.Base(name.AsString()) })
	if !strings.Contains(report.String(), "main.vibe: 8 fixes (EK4616 ×1, try ×7)") {
		t.Errorf("report:\n%s", report.String())
	}

	if err := os.WriteFile(file.FileName().AsString(), []byte(want), 0o600); err != nil {
		t.Fatal(err)
	}
	again := FixProjectWithOptions(t.Context(), fs, bundled.LibPath(), config, FixOptions{VIPOnly: true})
	if len(again.Files) != 0 {
		t.Errorf("a second run wrote %+v", again.Files[file.FileName()])
	}
}
