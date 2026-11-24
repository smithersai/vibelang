function run(job: Effect.Effect<number, never, never>, scope: Scope.Scope) {
    const child = fork(job);
    const owned = $forkIn(scope, job);
    const scopedChild = $forkScoped(job);
    const detached = $forkDetach(job);
    return $join(child);
}
