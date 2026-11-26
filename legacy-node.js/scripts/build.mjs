import { copyFile } from 'node:fs/promises';
import { build } from 'esbuild';
await build({ entryPoints: ['src/client.ts'], bundle: true, outfile: 'public/app.js', platform: 'browser', target: 'es2022', minify: true });

await build({ entryPoints: ['src/scanner.ts'], bundle: true, outfile: 'public/scanner.js', platform: 'browser', format: 'esm', target: 'es2022', minify: true });
await copyFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm', 'public/zxing_reader.wasm');
