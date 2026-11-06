declare const fs: { writeFileString(path: string, content: string): unknown };
declare const directory: string;
declare function join(...parts: string[]): string;
const files = [{ path: "index.ts", content: "export const value = 1;\n" }];
for (const file of files) fs.writeFileString(join(directory, file.path), file.content);
