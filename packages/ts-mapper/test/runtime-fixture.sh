# Build the checkout runtime in private scratch. Its lockfile provisions
# platform and experimental imports along with the rest of the runtime.
build_runtime_fixture() {
  local source=$1 build=$2 runtime=$3 compiler=$4
  mkdir -p "$build" "$runtime"
  cp -R "$source/src" "$source/tsconfig.json" "$source/package.json" "$source/bun.lock" "$build/"
  (cd "$build" && bun install --frozen-lockfile --ignore-scripts)
  "$compiler" -p "$build/tsconfig.json" --outDir "$runtime/dist"
  cp "$source/package.json" "$runtime/"
}
