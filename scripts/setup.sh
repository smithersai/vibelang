#!/bin/sh
# Local, unpublished packages. BUN_CREATE_DIR and VIBELANG_BIN_DIR let tests
# isolate template and launcher installation without changing HOME.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
for tool in go bun node; do
  command -v "$tool" >/dev/null 2>&1 || { echo "setup: install $tool and rerun sh scripts/setup.sh" >&2; exit 1; }
done
echo "setup: Node $(node --version), Bun $(bun --version), $(go version)"
sh "$root/scripts/build-vibelang.sh"

if [ -f "$root/packages/runtime/package.json" ]; then
  echo "setup: install runtime dependencies"
  (cd "$root/packages/runtime" && bun install)
  if node --input-type=module -e 'import fs from "node:fs"; process.exit(JSON.parse(fs.readFileSync(process.argv[1])).scripts?.build ? 0 : 1)' "$root/packages/runtime/package.json"; then
    echo "setup: build runtime"
    (cd "$root/packages/runtime" && bun run build)
  else
    echo "setup: runtime has no build script; using its declared exports"
  fi
  # Projects install this tarball, not the directory: bun links a directory's
  # files into the checkout, where Node resolves the runtime's own effect, and
  # two copies of effect let a Scope miss the fibers it must stop.
  echo "setup: pack runtime"
  (cd "$root/packages/runtime" && bun pm pack --quiet --filename "$root/packages/runtime/vibelang-runtime.tgz" >/dev/null)
else
  echo "setup: WARNING: packages/runtime is absent. The compiler is ready; projects need packages/runtime before they can install." >&2
fi

node "$root/scripts/install-template.mjs"

bin_dir=${VIBELANG_BIN_DIR:-$HOME/.local/bin}
case ":$PATH:" in
  *":$bin_dir:"*)
    mkdir -p "$bin_dir"
    launcher="$root/packages/compiler/bin/vibelang"
    for name in vibe vibelang; do
      link="$bin_dir/$name"
      if [ -L "$link" ]; then
        # A link to a moved or deleted checkout, or to another checkout's
        # launcher, is one an earlier setup made: point it here.
        previous=$(readlink "$link")
        case "$previous" in
          "$launcher") ;;
          */packages/compiler/bin/vibelang) ln -sfn "$launcher" "$link"; echo "setup: linked $link (it pointed to $previous)" ;;
          *)
            if [ -e "$link" ]; then
              echo "setup: preserving existing $link; use the project's bun run build"
            else
              ln -sfn "$launcher" "$link"
              echo "setup: linked $link (it pointed to the missing $previous)"
            fi
            ;;
        esac
      elif [ -e "$link" ]; then
        echo "setup: preserving existing $link; use the project's bun run build"
      else
        ln -s "$launcher" "$link"
        echo "setup: linked $link"
      fi
    done
    ;;
  *)
    echo "setup: $bin_dir is not on PATH. Project scripts find vibelang after bun install."
    echo "setup: for a global command, add $bin_dir to PATH and rerun setup."
    ;;
esac

if [ -f "$root/editors/vscode/package.json" ]; then
  echo "setup: build VS Code extension"
  (cd "$root/editors/vscode" && bun install && bun run build)
  # Prefer the package's own packaging script when available.
  if node --input-type=module -e 'import fs from "node:fs"; process.exit(JSON.parse(fs.readFileSync(process.argv[1])).scripts?.package ? 0 : 1)' "$root/editors/vscode/package.json"; then
    (cd "$root/editors/vscode" && bun run package)
  else
    (cd "$root/editors/vscode" && bunx @vscode/vsce@4.0.0 package --allow-missing-repository)
  fi
  find "$root/editors/vscode" -maxdepth 1 -name '*.vsix' -exec sh -c 'printf "Editor: code --install-extension \"%s\"\nCursor: cursor --install-extension \"%s\"\n" "$1" "$1"' sh {} \;
else
  echo "setup: editors/vscode is absent; rerun setup after adding editors/vscode to build its .vsix."
fi

echo "setup: local file dependencies point to $root; keep this checkout available."
echo "setup: in projects created before this run, run bun update vibelang-runtime vibelang vibelang-vite to update the runtime, compiler, and Vite integration."
printf '\nNext commands:\n  bun create vibelang my-app --no-git\n  cd my-app\n  bun run start\n'
