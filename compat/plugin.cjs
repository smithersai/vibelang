"use strict";

/**
 * TypeScript language-service plugin entry point.
 *
 * This is deliberately a pass-through decorator in M0. Language-service
 * plugins cannot add grammar or checker semantics, so VibeLang support must be
 * supplied by the compiler/LSP seam instead of being faked here.
 */
function init(modules) {
  const ts = modules.typescript;

  return {
    create(info) {
      info.project.projectService.logger.info(
        `[vibelang] compatibility plugin loaded with TypeScript ${ts.version}`,
      );

      const proxy = Object.create(null);
      for (const key of Object.keys(info.languageService)) {
        const value = info.languageService[key];
        proxy[key] = typeof value === "function"
          ? (...args) => value.apply(info.languageService, args)
          : value;
      }
      return proxy;
    },
    getExternalFiles() {
      return [];
    },
    onConfigurationChanged() {},
  };
}

module.exports = init;

