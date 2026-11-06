package vibelangmapper

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

// stockTypeScriptVersion returns the stock TypeScript version the mapper is
// tested against: devDependencies.typescript in packages/ts-mapper/package.json.
func stockTypeScriptVersion(root string) (string, error) {
	data, err := os.ReadFile(filepath.Join(root, "packages/ts-mapper/package.json"))
	if err != nil {
		return "", err
	}
	var manifest struct {
		DevDependencies map[string]string `json:"devDependencies"`
	}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return "", fmt.Errorf("packages/ts-mapper/package.json: %w", err)
	}
	if manifest.DevDependencies["typescript"] == "" {
		return "", fmt.Errorf("packages/ts-mapper/package.json pins no typescript in devDependencies")
	}
	return manifest.DevDependencies["typescript"], nil
}

// stockTypeScriptPath returns the stock tsc the tests run, installed where
// e2e.sh and CONTRIBUTING install it: packages/ts-mapper/test/.cache/
// typescript-<version>. The version is TS7_VERSION when set, as e2e.sh and
// the parity harness read it, else the pin.
func stockTypeScriptPath(t *testing.T, root string) string {
	t.Helper()
	version := os.Getenv("TS7_VERSION")
	if version == "" {
		var err error
		if version, err = stockTypeScriptVersion(root); err != nil {
			t.Fatal(err)
		}
	}
	return filepath.Join(root, "packages/ts-mapper/test/.cache", "typescript-"+version, "node_modules/.bin/tsc")
}

// hardcodedStockPin matches a stock TypeScript version written after
// "typescript-" (a cache path), after "typescript@" (an npm install), or as
// a TS7_VERSION default in a shell script.
var hardcodedStockPin = regexp.MustCompile(`typescript[@-]7\.\d+\.\d+|TS7_VERSION:-7\.`)

// TestStockTypeScriptPinHasOneSource keeps the stock compiler the mapper is
// tested against in one place, devDependencies.typescript in
// packages/ts-mapper/package.json. The Go tests, e2e.sh, the parity harness
// and CONTRIBUTING read it from there, so moving the pin is one edit and no
// suite is left testing another compiler.
func TestStockTypeScriptPinHasOneSource(t *testing.T) {
	root, err := filepath.Abs("../../../..")
	if err != nil {
		t.Fatal(err)
	}
	if version, err := stockTypeScriptVersion(root); err != nil {
		t.Error(err)
	} else if !regexp.MustCompile(`^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$`).MatchString(version) {
		t.Errorf("packages/ts-mapper/package.json pins typescript %q; pin an exact version", version)
	}
	var found []string
	scan := func(path string) {
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		for i, line := range strings.Split(string(data), "\n") {
			if hardcodedStockPin.MatchString(line) {
				rel, _ := filepath.Rel(root, path)
				found = append(found, rel+":"+strconv.Itoa(i+1))
			}
		}
	}
	for _, dir := range []string{"typescript/tsc/internal/vibelangmapper", "packages/ts-mapper/test"} {
		err := filepath.WalkDir(filepath.Join(root, dir), func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() {
				switch entry.Name() {
				case ".cache", "out", "node_modules", "testdata":
					return filepath.SkipDir
				}
				return nil
			}
			switch filepath.Ext(path) {
			case ".go", ".sh", ".ts", ".mjs", ".md":
				scan(path)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	scan(filepath.Join(root, ".smithers/flows/docs/project.ts"))
	scan(filepath.Join(root, "CONTRIBUTING.md"))
	// The user docs may name the stock TypeScript the mapper is tested
	// with, and then name the pin.
	if pin, err := stockTypeScriptVersion(root); err == nil {
		err := filepath.WalkDir(filepath.Join(root, "docs/user/src"), func(path string, entry fs.DirEntry, err error) error {
			if err != nil || entry.IsDir() || filepath.Ext(path) != ".md" {
				return err
			}
			data, err := os.ReadFile(path)
			if err != nil {
				return err
			}
			for _, match := range stockTypeScriptNamed.FindAllStringSubmatch(string(data), -1) {
				if match[1] != pin {
					rel, _ := filepath.Rel(root, path)
					found = append(found, rel+": "+match[0]+" is not the pin, typescript@"+pin)
				}
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if len(found) > 0 {
		t.Fatalf("stock TypeScript versions written outside packages/ts-mapper/package.json; read devDependencies.typescript instead:\n%s", strings.Join(found, "\n"))
	}
}

// TestRequireStockTypeScriptWhenRequired: e2e.sh sets
// VIBELANG_REQUIRE_STOCK_TYPESCRIPT=1, so a missing stock compiler fails the
// stock-compiler tests there instead of skipping them unseen. Elsewhere a
// missing compiler still skips with the install command.
func TestRequireStockTypeScriptWhenRequired(t *testing.T) {
	if os.Getenv("VIBELANG_STOCK_PROBE") == "1" {
		requireStockTypeScript(t, filepath.Join(t.TempDir(), "typescript-0.0.0", "node_modules", ".bin", "tsc"))
		return
	}
	for _, tc := range []struct {
		required string
		fails    bool
	}{{required: "", fails: false}, {required: "1", fails: true}} {
		command := exec.Command(os.Args[0], "-test.run=^TestRequireStockTypeScriptWhenRequired$", "-test.v")
		command.Env = append(os.Environ(), "VIBELANG_STOCK_PROBE=1", "VIBELANG_REQUIRE_STOCK_TYPESCRIPT="+tc.required)
		output, err := command.CombinedOutput()
		if failed := err != nil; failed != tc.fails || !strings.Contains(string(output), "missing pinned stock TypeScript compiler") {
			t.Errorf("VIBELANG_REQUIRE_STOCK_TYPESCRIPT=%q: failed %v, want %v\n%s", tc.required, failed, tc.fails, output)
		}
	}
}

// stockTypeScriptNamed finds the npm package typescript at an exact version. A
// longer package name that ends in typescript, such as vibelang-typescript or
// a scoped package, is a different package with its own versions.
var stockTypeScriptNamed = regexp.MustCompile(`(?:^|[^\w/-])typescript@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]*[0-9A-Za-z])?)`)

func TestStockTypeScriptNamedOnlyMatchesThatPackage(t *testing.T) {
	// Spelled in parts, so the repository scan above does not read these as pins.
	const at = "typescript" + "@"
	for text, want := range map[string]string{
		at + "9.9.9":                         "9.9.9",
		"npm install " + at + "5.9.3":        "5.9.3",
		"`" + at + "7.1.0-beta`":             "7.1.0-beta",
		"(" + at + "1.2.3)":                  "1.2.3",
		"npm:" + at + "1.2.3":                "1.2.3",
		at + "npm:vibelang-" + at + "7.1.11": "",
		"npm:vibelang-" + at + "7.1.11":      "",
		"@scope/" + at + "1.2.3":             "",
		"not-" + at + "1.2.3":                "",
		"my" + at + "1.2.3":                  "",
		at + "latest":                        "",
	} {
		got := ""
		if match := stockTypeScriptNamed.FindStringSubmatch(text); match != nil {
			got = match[1]
		}
		if got != want {
			t.Errorf("%q: got %q, want %q", text, got, want)
		}
	}
}
