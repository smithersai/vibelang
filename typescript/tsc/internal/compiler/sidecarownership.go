package compiler

import (
	"crypto/sha256"
	"fmt"
	"strings"

	"github.com/microsoft/TypeScript/tsc/internal/tspath"
	"github.com/microsoft/TypeScript/tsc/internal/vfs"
)

// Ownership receipts are separate from public declaration text. Each project
// has its own receipt, including when several projects emit the same output,
// so recording one owner cannot overwrite another owner's claim.
func (p *Program) sidecarOwnerReceipt(sidecar string, output vfs.FS) (path, prefix string) {
	config := p.vibeSidecarOptions().ConfigFilePath
	if config == "" {
		return "", ""
	}
	// Real paths join symlinked invocations; relative identities survive moving
	// the whole project tree. The receipt contains no source or config paths.
	target := string(p.caseSensitivity.PathKey(output.Realpath(tspath.RootedPathFromNormalized(sidecar))))
	project := string(p.caseSensitivity.PathKey(output.Realpath(config.AsPath())))
	directory := tspath.GetDirectoryPath(target)
	name := fmt.Sprintf("%x", sha256.Sum256([]byte(tspath.GetBaseFileName(target))))
	owner := tspath.GetRelativePathFromDirectory(directory, project, p.caseSensitivity)
	prefix = ".vibelang-sidecar-" + name + "-"
	return tspath.CombinePaths(tspath.GetDirectoryPath(sidecar), prefix+fmt.Sprintf("%x", sha256.Sum256([]byte(owner)))+".owner"), prefix
}

func sidecarReceiptText(text string) string {
	// Source tools may include these files with a broad glob. Comments keep
	// private ownership data inert if such a tool parses it as JavaScript.
	return fmt.Sprintf("// vibelang-sidecar-owner-v1\n// %x\n", sha256.Sum256([]byte(text)))
}

func (p *Program) recordSidecarOwner(sidecar, text string, output vfs.FS) error {
	receipt, _ := p.sidecarOwnerReceipt(sidecar, output)
	if receipt == "" {
		return nil
	}
	path := tspath.RootedFilePathFromNormalized(receipt)
	contents := sidecarReceiptText(text)
	if existing, ok := output.ReadFile(path); ok && existing == contents {
		return nil
	}
	return output.WriteFile(path, contents)
}

func (p *Program) pruneOwnedSidecar(sidecar string, output vfs.FS) error {
	receipt, prefix := p.sidecarOwnerReceipt(sidecar, output)
	if receipt == "" {
		return nil
	}
	path := tspath.RootedFilePathFromNormalized(receipt)
	owned, ok := output.ReadFile(path)
	if !ok {
		// A matching name is not evidence of ownership.
		return nil
	}
	directory := tspath.GetDirectoryPath(sidecar)
	for _, name := range output.GetAccessibleEntries(tspath.RootedDirectoryPathFromNormalized(directory)).Files {
		if name != tspath.GetBaseFileName(receipt) && strings.HasPrefix(name, prefix) && strings.HasSuffix(name, ".owner") {
			return output.Remove(path.AsPath())
		}
	}
	target := tspath.RootedFilePathFromNormalized(sidecar)
	if text, exists := output.ReadFile(target); exists && (owned == sidecarReceiptText(text) || owned == strings.ReplaceAll(sidecarReceiptText(text), "// ", "")) {
		if err := output.Remove(target.AsPath()); err != nil {
			return err
		}
	}
	// Keep the receipt when removal fails, so the next check can retry.
	if err := output.Remove(path.AsPath()); err != nil {
		return err
	}
	p.pruneSidecarDirectories(directory, output)
	return nil
}
