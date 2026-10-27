// Fail when the committed bundle does not match a fresh build of the sources.
//
// A checked-in bundle is only trustworthy if CI can prove it was produced from the
// sources in the same commit; this script is that proof.
import { readFile, rm } from "node:fs/promises"
import { compile, OUT_FILE } from "../build.mjs"

const temp = "dist/.tui.verify.js"
const built = await compile(temp)

const [committed, fresh] = await Promise.all([readFile(OUT_FILE, "utf8"), readFile(built, "utf8")])
await rm(built, { force: true })

if (committed !== fresh) {
  console.error(`dist drift: ${OUT_FILE} differs from a fresh build. Run \`npm run build\` and commit the result.`)
  process.exit(1)
}

console.log(`dist ok: ${OUT_FILE} matches a fresh build`)
