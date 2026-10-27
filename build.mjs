// Build the TUI half into `dist/tui.js`.
//
// Package installs live under node_modules, where OpenCode does not compile TSX with its
// local-plugin transform, so the bundle is shipped compiled. Host UI modules stay
// external: they must resolve to the same instances the host already loaded.
import { build } from "esbuild"
import { readFile } from "node:fs/promises"
import { transformAsync } from "@babel/core"
import typescript from "@babel/preset-typescript"
import solid from "babel-preset-solid"

export const OUT_FILE = "dist/tui.js"

export async function compile(outfile = OUT_FILE) {
  await build({
    entryPoints: ["src/tui.tsx"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "es2022",
    legalComments: "none",
    external: ["solid-js", "solid-js/*", "@opentui/*", "@opencode/plugin/*"],
    plugins: [
      {
        name: "solid-universal",
        setup(builder) {
          builder.onLoad({ filter: /\.tsx$/ }, async ({ path }) => {
            const result = await transformAsync(await readFile(path, "utf8"), {
              filename: path,
              configFile: false,
              babelrc: false,
              presets: [[solid, { moduleName: "@opentui/solid", generate: "universal" }], typescript],
            })
            return { contents: result?.code ?? "", loader: "js" }
          })
        },
      },
    ],
  })
  return outfile
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await compile()
  console.log(`built ${OUT_FILE}`)
}
