# Real missing-package graph runs

These results and logs were captured on 2026-11-02 using Node 26.5.0 and the
repository's pinned Smithers CLI. Only absolute fixture paths were scrubbed to
`<fixture>`. Both executions have key
`db27a297c8772802bf5ca334b2a04dd91b66793f26d957513c7e026f246148b4`.

`run-01` imported the installed local `ci-health-local-dependency` package.
`run-02` ran the same target after that package directory was removed. The
import failed with Node's real `ERR_MODULE_NOT_FOUND` diagnostic. No target
status, key, duration or diagnostic was fabricated.

To reproduce in a scratch directory, copy the repository's
`.smithers/WORKSPACE.ts` and `.smithers/package.json`, link its
`.smithers/node_modules`, then create this `PACKAGE.ts`:

```ts
import { Smithers as S } from "@smthrs/targets"
export const Package = S.Package({ targets: {
  dependency: S.Shell.Test({
    summary: "Import a provisioned local dependency",
    shell: "node importer.mjs",
    data: [S.file("importer.mjs")],
    tools: [S.Host.bin("node")],
    sandbox: "none",
    timeout: "30s"
  })
} })
```

Write `import "ci-health-local-dependency"` in `importer.mjs`.
Create `node_modules/ci-health-local-dependency/package.json` with
`{"name":"ci-health-local-dependency","type":"module","exports":"./index.mjs"}`
and `index.mjs` with `console.log("dependency installed")`.

Run `smthrs ci //:dependency --workspace <scratch> --no-cache --jobs 8 --verbose --ui plain --results-file <new-results-file>`
before and after removing only that package directory, saving the logs beside
the results as `<id>-graph.log`. The dependency is deliberately provisioned
outside the declared inputs, modeling a missing install in a validation box.

The sibling `overflow-missing-package.log` is a minimized real
`TestDataMethodCandidateCoverage` failure from a 2026-11-02 validation run:
the box could not import `effect` from `/work/packages/runtime/`. It motivates
the classifier fix; this change does not repair the validation provider.
