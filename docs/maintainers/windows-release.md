# Windows release additions

Windows uses `@vibelang/cli-win32-arm64` and `@vibelang/cli-win32-x64` because npm rejects the unscoped Windows names as spam. Existing macOS and Linux names stay unchanged. The release builder uses `CGO_ENABLED=0 GOOS=windows GOARCH=arm64` and `GOARCH=amd64`, `-trimpath`, and `bin/vibelang.exe`.

No packages were published for this change. Will must have publish access to the `@vibelang` scope. Cut a new unpublished version with the usual release process; do not overwrite an existing compiler tarball. Build and pack normally, without `VIBELANG_SKIP=win32`. The manifest already places both Windows packages before `vibelang`, and `publish.sh` already supplies `--access public`.

The exact additional publications, where VERSION is the new release version, are:

```sh
npm publish "dist-npm/tarballs/vibelang-cli-win32-arm64-${VERSION}.tgz" --access public
npm publish "dist-npm/tarballs/vibelang-cli-win32-x64-${VERSION}.tgz" --access public
```

The `vibelang` tarball must include these optional dependencies at the same version:

```json
{
  "@vibelang/cli-win32-arm64": "<VERSION>",
  "@vibelang/cli-win32-x64": "<VERSION>"
}
```

Its dprint manifest must use `npm:@vibelang/cli-win32-arm64@<VERSION>/bin/vibelang.exe` and the x64 equivalent, with the packed tarballs' SHA-256 checksums; `make-packages.mjs` generates both. Existing checksum mismatch protection stays enabled. After publication, update the installation pages that currently describe Windows as unpublished and verify both registry installs.

`scripts/release/windows-smoke.mjs <installed-project>` exercises local tarballs, compilation, emitted tests, Node's source loader, source-map file URLs, the runtime entry point and an actual idempotent `--fix` edit. Use a project path containing spaces, `#` and `%`.
