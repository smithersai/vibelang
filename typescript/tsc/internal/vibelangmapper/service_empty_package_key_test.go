package vibelangmapper

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestMapperEmptyPackageModuleKey(t *testing.T) {
	for _, tc := range []struct{ name, pkg, want string }{
		{"empty", `{"name":""}`, "/src/main"},
		{"ordinary", `{"name":"app"}`, "app/src/main"},
		{"scoped", `{"name":"@scope/app"}`, "@scope/app/src/main"},
		{"absent", `{}`, "project/src/main"},
		{"null", `{"name":null}`, "project/src/main"},
		{"number", `{"name":0}`, "project/src/main"},
		{"boolean", `{"name":false}`, "project/src/main"},
		{"array", `{"name":[]}`, "project/src/main"},
		{"object", `{"name":{}}`, "project/src/main"},
		{"last-empty", `{"name":"outer","name":""}`, "/src/main"},
		{"last-absent", `{"name":"","name":null}`, "project/src/main"},
	} {
		for _, ext := range []string{".vibe", ".vibex"} {
			t.Run(tc.name+ext, func(t *testing.T) {
				read := func(name string) ([]byte, error) {
					if name == "/project/package.json" {
						return []byte(tc.pkg), nil
					}
					return nil, os.ErrNotExist
				}
				got := moduleKey("/project/src/main"+ext, read)
				if got != tc.want {
					t.Fatalf("module key = %q, want %q", got, tc.want)
				}
			})
		}
	}
}

func TestMapperEmptyPackageNearestScope(t *testing.T) {
	read := func(name string) ([]byte, error) {
		switch name {
		case "/project/package.json":
			return []byte(`{"name":"outer"}`), nil
		case "/project/src/package.json":
			return []byte(`{"name":""}`), nil
		}
		return nil, os.ErrNotExist
	}
	if got := moduleKey("/project/src/main.part.vibe", read); got != "/main.part" {
		t.Fatal(got)
	}
}

func TestMapperEmptyPackageNameIdentity(t *testing.T) {
	dir := t.TempDir()
	pkg := filepath.Join(dir, "package.json")
	config := filepath.Join(dir, "tsconfig.json")
	write := func(value string) string {
		t.Helper()
		if err := os.WriteFile(pkg, []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
		_, identity := projectPackageFiles(config)
		return identity
	}
	empty := write(`{"name":""}`)
	missing := write(`{}`)
	if empty == missing {
		t.Fatal("an empty string name and an absent name share a projection cache identity")
	}
	if got := write(`{"name":null}`); got != missing {
		t.Fatal("non-string recovery changed the module identity")
	}
	if got := write(`{"name":"","private":true}`); got != empty {
		t.Fatal("unrelated metadata changed the named module identity")
	}
}

func TestMapperEmptyPackageProjection(t *testing.T) {
	for _, ext := range []string{".vibe", ".vibex"} {
		for _, name := range []string{"Named", "Café"} {
			dir := t.TempDir()
			manifest, _ := json.Marshal(map[string]string{"name": ""})
			if err := os.WriteFile(filepath.Join(dir, "package.json"), manifest, 0600); err != nil {
				t.Fatal(err)
			}
			file := filepath.ToSlash(filepath.Join(dir, "main"+ext))
			context := FileContextOf(file)
			want := "/main#" + name
			source := "export service " + name + " { readonly value: number }"
			result := Project(source, context)
			// The identifier is the same in each source spelling; the service-key
			// argument remains a string literal from VIP-9's native counterpart.
			if !strings.Contains(result.Text, strconv.Quote(want)) && !strings.Contains(result.Text, strings.ReplaceAll(strconv.Quote(want), "é", `\u00e9`)) {
				t.Fatalf("missing key %q:\n%s", want, result.Text)
			}
		}
	}
}
