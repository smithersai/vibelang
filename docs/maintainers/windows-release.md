# Windows release additions

Windows uses `@smthrs/cli-win32-arm64` and `@smthrs/cli-win32-x64` because npm rejects the unscoped Windows names as spam. Existing macOS and Linux names stay unchanged. The release builder uses `CGO_ENABLED=0 GOOS=windows GOARCH=arm64` and `GOARCH=amd64`, `-trimpath`, and `bin/vibelang.exe`.

The release maintainer needs publish access to the `@smthrs` scope. Build and pack a new unpublished version with the usual release process and include Windows in the build. The Windows archives are `smthrs-cli-win32-arm64-${VERSION}.tgz` and `smthrs-cli-win32-x64-${VERSION}.tgz`. `scripts/release/publish.sh` publishes them in manifest order before `vibelang` with public access.

The `vibelang` tarball must include these optional dependencies at the same version:

```json
{
  "@smthrs/cli-win32-arm64": "<VERSION>",
  "@smthrs/cli-win32-x64": "<VERSION>"
}
```

Its dprint manifest must use `npm:@smthrs/cli-win32-arm64@<VERSION>/bin/vibelang.exe` and the x64 equivalent, with the packed tarballs' SHA-256 checksums; `make-packages.mjs` generates both. Existing checksum mismatch protection stays enabled. After publication, verify both Windows registry installs.

`scripts/release/windows-smoke.mjs <installed-project>` checks the installed compiler's version, compiles and runs a project, tests emitted JavaScript and source loading through `vibelang/register`, and checks the source-map source path. Use a project path containing spaces, `#` and `%`. Run the optional `--vitest` check in a path without `#`.

For per-platform build completion records and silent failure diagnostics, see
[Cross-platform compiler builds](release-builds.md).
