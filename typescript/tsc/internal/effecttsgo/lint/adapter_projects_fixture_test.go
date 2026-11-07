package lint

import (
	"os"
	"path/filepath"

	"github.com/microsoft/TypeScript/tsc/internal/execute/tsc"
	"github.com/microsoft/TypeScript/tsc/internal/tsoptions"
	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
	"github.com/microsoft/TypeScript/tsc/internal/vfs/osvfs"
)

type lintProjectConfig struct {
	parsed *tsoptions.ParsedCommandLine
	files  map[tspath.PathKey]bool
}

// Cache project inputs across selected files. A solution's references, rather
// than its empty root list, identify the project that actually checks a file.
type projectDiscovery struct {
	fs       vfs.FS
	configs  map[string]lintProjectConfig
	extended tsc.ExtendedConfigCache
}

func (d *projectDiscovery) config(file string) lintProjectConfig {
	if d.configs == nil {
		d.configs = map[string]lintProjectConfig{}
	}
	if config, ok := d.configs[file]; ok {
		return config
	}
	name := tspath.RootedFilePath(tspath.NormalizePath(file))
	key := d.fs.CaseSensitivity().PathKey(tspath.RootedPath(name))
	parsed, _ := tsoptions.GetParsedCommandLineOfConfigFilePath(name, key, nil, nil, d.fs, &d.extended)
	config := lintProjectConfig{parsed: parsed, files: map[tspath.PathKey]bool{}}
	if parsed != nil {
		for _, name := range parsed.FileNames() {
			config.files[d.fs.CaseSensitivity().PathKey(tspath.RootedPath(name))] = true
		}
	}
	d.configs[file] = config
	return config
}

func (d *projectDiscovery) owner(configFile, file string, seen map[string]bool) string {
	configFile = filepath.Clean(configFile)
	if seen[configFile] {
		return ""
	}
	seen[configFile] = true
	config := d.config(configFile)
	if config.parsed == nil {
		return ""
	}
	key := d.fs.CaseSensitivity().PathKey(tspath.RootedPath(tspath.NormalizePath(file)))
	if config.files[key] {
		return configFile
	}
	for _, reference := range config.parsed.ResolvedProjectReferencePaths() {
		if owner := d.owner(reference.AsString(), file, seen); owner != "" {
			return owner
		}
	}
	return ""
}

func (d *projectDiscovery) nearest(file string) string {
	for dir := filepath.Dir(file); ; dir = filepath.Dir(dir) {
		candidate := projectInDirectory(dir)
		if _, err := os.Stat(candidate); err == nil {
			if owner := d.owner(candidate, file, map[string]bool{}); owner != "" {
				return owner
			}
			// Preserve the existing diagnostic for a nearby project that leaves the
			// selected file out, and let lintProject report its invalid options.
			if includes(candidate, file) {
				return candidate
			}
		}
		if parent := filepath.Dir(dir); parent == dir {
			return ""
		}
	}
}

// nearestProject keeps the compiler's per-directory config precedence.
func nearestProject(file string) string {
	discovery := projectDiscovery{fs: osvfs.FS()}
	return discovery.nearest(file)
}
