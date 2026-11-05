package vibelang

import (
	"slices"
	"testing"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

func TestLoaderRootArguments(t *testing.T) {
	t.Parallel()
	cwd := tspath.RootedDirectoryPath("/work/app")
	for _, test := range []struct {
		name  string
		args  []string
		rest  []string
		root  string
		error string
	}{
		{name: "absent", args: []string{"-p", "tsconfig.json"}, rest: []string{"-p", "tsconfig.json"}},
		{name: "relative", args: []string{"-p", "tsconfig.json", "--loader-root", "packages/a", "--noEmit"}, rest: []string{"-p", "tsconfig.json", "--noEmit"}, root: "/work/app/packages/a"},
		{name: "absolute", args: []string{"--LOADER-ROOT", "/repo/b/", "-p", "x.json"}, rest: []string{"-p", "x.json"}, root: "/repo/b"},
		{name: "no directory", args: []string{"-p", "x.json", "--loader-root"}, error: "--loader-root needs a directory: --loader-root <directory>"},
		{name: "a flag for a directory", args: []string{"--loader-root", "--noEmit"}, error: "--loader-root needs a directory: --loader-root <directory>"},
		{name: "build mode", args: []string{"-b", "--loader-root", "."}, error: "--loader-root compiles one project; it cannot be combined with -b"},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			rest, root, err := LoaderRootArguments(test.args, cwd)
			if test.error != "" {
				if err == nil || err.Error() != test.error {
					t.Fatalf("error = %v, want %q", err, test.error)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !slices.Equal(rest, test.rest) || root != test.root {
				t.Fatalf("got %q, %q; want %q, %q", rest, root, test.rest, test.root)
			}
		})
	}
}

func TestProjectEmitArguments(t *testing.T) {
	for _, test := range []struct {
		args, want []string
		enabled    bool
	}{
		{[]string{"-p", "tsconfig.json"}, []string{"-p", "tsconfig.json"}, false},
		{[]string{"--project-emit", "-p", "tsconfig.json"}, []string{"-p", "tsconfig.json"}, true},
		{[]string{"-p", "tsconfig.json", "--PROJECT-EMIT", "--project-emit"}, []string{"-p", "tsconfig.json"}, true},
	} {
		original := slices.Clone(test.args)
		got, enabled := ProjectEmitArguments(test.args)
		if !slices.Equal(got, test.want) || enabled != test.enabled {
			t.Fatalf("got %v %v want %v %v", got, enabled, test.want, test.enabled)
		}
		if !slices.Equal(original, test.args) {
			t.Fatal("argument parser mutated the caller's slice")
		}
	}
}
