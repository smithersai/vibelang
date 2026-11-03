package vibelangfuzz

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/execute"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// Detail 281 / VIP-27: compare native TypeScript declaration emit with
// VibeLang sidecar emit, including CLI exit status and actual disk contents.
var sidecarParityQuotes = []string{
	"Declaration sidecars are emit outputs like `.d.ts`.",
	"a sidecar found through `include` yields to its source and emit may overwrite it.",
	"Listing both the source and its sidecar explicitly in `files` keeps the sidecar as an input: emit reports `TS5055`, exits `1`, and leaves its bytes untouched.",
	"The same rule applies in the `vibe.sidecarDir` directory.",
}

func TestSidecarEmitRulesQuoted(t *testing.T) {
	checkSidecarEmitRulesQuoted(t)
}

func checkSidecarEmitRulesQuoted(t testing.TB) {
	t.Helper()
	text, err := os.ReadFile(SpecPath("007-tooling.md"))
	if err != nil {
		t.Fatal(err)
	}
	for _, quote := range sidecarParityQuotes {
		if !strings.Contains(string(text), quote) {
			t.Fatalf("missing VIP-27 / detail 281 rule: %s", quote)
		}
	}
}

// This is the same command-line path whose Status cmd/tsc passes to os.Exit.
// Use the bundled libraries and the real disk, as cmd/tsc does, without building
// another compiler in each target. The acceptance case also runs the executable.
type sidecarParitySystem struct {
	fs     vfs.FS
	cwd    tspath.RootedDirectoryPath
	output bytes.Buffer
}

func (s *sidecarParitySystem) Writer() io.Writer      { return &s.output }
func (s *sidecarParitySystem) ErrorWriter() io.Writer { return &s.output }
func (s *sidecarParitySystem) FS() vfs.FS             { return s.fs }
func (s *sidecarParitySystem) DefaultLibraryPath() tspath.RootedDirectoryPath {
	return bundled.LibPath()
}
func (s *sidecarParitySystem) GetCurrentDirectory() tspath.RootedDirectoryPath { return s.cwd }
func (*sidecarParitySystem) WriteOutputIsTTY() bool                            { return false }
func (*sidecarParitySystem) GetWidthOfTerminal() int                           { return 0 }
func (*sidecarParitySystem) GetEnvironmentVariable(string) (string, bool)      { return "", false }
func (*sidecarParitySystem) Now() time.Time                                    { return time.Unix(0, 0) }
func (*sidecarParitySystem) SinceStart() time.Duration                         { return 0 }
func (*sidecarParitySystem) Spawn([]string, string, io.Writer) (io.ReadWriteCloser, error) {
	return nil, fmt.Errorf("sidecar emit parity must not spawn external tools")
}

// Chapter 007 / include yields to source while explicit files retain input bytes: docs/design/src/007-tooling.md#fee0a31ad53ffc12
func FuzzSidecarEmitParity(f *testing.F) {
	startShortBudget(f)
	checkSidecarEmitRulesQuoted(f)
	for _, key := range []string{"files", "include"} {
		for layout := byte(0); layout < 3; layout++ {
			for contents := byte(0); contents < 3; contents++ {
				for nested := byte(0); nested < 2; nested++ {
					f.Add(key, []byte{layout, 42, contents & 1, nested, contents})
				}
			}
		}
	}
	f.Fuzz(func(t *testing.T, shape string, choice []byte) {
		if shape != "files" && shape != "include" {
			if len(shape) > 0 && shape[0]&1 != 0 {
				shape = "files"
			} else {
				shape = "include"
			}
		}
		at := func(i int) byte {
			if i < len(choice) {
				return choice[i]
			}
			return 0
		}
		// Bounded, valid declaration text with varying bytes and line endings.
		ending := "\n"
		if at(2)&1 != 0 {
			ending = "\r\n"
		}
		original := []byte(fmt.Sprintf("// preserved %x%s export declare const old: unique symbol;%s", choice[:min(len(choice), 32)], ending, ending))
		value := int(at(1))
		layout := []string{"beside", ".vibe/declarations", "types"}[at(0)%3]
		prefix := ""
		if at(3)&1 != 0 {
			prefix = "src/deep/"
		}
		if at(4)%3 == 1 {
			original = nil
		} else if at(4)%3 == 2 {
			original = []byte(fmt.Sprintf("export declare const value = %d;\n", value))
		}
		dir := t.TempDir()
		type observation struct {
			Status int
			Codes  []string
			Bytes  []byte
		}
		var results []observation
		for _, extension := range []string{"ts", "vibe"} {
			project := filepath.Join(dir, extension)
			if err := os.MkdirAll(project, 0o700); err != nil {
				t.Fatal(err)
			}
			source := prefix + "main." + extension
			declaration := "main.d.ts"
			if extension == "vibe" {
				declaration = "main.d.vibe.ts"
			}
			declaration = prefix + declaration
			if layout != "beside" {
				declaration = layout + "/" + declaration
			}
			config := map[string]any{
				"compilerOptions": map[string]any{"target": "ESNext", "module": "ESNext", "types": []string{}, "declaration": true, "skipLibCheck": true, "rootDir": "."},
				"vibe":            map[string]any{"effectGlobals": false, "effectModules": false},
			}
			if layout != "beside" {
				if extension == "ts" {
					config["compilerOptions"].(map[string]any)["declarationDir"] = layout
				} else {
					config["vibe"].(map[string]any)["sidecarDir"] = layout
				}
			}
			if shape == "files" {
				config["files"] = []string{source, declaration}
			} else {
				config["include"] = []string{"**/*"}
			}
			data, err := json.Marshal(config)
			if err != nil {
				t.Fatal(err)
			}
			for name, text := range map[string][]byte{
				source:          []byte(fmt.Sprintf("export const value = %d\n", value)),
				declaration:     original,
				"tsconfig.json": data,
			} {
				if err := os.MkdirAll(filepath.Dir(filepath.Join(project, name)), 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(project, name), text, 0o600); err != nil {
					t.Fatal(err)
				}
			}
			sys := &sidecarParitySystem{
				fs:  bundled.WrapFS(osvfs.FS()),
				cwd: tspath.RootedDirectoryPathFromAbsolute(filepath.ToSlash(project)),
			}
			run := execute.CommandLine(t.Context(), sys, []string{"-p", ".", "--pretty", "false"}, nil)
			codes := []string{}
			for _, match := range regexp.MustCompile(`(?:error|warning) ((?:TS|EK)\d+):`).FindAllStringSubmatch(sys.output.String(), -1) {
				codes = append(codes, match[1])
			}
			slices.Sort(codes)
			contents, err := os.ReadFile(filepath.Join(project, declaration))
			if err != nil {
				t.Fatal(err)
			}
			results = append(results, observation{int(run.Status), codes, contents})
		}
		expectedStatus, expectedCodes := 0, []string{}
		if shape == "files" {
			expectedStatus, expectedCodes = 1, []string{"TS5055"}
		}
		reference := results[0]
		if reference.Status != expectedStatus || !reflect.DeepEqual(reference.Codes, expectedCodes) || (shape == "files" && !bytes.Equal(reference.Bytes, original)) {
			t.Fatalf("invalid TypeScript reference for %s: %+v", shape, reference)
		}
		if !reflect.DeepEqual(results[1], reference) {
			Gap(t, "FuzzSidecarEmitParity", "emit:sidecar-ts5055-parity:"+shape+":"+layout,
				"VIP-27 / detail 281: exit/codes/bytes differ for %s: TypeScript=%+v VibeLang=%+v", shape, reference, results[1])
		}
	})
}
