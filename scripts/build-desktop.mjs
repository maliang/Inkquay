import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
if (!existsSync(path.join(root, 'software/dist/index.html'))) {
  console.error('缺少 software/dist，请先运行 pnpm build');
  process.exit(1);
}
await build({
  entryPoints: [path.join(root, 'software/src/server/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  outfile: path.join(root, 'desktop/server.cjs'),
  external: ['node:sqlite'],
  logLevel: 'info',
  sourcemap: false,
});
console.log('desktop/server.cjs ready');
