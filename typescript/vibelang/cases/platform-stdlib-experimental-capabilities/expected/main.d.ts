import { Experimental } from "vibelang-runtime";
export type Capabilities = [
    typeof Experimental.MediaQuery.MediaQuery,
    typeof Experimental.FileReader.FileReader,
    typeof Experimental.Animations.Animations,
    typeof Experimental.Document.Document,
    typeof Experimental.BrowserInfo.BrowserInfo,
    typeof Experimental.ResizeObserver.ResizeObserver
];
export {};
