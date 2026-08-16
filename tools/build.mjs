import { build, context } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'dist');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  target: 'chrome116',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  logLevel: 'info',
};

// Content scripts cannot be ES modules, hence two configs rather than one.
const configs = [
  { ...shared, entryPoints: [join(root, 'src/content/index.ts')], outfile: join(out, 'content.js'), format: 'iife' },
  { ...shared, entryPoints: [join(root, 'src/background/index.ts')], outfile: join(out, 'background.js'), format: 'esm' },
  {
    ...shared,
    entryPoints: [join(root, 'src/ui/options.ts'), join(root, 'src/ui/popup.ts')],
    outdir: out,
    format: 'esm',
  },
];

async function copyStatic() {
  await cp(join(root, 'public'), out, { recursive: true });
  await cp(join(root, 'src/ui/pages.css'), join(out, 'pages.css'));
  await cp(join(root, 'src/ui/options.html'), join(out, 'options.html'));
  await cp(join(root, 'src/ui/popup.html'), join(out, 'popup.html'));
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

if (!existsSync(join(root, 'public/icons/128.png'))) {
  await import('./make-icons.mjs');
}

if (watch) {
  for (const c of configs) (await context(c)).watch();
  await copyStatic();
  console.log('watching… (re-run `npm run build` after editing html/css/manifest)');
} else {
  await Promise.all(configs.map(build));
  await copyStatic();
  console.log(`built → ${out}`);
}
