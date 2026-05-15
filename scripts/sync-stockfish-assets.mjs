import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = [
  ["node_modules/stockfish/bin/stockfish-18-lite-single.js", "public/stockfish-18-lite-single.js"],
  ["node_modules/stockfish/bin/stockfish-18-lite-single.wasm", "public/stockfish-18-lite-single.wasm"],
];

await mkdir(resolve(root, "public"), { recursive: true });

for (const [from, to] of assets) {
  await copyFile(resolve(root, from), resolve(root, to));
}
