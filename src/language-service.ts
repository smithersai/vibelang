import type ts from "typescript-js";

export type PluginCreateInfo = ts.server.PluginCreateInfo;
export type PluginModule = ts.server.PluginModule;
export type PluginModuleFactory = ts.server.PluginModuleFactory;
export type LanguageService = ts.LanguageService;
export type LanguageServiceHost = ts.LanguageServiceHost;

export interface VibeLanguageServicePlugin extends ts.server.PluginModule {
  readonly apiVersion?: 1;
  getExternalVibeFiles?(project: ts.server.Project): readonly string[];
}

/** Create the standard decorator-shaped pass-through language service. */
export function createPassThroughLanguageService(info: PluginCreateInfo): LanguageService {
  const proxy = Object.create(null) as LanguageService;
  for (const key of Object.keys(info.languageService) as Array<keyof LanguageService>) {
    const value = info.languageService[key];
    (proxy as Record<keyof LanguageService, unknown>)[key] =
      typeof value === "function"
        ? (...args: unknown[]) => (value as (...args: unknown[]) => unknown).apply(info.languageService, args)
        : value;
  }
  return proxy;
}

export function definePlugin<T extends PluginModuleFactory>(factory: T): T {
  return factory;
}

