package vibelangfuzz

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/bundled"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

// The configuration precedence every writer shares: Project.Config, then a
// tsconfig.json entry of Files (what ProjectFromArchive lifts), then the
// default with the sorted source roots.
func TestProjectWriterConsistency(t *testing.T) {
	const fileConfig = `{"compilerOptions":{"noLib":true,"noEmit":true},"files":["sub/a.ts"]}`
	for _, source := range []string{"default", "file", "explicit"} {
		for _, entry := range []string{"write", "compile", "ordered", "tools"} {
			t.Run(entry+"/"+source, func(t *testing.T) {
				w := &Workspace{Dir: t.TempDir(), fs: bundled.WrapFS(osvfs.FS())}
				p := Project{Files: map[string]string{"z.ts": "export const z = 1", "sub/a.ts": "export const a = 2"}}
				if source != "default" {
					p.Files["tsconfig.json"] = fileConfig
				}
				if source == "explicit" {
					p.Config = `{"compilerOptions":{"noLib":true,"noEmit":true},"files":["z.ts"]}`
				}
				var dir string
				var err error
				switch entry {
				case "write":
					dir, err = w.writeProject(p)
				case "tools":
					dir, err = toolsWrite(w, p)
				case "compile":
					var r *Result
					r, err = w.Compile(t.Context(), p)
					if r != nil {
						dir = r.Dir
					}
				case "ordered":
					var r *Compilation
					r, err = w.CompileOrdered(t.Context(), p, OrderTsc, true)
					if r != nil {
						dir = r.Dir
					}
				}
				if err != nil {
					t.Fatal(err)
				}
				config, err := os.ReadFile(filepath.Join(dir, "tsconfig.json"))
				if err != nil {
					t.Fatal(err)
				}
				switch source {
				case "explicit":
					if string(config) != p.Config {
						t.Fatalf("explicit config was replaced: %s", config)
					}
				case "file":
					if string(config) != fileConfig {
						t.Fatalf("the project's own tsconfig.json was replaced: %s", config)
					}
				default:
					if !strings.Contains(string(config), `"files": ["sub/a.ts","z.ts"]`) {
						t.Fatalf("default config was replaced or roots were unsorted: %s", config)
					}
				}
				for name, text := range p.Files {
					if name == "tsconfig.json" {
						continue
					}
					data, err := os.ReadFile(filepath.Join(dir, name))
					if err != nil || string(data) != text {
						t.Fatalf("%s: %q, %v", name, data, err)
					}
				}
			})
		}
	}
}

func TestProjectWritersRejectEscapes(t *testing.T) {
	for _, name := range []string{"../escape.ts", "sub/../../escape.ts", "/escape.ts", "./tsconfig.json", "sub/../tsconfig.json"} {
		for _, entry := range []string{"write", "compile", "tools"} {
			t.Run(entry+"/"+name, func(t *testing.T) {
				root := t.TempDir()
				w := &Workspace{Dir: filepath.Join(root, "projects"), fs: bundled.WrapFS(osvfs.FS())}
				p := Project{Files: map[string]string{name: "export const escaped = true"}}
				var err error
				switch entry {
				case "write":
					_, err = w.writeProject(p)
				case "tools":
					_, err = toolsWrite(w, p)
				case "compile":
					_, err = w.Compile(t.Context(), p)
				}
				if err == nil {
					t.Fatal("unsafe project path was accepted")
				}
			})
		}
	}
}
