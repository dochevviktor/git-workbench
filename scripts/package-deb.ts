import { readFile } from 'node:fs/promises';
import { build, Platform } from 'electron-builder';
import type { Configuration } from 'electron-builder';

// Real release contact is supplied explicitly. A marked fixture package supports local install tests.
const fixture = process.argv.includes('--test-metadata');
const maintainer = fixture
  ? 'Git Workbench packaging test <packaging@example.invalid>'
  : process.env.GIT_WORKBENCH_MAINTAINER;
if (!maintainer || !/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>$/u.test(maintainer)) {
  throw new Error(
    'Set GIT_WORKBENCH_MAINTAINER to "Public Name <public@example.org>" for a release deb, or use --test-metadata for a clearly marked installation-test package.',
  );
}
const base = JSON.parse(await readFile('electron-builder.json', 'utf8')) as Configuration;
await build({
  targets: Platform.LINUX.createTarget('deb'),
  publish: 'never',
  config: {
    ...base,
    linux: { ...base.linux, maintainer },
    deb: {
      ...base.deb,
      ...(fixture ? { artifactName: '${productName}-${version}-${arch}.TEST-ONLY.deb' } : {}),
    },
  },
});
