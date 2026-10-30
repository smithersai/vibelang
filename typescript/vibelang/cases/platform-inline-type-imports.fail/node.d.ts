declare module "node:fs" { export interface Stats { size: number } }
declare module "fs" { export interface Stats { size: number } }
declare module "node:path" {}
