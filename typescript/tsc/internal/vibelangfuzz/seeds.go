package vibelangfuzz

import (
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
)

// A project travels through the fuzzer as one string in the txtar format:
// each file starts with a line "-- name --". Text before the first marker is
// ignored. The format keeps multi-file projects mutable by the fuzzer's byte
// mutations and readable as a crasher in testdata/fuzz.

// Archive encodes files in name order.
func Archive(files map[string]string) string {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	slices.Sort(names)
	var b strings.Builder
	for _, name := range names {
		b.WriteString("-- " + name + " --\n")
		b.WriteString(files[name])
		if !strings.HasSuffix(files[name], "\n") {
			b.WriteString("\n")
		}
	}
	return b.String()
}

var archiveMarker = regexp.MustCompile(`(?m)^-- ([^\n]+?) --$\n?`)

// Unarchive decodes an archive. A name that is not a clean relative path is
// dropped, so a mutated archive can never write outside its project.
func Unarchive(archive string) map[string]string {
	files := map[string]string{}
	markers := archiveMarker.FindAllStringSubmatchIndex(archive, -1)
	for i, m := range markers {
		end := len(archive)
		if i+1 < len(markers) {
			end = markers[i+1][0]
		}
		name := archive[m[2]:m[3]]
		if !ValidProjectPath(name) {
			continue
		}
		files[name] = archive[m[1]:end]
	}
	return files
}

// ValidProjectPath reports whether a name is a clean, relative, slash-separated
// path that stays inside a project and outside node_modules.
func ValidProjectPath(name string) bool {
	if name == "" || strings.ContainsAny(name, "\\\x00:") || strings.HasPrefix(name, "/") || filepath.ToSlash(filepath.Clean(name)) != name {
		return false
	}
	for part := range strings.SplitSeq(name, "/") {
		if part == ".." || part == "." || part == "node_modules" || part == "out" {
			return false
		}
	}
	return true
}

// A Seed is one starting input: an acceptance case or a documentation
// snippet.
type Seed struct {
	Name  string
	Files map[string]string // includes tsconfig.json for an acceptance case
	// Codes are the EK and TS codes a failing case expects, from its
	// "// expect:" line; ExpectResult is a runnable case's JSON result.
	Codes        []string
	ExpectResult string
	// Pending is the text of a case's pending file: the compiler does not
	// meet that case's expectation yet.
	Pending string
}

// CaseSeeds returns every acceptance case in typescript/vibelang/cases: its
// sources, tsconfig.json, package.json and stubs, without expected outputs.
var CaseSeeds = sync.OnceValue(func() []Seed {
	root := filepath.Join(Root(), "typescript/vibelang/cases")
	entries, err := os.ReadDir(root)
	if err != nil {
		panic(err)
	}
	var seeds []Seed
	for _, entry := range entries {
		dir := filepath.Join(root, entry.Name())
		if _, err := os.Stat(filepath.Join(dir, "tsconfig.json")); err != nil {
			continue
		}
		seed := Seed{Name: entry.Name(), Files: map[string]string{}}
		_ = filepath.WalkDir(dir, func(name string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			rel := filepath.ToSlash(strings.TrimPrefix(name, dir+string(filepath.Separator)))
			if d.IsDir() {
				if name != dir && (d.Name() == "node_modules" || d.Name() == "out" || d.Name() == "expected" || strings.HasPrefix(d.Name(), ".")) {
					return filepath.SkipDir
				}
				return nil
			}
			if d.Type()&fs.ModeSymlink != 0 || !ValidProjectPath(rel) {
				return nil
			}
			if rel == "pending" {
				data, _ := os.ReadFile(name)
				seed.Pending = strings.TrimSpace(string(data))
				return nil
			}
			if !isSource(rel) && !strings.HasSuffix(rel, ".json") && !strings.HasSuffix(rel, ".d.ts") {
				return nil
			}
			data, err := os.ReadFile(name)
			if err != nil {
				return err
			}
			text := string(data)
			seed.Files[rel] = text
			if first, _, _ := strings.Cut(text, "\n"); strings.HasPrefix(first, "// expect:") {
				seed.Codes = append(seed.Codes, strings.Fields(strings.TrimPrefix(first, "// expect:"))...)
			}
			for line := range strings.SplitSeq(text, "\n") {
				if value, ok := strings.CutPrefix(line, "// expect-result:"); ok {
					seed.ExpectResult = strings.TrimSpace(value)
				}
			}
			return nil
		})
		seeds = append(seeds, seed)
	}
	return seeds
})

var vibeFence = regexp.MustCompile("(?ms)^[ \t]*```vibe[^\\n]*\\n(.*?)^[ \t]*```")

// SnippetSeeds returns every ```vibe block in the user guide and the
// specification, each as the source of a single main.vibe. Many snippets are
// fragments that do not compile alone; they still seed the parser and the
// checker with every form the documents show.
var SnippetSeeds = sync.OnceValue(func() []Seed {
	var seeds []Seed
	for _, dir := range append([]string{"docs/user/src"}, specDirs...) {
		root := filepath.Join(Root(), dir)
		_ = filepath.WalkDir(root, func(name string, d fs.DirEntry, err error) error {
			if err != nil || d.IsDir() || !strings.HasSuffix(name, ".md") {
				return err
			}
			data, err := os.ReadFile(name)
			if err != nil {
				return err
			}
			rel := filepath.ToSlash(strings.TrimPrefix(name, Root()+string(filepath.Separator)))
			for i, m := range vibeFence.FindAllStringSubmatch(string(data), -1) {
				seeds = append(seeds, Seed{Name: rel + "#" + strconv.Itoa(i), Files: map[string]string{"main.vibe": m[1]}})
			}
			return nil
		})
	}
	return seeds
})
