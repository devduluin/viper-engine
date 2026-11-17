import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isInside } from '../../scripts/lib/files.mjs';

export function withProject(files, execute) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'viper-engine-gate-'));
  try {
    for (const [name, text] of Object.entries(files)) {
      const filename = path.resolve(root, name);
      if (!isInside(root, filename)) throw new Error('Fixture path outside temporary project');
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, text);
    }
    return execute(root);
  } finally {
    const absolute = fs.realpathSync(root);
    if (!isInside(fs.realpathSync(os.tmpdir()), absolute) || !path.basename(absolute).startsWith('viper-engine-gate-')) {
      throw new Error('Refusing cleanup outside fixture directory');
    }
    fs.rmSync(absolute, { recursive: true, force: true });
  }
}
