import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
const publicFiles = ['index.html', 'app.js', 'store.js', 'lib.js', 'meals.js', 'config.js', 'styles.css', 'sw.js', 'manifest.webmanifest', '.nojekyll', 'assets'];
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
for (const file of publicFiles) await cp(file, 'dist/' + file, { recursive: true });
await writeFile('dist/version.json', JSON.stringify({ version: '1.2.0', commit: process.env.GITHUB_SHA || 'local', builtAt: new Date().toISOString() }) + '\n');
console.log('Built Family Hub: only public app files included.');
