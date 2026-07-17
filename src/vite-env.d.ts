/// <reference types="vite/client" />

declare const __APP_VERSION__: string;

// esm subpath has no bundled .d.ts; it re-exports the editor.api surface
declare module "monaco-editor/esm/vs/editor/edcore.main";
