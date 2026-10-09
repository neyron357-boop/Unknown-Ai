// Builds a self-contained single-file version of the game (everything inline) for hosting
// as a page without a server — e.g. a claude.ai Artifact. No service worker, ECHO in demo mode.
// Usage: npm run build:artifact [-- out/file.html]
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.resolve(process.argv[2] ?? path.join(root, 'dist-artifact', 'unknown-ascension.html'));
execSync('npx vite build', { cwd: root, stdio: 'inherit', env: { ...process.env, VITE_TARGET: 'artifact' } });

const dist = path.join(root, 'dist-artifact');
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const js = [...html.matchAll(/<script type="module" crossorigin src="\.\/([^"]+)"><\/script>/g)].map((m) => m[1]);
const css = [...html.matchAll(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)">/g)].map((m) => m[1]);
if (js.length !== 1) throw new Error(`expected one entry script, found ${js.length}`);

// `</script` inside the bundle would end the inline tag early.
const script = readFileSync(path.join(dist, js[0]), 'utf8').replace(/<\/script/gi, '<\\/script');
const styles = css.map((f) => readFileSync(path.join(dist, f), 'utf8')).join('\n');

// The host wraps the page in its own <!doctype><html><head><body> skeleton.
const page = `<title>UNKNOWN: ASCENSION</title>
<style>
${styles}
</style>
<div id="root"></div>
<script type="module">
${script}
</script>
`;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, page);
console.log(`artifact page → ${out} (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
