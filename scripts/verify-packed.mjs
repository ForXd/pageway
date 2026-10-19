import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { output, packPackages, root, run } from './release.mjs';

export async function verifyPacked() {
  const packed = await packPackages();
  const requireApp = createRequire(join(root, 'apps/playground/package.json'));
  const requireRoot = createRequire(join(root, 'package.json'));
  const installedVersion = async (requireFrom, name) =>
    JSON.parse(await readFile(requireFrom.resolve(`${name}/package.json`), 'utf8')).version;
  const currentReact = Object.fromEntries(
    await Promise.all(
      ['react', 'react-dom', '@types/react', '@types/react-dom'].map(async (name) => [
        name,
        await installedVersion(requireApp, name),
      ]),
    ),
  );
  // Exercise the minimum peer version, the last 18.2/18.3 releases, and the
  // development application's React version. Each install has its own React
  // and declarations; workspace resolution cannot accidentally test React 19.
  const matrix = [
    ...['18.0.0', '18.2.0', '18.3.1'].map((version) => ({
      react: version,
      'react-dom': version,
      '@types/react': version === '18.0.0' ? '18.0.0' : '18.3.31',
      '@types/react-dom': version === '18.0.0' ? '18.0.0' : '18.3.7',
      // The original React 18 declarations import scheduler/tracing, which was
      // removed from later scheduler declarations.
      ...(version === '18.0.0' ? { '@types/scheduler': '0.16.8' } : {}),
    })),
    currentReact,
  ];
  const packageDependencies = Object.fromEntries(
    packed.map((entry) => [
      entry.name,
      `file:${join(output, entry.filename).replaceAll('\\', '/')}`,
    ]),
  );
  const jsdom = await installedVersion(requireRoot, 'jsdom');
  const compiler = join(dirname(requireRoot.resolve('typescript/package.json')), 'bin', 'tsc');
  for (const reactDependencies of matrix) {
    const consumer = await mkdtemp(join(tmpdir(), `pageway-react-${reactDependencies.react}-`));
    try {
      console.log(`Checking published packages with React ${reactDependencies.react}...`);
      const dependencies = { ...packageDependencies, ...reactDependencies, jsdom };
      await writeFile(
        join(consumer, 'package.json'),
        JSON.stringify({ private: true, type: 'module', dependencies }, null, 2),
      );
      // All Pageway packages are direct file dependencies: unpublished workspace
      // versions are resolved together from these tarballs, never from the registry.
      run(
        'npm',
        [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--package-lock=false',
          '--strict-peer-deps',
          '--legacy-peer-deps=false',
          '--registry',
          'https://registry.npmjs.org',
        ],
        consumer,
      );
      for (const filename of ['packed-runtime.mjs', 'packed-client.mjs', 'packed-types.tsx'])
        await copyFile(join(root, 'scripts/fixtures', filename), join(consumer, filename));
      run(process.execPath, ['--conditions=development', 'packed-runtime.mjs'], consumer);
      run(process.execPath, ['--conditions=development', 'packed-client.mjs'], consumer);
      // The first React 18 declarations predate NodeNext-compatible export
      // mapping for react/jsx-runtime. Validate those with Vite's resolution.
      const originalTypes = reactDependencies['@types/react'] === '18.0.0';
      run(
        process.execPath,
        [
          compiler,
          '--noEmit',
          '--strict',
          '--module',
          originalTypes ? 'ESNext' : 'NodeNext',
          '--moduleResolution',
          originalTypes ? 'Bundler' : 'NodeNext',
          '--target',
          'ES2022',
          '--lib',
          'ES2022,DOM,DOM.Iterable',
          '--jsx',
          'react-jsx',
          '--skipLibCheck',
          'false',
          'packed-types.tsx',
        ],
        consumer,
      );
    } finally {
      await rm(consumer, { recursive: true, force: true });
    }
  }
  console.log(
    `Verified ${packed.length} published packages with React ${matrix.map((entry) => entry.react).join(', ')}. Tarballs: ${output}`,
  );
  return packed;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPacked().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
