package vibelang

import (
	"fmt"
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

// hubProject writes the shape of t3code's server slice wk-srv-a444-35
// (2026-11-03): hub.vibe imports culprits modules, each with a fix that
// changes what its function returns, and reports an error when any one of
// them is applied, as CodexAdapterV2's TS2322 came back with any of some
// 50 fixes. The gate refuses those one search at a time. Beside them,
// others modules each offer good fixes that no error reaches. It returns
// the directory and the config.
func hubProject(t testing.TB, culprits, others, good int) (string, *tsoptions.ParsedCommandLine) {
	t.Helper()
	_, file, _, _ := editorProgram(t, "export const main = 1\n")
	dir := filepath.Dir(file.FileName().AsString())
	write := func(name, text string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(text), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	var hub, reads strings.Builder
	for i := range culprits {
		write(fmt.Sprintf("c%02d.vibe", i), fmt.Sprintf("export effect function modes%d() {\n  const mode = try Effect.succeed(\"fast\")\n  const all: Array<typeof mode> = [mode]\n  return all\n}\n", i))
		fmt.Fprintf(&hub, "import { modes%d } from \"./c%02d.vibe\"\n", i, i)
		if i > 0 {
			reads.WriteString(" | ")
		}
		fmt.Fprintf(&reads, "(ReturnType<typeof modes%d> extends (\"fast\"[]!!) ? true : false)", i)
	}
	fmt.Fprintf(&hub, "export const any: true extends %s ? false : true = true\n", reads.String())
	write("hub.vibe", hub.String())
	for i := range others {
		var b strings.Builder
		for k := range good {
			fmt.Fprintf(&b, "export type T%d_%d = Effect.Effect<number>\n", i, k)
		}
		write(fmt.Sprintf("g%03d.vibe", i), b.String())
	}
	write("plain.ts", "export const plain = 1\n")
	write("tsconfig.json", `{"compilerOptions":{"target":"ES2022","module":"NodeNext","strict":true,"skipLibCheck":true,"noEmit":true,"allowImportingTsExtensions":true},"include":["*.vibe","*.ts"]}`)
	config, errors := tsoptions.GetParsedCommandLineOfConfigFile(tspath.RootedFilePathFromAbsolute(filepath.ToSlash(filepath.Join(dir, "tsconfig.json"))), &core.CompilerOptions{}, nil, bundled.WrapFS(osvfs.FS()), nil)
	if len(errors) != 0 {
		t.Fatalf("config: %v", errors)
	}
	return dir, config
}

// A round that reaches its bound still keeps the fixes it has not told
// apart that no error it adds can come from. On t3code's server, a round
// refused one of some 50 fixes that each brought back an error of
// CodexAdapterV2, 5 checks each, reached the bound, and refused the 237
// fixes it had not told apart under one TS18048 of AssetAccess; it kept
// none, and run again it did the same (gen-t3code, 2026-11-03).
func TestFixBoundKeepsWhatItCanVerify(t *testing.T) {
	const culprits, others, good, bound = 16, 20, 2, 10
	_, config := hubProject(t, culprits, others, good)
	result := FixProjectWithOptions(t.Context(), bundled.WrapFS(osvfs.FS()), bundled.LibPath(), config, FixOptions{IsolationChecks: bound})
	if result.Err != nil {
		t.Fatal(result.Err)
	}
	untold := 0
	for _, r := range result.Refused {
		if strings.Contains(r.Error, " the gate stopped telling apart after ") {
			untold++
			if !strings.Contains(r.Error, "hub.vibe: TS2322: ") {
				t.Errorf("refused %s:%d as %q; want the error of hub.vibe that set it aside", filepath.Base(r.File.AsString()), r.Line, r.Error)
			}
		}
	}
	if untold == 0 {
		t.Fatalf("refused %d fixes, none at the bound of %d checks; the project no longer reaches it", len(result.Refused), bound)
	}
	fixed := 0
	for name, file := range result.Files {
		if base := filepath.Base(name.AsString()); strings.HasPrefix(base, "g") {
			if strings.Contains(file.Text, "Effect.Effect<number>") {
				t.Errorf("%s keeps a good fix unapplied:\n%s", base, file.Text)
			} else {
				fixed++
			}
		}
	}
	t.Logf("%d of %d modules with good fixes fixed; %d fixes refused, %d at the bound", fixed, others, len(result.Refused), untold)
	if fixed != others {
		t.Fatalf("fixed %d of %d modules no error reaches", fixed, others)
	}
	// What it keeps adds no error.
	disk := bundled.WrapFS(osvfs.FS())
	baseline := baselineOf(t.Context(), fixProgram(disk, bundled.LibPath(), config, &fixParsedFiles{}, nil))
	texts := map[tspath.RootedFilePath]string{}
	for name, file := range result.Files {
		texts[name] = file.Text
	}
	if added := addedErrors(t.Context(), fixProgram(disk, bundled.LibPath(), config, &fixParsedFiles{}, texts), baseline); len(added) > 0 {
		t.Fatalf("the fixes kept add %v", added)
	}
}
