package vibelangmapper

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
)

// A service's key, and the brand its shape carries, name the module that
// declares it: "app/src/users#Users" (D45). The fork computes the module
// part from the program (internal/vibelang/services.go, key): the nearest
// ancestor directory with a package.json gives the prefix, its name or else
// the directory's own, and the module path is the file's path within that
// directory without .vibe. The mapper reads the same package.json files
// from disk, so the projection stays a function of the text and this
// context, and reports those files to TypeScript as watched files, so that
// renaming a package projects every file again.

// FileContextOf returns the context of the .vibe file at fileName, an
// absolute path with forward slashes, reading package.json files from disk.
func FileContextOf(fileName string) FileContext {
	return FileContext{FileName: fileName, ModuleKey: moduleKey(fileName, os.ReadFile)}
}

// moduleKey returns the module part of the service keys declared in the file
// at fileName, using read to load package.json files. A file outside every
// package uses its base name, where the fork uses its path from the
// program's common source directory, which a per-file mapper cannot know.
func moduleKey(fileName string, read func(string) ([]byte, error)) string {
	module := strings.TrimSuffix(fileName, tspath.VibeLangSourceExtension(fileName))
	for dir := path.Dir(fileName); ; dir = path.Dir(dir) {
		if data, err := read(path.Join(dir, "package.json")); err == nil {
			prefix := path.Base(dir)
			if name := packageName(data); name != "" {
				prefix = name
			}
			return prefix + "/" + strings.TrimPrefix(module, strings.TrimSuffix(dir, "/")+"/")
		}
		if parent := path.Dir(dir); parent == dir {
			break
		}
	}
	return path.Base(module)
}

// packageName returns the name field of a package.json, or "".
func packageName(data []byte) string {
	var manifest struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(data, &manifest) != nil {
		return ""
	}
	return manifest.Name
}

// maxWatchedDirectories bounds the walk for package.json files under a
// project's directory.
const maxWatchedDirectories = 4096

// projectPackageFiles returns the package.json files whose names can enter
// the module keys of a project configured by configFileName: one in every
// directory from the configuration's up to the root, existing or not, and
// every one below it outside node_modules and hidden directories. It also
// returns an identity that changes when any of them appears, disappears, or
// is renamed.
func projectPackageFiles(configFileName string) (files []string, identity string) {
	if configFileName == "" {
		return nil, "no-config"
	}
	root := path.Dir(filepath.ToSlash(configFileName))
	for dir := root; ; dir = path.Dir(dir) {
		files = append(files, path.Join(dir, "package.json"))
		if parent := path.Dir(dir); parent == dir {
			break
		}
	}
	visited := 0
	_ = filepath.WalkDir(filepath.FromSlash(root), func(name string, entry fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if entry.IsDir() {
			visited++
			base := entry.Name()
			if visited > maxWatchedDirectories || filepath.ToSlash(name) != root && (base == "node_modules" || strings.HasPrefix(base, ".")) {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.Name() == "package.json" && path.Dir(filepath.ToSlash(name)) != root {
			files = append(files, filepath.ToSlash(name))
		}
		return nil
	})
	slices.Sort(files)
	files = slices.Compact(files)
	hash := sha256.New()
	for _, file := range files {
		hash.Write([]byte(file))
		hash.Write([]byte{0})
		if data, err := os.ReadFile(filepath.FromSlash(file)); err == nil {
			hash.Write([]byte("name:" + packageName(data)))
		} else {
			hash.Write([]byte("absent"))
		}
		hash.Write([]byte{0})
	}
	return files, hex.EncodeToString(hash.Sum(nil)[:16])
}

// The forms table pins the declarations it was generated from (forms.go,
// Header.Inputs). Lambda forms, by-name arguments, and block placements
// follow the table, so a project that resolves another version of effect or
// of an @effect package may get the wrong ones without any other sign.
// openProject reports each such package once, as a diagnostic on the
// mapper's entry in the project's tsconfig.

// installedVersions returns, for each package in names, the version of the
// copy that a file in dir resolves: the first node_modules/<name> on the
// way up, read by read. A package found nowhere is absent.
func installedVersions(dir string, names []string, read func(string) ([]byte, error)) map[string]string {
	found := map[string]string{}
	for _, name := range names {
		for d := dir; ; d = path.Dir(d) {
			if data, err := read(path.Join(d, "node_modules", name, "package.json")); err == nil {
				var manifest struct {
					Version string `json:"version"`
				}
				if json.Unmarshal(data, &manifest) == nil && manifest.Version != "" {
					found[name] = manifest.Version
				}
				break
			}
			if parent := path.Dir(d); parent == d {
				break
			}
		}
	}
	return found
}

// versionMismatch returns the message of the diagnostic for a project in
// dir whose installed effect or @effect packages differ from the versions
// the forms table pins, or "" when they agree or none is installed.
func versionMismatch(header Header, dir string, read func(string) ([]byte, error)) string {
	pinned := map[string]string{}
	var names []string
	for _, input := range header.Inputs {
		if input.Package == "effect" || strings.HasPrefix(input.Package, "@effect/") {
			pinned[input.Package] = input.Version
			names = append(names, input.Package)
		}
	}
	slices.Sort(names)
	installed := installedVersions(dir, names, read)
	var differ []string
	for _, name := range names {
		if version, ok := installed[name]; ok && version != pinned[name] {
			differ = append(differ, name+" "+version+" (the table pins "+pinned[name]+")")
		}
	}
	if len(differ) == 0 {
		return ""
	}
	return "vibelang-ts-mapper's forms table was generated from other versions than this project installs: " +
		strings.Join(differ, ", ") + ". Lambda forms, by-name arguments, and block placements follow the table, so some may be wrong. " +
		"Install the pinned versions, or a vibelang-ts-mapper whose table was generated from these."
}
