function use() {
    return scoped(() => {
        const resource = acquireRelease(succeed(1), () => log("closed"));
        return ensuring(onExit(succeed(resource), (exit) => log(exit._tag)), log("done"));
    });
}
