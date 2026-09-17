import { cp, mkdir, readdir, rm } from 'node:fs/promises';

const source = new URL('../', import.meta.url);
const output = new URL('../www/', import.meta.url);
const excluded = new Set(['.git', 'android', 'ios', 'node_modules', 'test-results', 'tests', 'www', 'scripts', 'supabase', 'docs']);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const entries = await readdir(source, { withFileTypes: true });
for (const entry of entries) {
  if (excluded.has(entry.name) || (!entry.isFile() && entry.name !== 'assets')) continue;
  await cp(new URL(`../${entry.name}`, import.meta.url), new URL(`../www/${entry.name}`, import.meta.url), { recursive: entry.isDirectory() });
}
console.log('Arquivos do aplicativo atualizados em www.');
