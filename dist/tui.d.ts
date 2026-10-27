/**
 * Types for the compiled TUI bundle (`dist/tui.js`).
 *
 * The bundle is produced from `src/tui.tsx` by `build.mjs`; the root `tui.tsx` shim
 * re-exports it so local plugin directories load the Solid-compiled file instead of
 * asking OpenCode to transpile TSX with its generic (react) JSX runtime.
 */
declare const plugin: unknown
export default plugin
