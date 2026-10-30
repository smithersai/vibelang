package vibelangfmt

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
)

// PluginManifest is the name of the dprint plugin manifest in the vibelang
// package, which a dprint configuration names as npm:vibelang/dprint-plugin.json.
const PluginManifest = "dprint-plugin.json"

// dprintPlatform returns dprint's name for the platform the binary runs on.
func dprintPlatform(goos, goarch string) (string, error) {
	os := map[string]string{"linux": "linux", "darwin": "darwin", "windows": "windows"}[goos]
	arch := map[string]string{"amd64": "x86_64", "arm64": "aarch64"}[goarch]
	if os == "" || arch == "" {
		return "", fmt.Errorf("dprint has no process plugin platform for %s/%s", goos, goarch)
	}
	return os + "-" + arch, nil
}

// WritePlugin writes the dprint plugin of a vibelang package at dir, whose
// native compiler is executable: a zip archive of the compiler under the
// plugin's name, native/dprint-plugin-vibelang-<platform>.zip, and the
// manifest dir/dprint-plugin.json that names it with its checksum, for the
// platform this binary runs on. dprint runs the archive's executable with
// --parent-pid, which the compiler takes as the plugin's start.
func WritePlugin(dir, executable, version string) (string, error) {
	platform, err := dprintPlatform(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		return "", err
	}
	name := PluginName
	if runtime.GOOS == "windows" {
		name += ".exe"
	}
	archive := filepath.Join("native", PluginName+"-"+platform+".zip")
	if err := os.MkdirAll(filepath.Join(dir, "native"), 0o755); err != nil {
		return "", err
	}
	checksum, err := writeArchive(filepath.Join(dir, archive), executable, name)
	if err != nil {
		return "", err
	}
	manifest := map[string]any{
		"schemaVersion": 2,
		"kind":          "process",
		"name":          PluginName,
		"version":       version,
		platform:        map[string]string{"reference": filepath.ToSlash(archive), "checksum": checksum},
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	path := filepath.Join(dir, PluginManifest)
	return path, os.WriteFile(path, append(data, '\n'), 0o644)
}

// writeArchive writes a zip archive at path holding executable as name, and
// returns the archive's SHA-256 checksum.
func writeArchive(path, executable, name string) (string, error) {
	in, err := os.Open(executable)
	if err != nil {
		return "", err
	}
	defer in.Close()
	temporary := path + ".tmp"
	out, err := os.Create(temporary)
	if err != nil {
		return "", err
	}
	defer os.Remove(temporary)
	hash := sha256.New()
	archive := zip.NewWriter(io.MultiWriter(out, hash))
	header := &zip.FileHeader{Name: name, Method: zip.Store}
	header.SetMode(0o755)
	entry, err := archive.CreateHeader(header)
	if err == nil {
		_, err = io.Copy(entry, in)
	}
	if err == nil {
		err = archive.Close()
	}
	if closeErr := out.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return "", err
	}
	if err := os.Rename(temporary, path); err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}
