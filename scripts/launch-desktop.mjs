import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(process.execPath, [
  path.join(root, 'node_modules/electron/cli.js'),
  path.join(root, 'desktop/main.cjs'),
], { cwd: root, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
