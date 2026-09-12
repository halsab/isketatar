import { readFile, readdir, writeFile } from 'node:fs/promises';

const packages = new Map();
async function collect(name) {
  if (packages.has(name)) return;
  const directory = `node_modules/${name}`;
  const info = JSON.parse(await readFile(`${directory}/package.json`, 'utf8'));
  const license = (await readdir(directory)).find(file => /^licen[cs]e(?:\.(?:md|txt))?$/iu.test(file));
  if (!license) throw new Error(`Missing license: ${name}`);
  packages.set(name, `${name} ${info.version}\n\n${await readFile(`${directory}/${license}`, 'utf8')}`);
  for (const dependency of Object.keys(info.dependencies ?? {})) await collect(dependency);
}
// Ajv используется в собранных валидаторах, хотя генератор относится к devDependencies.
for (const name of ['react', 'react-dom', 'react-router-dom', 'idb', 'ajv']) await collect(name);
await writeFile('public/licenses/ThirdParty.txt', [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([, notice]) => notice).join('\n\n----------------------------------------\n\n'));
