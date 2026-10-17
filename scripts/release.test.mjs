import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { inspectArchive, preflight, registryVersion, tarFiles } from './release.mjs';

const expected = { name: '@zllling/pageway-agent', version: '0.1.0' };

function archive(manifestChanges = {}, fileChanges = {}) {
  const manifest = {
    ...expected,
    license: 'MIT',
    repository: { url: 'git+https://github.com/ForXd/pageway.git' },
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    dependencies: { '@zllling/pageway-protocol': '0.1.0' },
    ...manifestChanges,
  };
  const entries = {
    'package/package.json': JSON.stringify(manifest),
    'package/dist/index.js': 'export {};',
    'package/dist/index.d.ts': 'export {};',
    ...fileChanges,
  };
  const blocks = [];
  for (const [name, content] of Object.entries(entries)) {
    if (content === null) continue;
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write(data.length.toString(8).padStart(11, '0'), 124, 11);
    header[156] = 48;
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

describe('release package contract', () => {
  it('verifies published metadata, built exports and the exact artifact integrity', () => {
    const bytes = archive();
    const result = inspectArchive(bytes, expected);
    expect(result.manifest.name).toBe(expected.name);
    expect(result.integrity).toBe(`sha512-${createHash('sha512').update(bytes).digest('base64')}`);
  });

  it('rejects a version different from the source manifest', () => {
    expect(() => inspectArchive(archive({ version: '0.2.0' }), expected)).toThrow();
  });

  it('rejects source-only exports and leaked development conditions', () => {
    expect(() =>
      inspectArchive(
        archive({
          exports: { '.': { development: './dist/index.js', import: './dist/index.js' } },
        }),
        expected,
      ),
    ).toThrow(/Development condition/);
    expect(() =>
      inspectArchive(
        archive({ exports: './src/index.ts' }, { 'package/src/index.ts': 'export {};' }),
        expected,
      ),
    ).toThrow(/development TypeScript/);
  });

  it('allows exported CSS while ensuring that CSS exists in the archive', () => {
    const exports = { '.': './dist/index.js', './styles.css': './src/styles.css' };
    expect(() =>
      inspectArchive(archive({ exports }, { 'package/src/styles.css': '.pw-chat {}' }), expected),
    ).not.toThrow();
    expect(() => inspectArchive(archive({ exports }), expected)).toThrow(/Export target missing/);
  });

  it('rejects a missing declaration entry point', () => {
    expect(() =>
      inspectArchive(archive({}, { 'package/dist/index.d.ts': null }), expected),
    ).toThrow(/Missing built/);
  });

  it.each(['workspace:*', 'link:../protocol', 'file:../protocol'])(
    'rejects unresolved dependency %s',
    (dependency) => {
      expect(() =>
        inspectArchive(
          archive({ dependencies: { '@zllling/pageway-protocol': dependency } }),
          expected,
        ),
      ).toThrow(/Unresolved dependency/);
    },
  );

  it('rejects an internal dependency from another release', () => {
    expect(() =>
      inspectArchive(archive({ dependencies: { '@zllling/pageway-protocol': '0.0.9' } }), expected),
    ).toThrow(/fixed release version/);
  });

  it.each([
    'package/.env',
    'package/.env.production',
    'package/.npmrc',
    'package/dist/secret.test.js',
  ])('rejects accidental private/test content: %s', (path) => {
    expect(() => inspectArchive(archive({}, { [path]: 'do not publish' }), expected)).toThrow(
      /Unexpected private or test file/,
    );
  });

  it('rejects tar path traversal before extraction', () => {
    expect(() => tarFiles(archive({}, { 'package/../outside': 'unsafe' }))).toThrow(
      /Unsafe package archive path/,
    );
  });

  it('fails before querying git when the release tag does not match source versions', async () => {
    await expect(preflight('v99999.0.0')).rejects.toThrow(/Release tag must exactly match/);
  });
});

describe('release retries', () => {
  const entry = { ...expected, integrity: 'sha512-reviewed-package' };

  it('treats only a registry 404 as an unpublished version', async () => {
    const fetchRegistry = vi.fn(async () => new Response('missing', { status: 404 }));
    await expect(registryVersion(entry, fetchRegistry)).resolves.toBeNull();
    expect(fetchRegistry).toHaveBeenCalledWith(
      'https://registry.npmjs.org/%40zllling%2Fpageway-agent/0.1.0',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([401, 403, 429, 500, 503])('fails closed for registry HTTP %s', async (status) => {
    await expect(
      registryVersion(entry, async () => new Response('unavailable', { status })),
    ).rejects.toThrow(`HTTP ${status}`);
  });

  it('fails closed for a transport failure', async () => {
    await expect(
      registryVersion(entry, async () => {
        throw new Error('Network unavailable');
      }),
    ).rejects.toThrow('Network unavailable');
  });

  it('permits a retry to skip an already published identical artifact', async () => {
    const published = { ...expected, dist: { integrity: entry.integrity } };
    await expect(registryVersion(entry, async () => Response.json(published))).resolves.toEqual(
      published,
    );
  });

  it.each(['sha512-other-package', undefined])(
    'rejects existing versions with mismatched or absent integrity: %s',
    async (integrity) => {
      await expect(
        registryVersion(entry, async () => Response.json({ ...expected, dist: { integrity } })),
      ).rejects.toThrow(/already published with different bytes/);
    },
  );
});
