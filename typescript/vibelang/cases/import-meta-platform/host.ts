declare global { interface ImportMeta { filename: string } }
export const hostFilename = import.meta.filename
