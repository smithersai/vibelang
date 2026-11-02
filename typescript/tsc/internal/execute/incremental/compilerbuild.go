package incremental

import (
	"bytes"
	"debug/elf"
	"os"
	"sync"
)

// CompilerBuild names the compiler binary that is running: its Go build ID,
// which changes whenever the compiled code does. A build info records it, so
// a cached check from one VibeLang compiler is not reused by another that
// reports the same TypeScript version (foldkit-123: a toolchain switch kept
// a warm cache's exit 0 where a fresh check reports EK4402). It is "" when
// the binary carries no build ID.
var CompilerBuild = sync.OnceValue(func() string {
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	return goBuildID(exe)
})

// goBuildID reads the Go build ID of the executable at path, as `go tool
// buildid` does: from the .note.go.buildid note on ELF, and otherwise from the
// "\xff Go build ID: " marker the linker writes near the start of the text.
func goBuildID(path string) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	if file, err := elf.NewFile(f); err == nil {
		if section := file.Section(".note.go.buildid"); section != nil {
			if data, err := section.Data(); err == nil && len(data) >= 12 {
				nameSize, descSize := file.ByteOrder.Uint32(data[0:]), file.ByteOrder.Uint32(data[4:])
				start := 12 + (uint64(nameSize)+3)&^3
				if end := start + uint64(descSize); end <= uint64(len(data)) {
					return string(data[start:end])
				}
			}
		}
	}
	head := make([]byte, 32<<10)
	n, _ := f.ReadAt(head, 0)
	const marker = "\xff Go build ID: \""
	if i := bytes.Index(head[:n], []byte(marker)); i >= 0 {
		rest := head[i+len(marker) : n]
		if j := bytes.IndexByte(rest, '"'); j >= 0 {
			return string(rest[:j])
		}
	}
	return ""
}
