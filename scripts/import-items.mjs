// Node.js + Git. Downloads item JSON only; icon existence comes from the Git tree.
import { execFileSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { itemName } from './item-name.mjs';

const source = 'https://github.com/EXBO-Studio/stalzone-database';
const revision = process.argv[2] ?? '33e2c75254c6fdb41221d7ca5310f9838b74d244';
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected full Git commit SHA');
const temp = await mkdtemp(join(tmpdir(), 'zone-items-'));
const repo = join(temp, 'database');
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
try {
  execFileSync('git', ['clone', '--filter=blob:none', '--no-checkout', `${source}.git`, repo], { stdio: 'inherit' });
  git('sparse-checkout', 'set', 'ru/items');
  git('checkout', '--detach', revision);
  const paths = git('ls-tree', '-r', '--name-only', revision).trim().split('\n');
  const icons = new Set(paths.filter(path => path.startsWith('ru/icons/')));
  const items = [];
  let translated = 0, text = 0;
  async function visit(directory) {
    for (const entry of await readdir(join(repo, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`;
      // _variants contains upgrades of the same ID, not additional items.
      if (entry.isDirectory()) { if (entry.name !== '_variants') await visit(path); continue; }
      if (!path.endsWith('.json')) continue;
      const item = JSON.parse(await readFile(join(repo, path), 'utf8'));
      const name = itemName(item.name);
      const id = entry.name.slice(0, -5);
      if (item.id !== id) throw new Error(`ID mismatch: ${path}`);
      if (item.name.type === 'translation') translated++; else text++;
      const icon = path.replace('ru/items/', 'ru/icons/').replace(/\.json$/, '.png');
      items.push({ id, name: name.trim(), category: item.category ?? directory.slice('ru/items/'.length),
        iconUrl: icons.has(icon) ? `https://raw.githubusercontent.com/EXBO-Studio/stalzone-database/${revision}/${icon}` : null });
    }
  }
  await visit('ru/items');
  items.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  if (new Set(items.map(item => item.id)).size !== items.length) throw new Error('Duplicate IDs');
  const output = fileURLToPath(new URL('../backend/Data/items.ru.json', import.meta.url));
  await mkdir(fileURLToPath(new URL('../backend/Data/', import.meta.url)), { recursive: true });
  const catalog = { source, catalogRevision: revision, sourceDate: git('show', '-s', '--format=%cI', revision).trim(), region: 'RU', items };
  await writeFile(output, JSON.stringify(catalog) + '\n');
  console.log(`Imported ${items.length} items (${translated} translation, ${text} text); ${items.filter(i => !i.iconUrl).length} without icons. Revision ${revision}`);
} finally {
  await rm(temp, { recursive: true, force: true });
}
