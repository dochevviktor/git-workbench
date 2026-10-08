import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { installerNames, readReleaseVersion } from './release-metadata.ts';

const execute = promisify(execFile);
const directory = resolve(process.argv[2] ?? 'release');
const container = process.env.CONTAINER_ENGINE ?? 'docker';
const uid = process.getuid?.();
const gid = process.getgid?.();
if (process.platform !== 'linux' || !uid || gid === undefined)
  throw new Error('Run the Arch package check as a non-root Linux user with Docker or Podman.');
const root = await mkdtemp(join(tmpdir(), 'workbench-arch-test-'));
try {
  for (const file of ['PKGBUILD', '.SRCINFO', installerNames(await readReleaseVersion())[0]!]) {
    await copyFile(join(directory, file), join(root, file));
    await chmod(join(root, file), 0o644);
  }
  await copyFile('LICENSE', join(root, 'LICENSE'));
  const args = [
    'run',
    '--rm',
    '--network=none',
    '--user',
    `${uid}:${gid}`,
    ...(container === 'podman' ? ['--userns=keep-id'] : []),
    '--volume',
    `${root}:/work:Z`,
    '--workdir',
    '/work',
    'archlinux:base-devel',
    'makepkg',
  ];
  // Pull separately: makepkg itself has no network and must use the exact candidate AppImage.
  await execute(container, ['pull', 'archlinux:base-devel'], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 });
  const info = await execute(container, [...args, '--printsrcinfo'], { timeout: 60000 });
  if (info.stdout !== (await readFile(join(root, '.SRCINFO'), 'utf8')))
    throw new Error(`Generated .SRCINFO differs from makepkg --printsrcinfo:\n${info.stdout}`);
  const dependencies = info.stdout
    .split('\n')
    .filter((line) => line.startsWith('\tdepends = '))
    .map((line) => line.slice('\tdepends = '.length));
  // Resolve declared runtime dependencies against Arch's repositories without installing on the host.
  await execute(
    container,
    [
      'run',
      '--rm',
      'archlinux:base-devel',
      'pacman',
      '-Sy',
      '--print',
      '--print-format',
      '%n',
      '--noconfirm',
      ...dependencies,
    ],
    { timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
  );
  const build = await execute(container, [...args, '--nodeps', '--nocheck', '--noconfirm'], {
    timeout: 300000,
    maxBuffer: 4 * 1024 * 1024,
  });
  console.info(build.stdout, build.stderr);
  const packages = (await readdir(root)).filter((file) => file.endsWith('.pkg.tar.zst'));
  if (packages.length !== 1) throw new Error('makepkg did not produce exactly one Arch package.');
  const archive = join(root, packages[0]!);
  const contents = (await execute('tar', ['-tf', archive])).stdout.split('\n');
  for (const required of [
    'usr/bin/git-workbench',
    'opt/git-workbench/git-workbench',
    'opt/git-workbench/resources/app.asar',
    'usr/share/applications/git-workbench.desktop',
    'usr/share/icons/hicolor/512x512/apps/git-workbench.png',
    'usr/share/licenses/git-workbench-bin/LICENSE',
  ])
    if (!contents.includes(required)) throw new Error(`Arch package is missing ${required}.`);
  const sandbox = (await execute('tar', ['-tvf', archive, 'opt/git-workbench/chrome-sandbox'])).stdout;
  if (!/^-rwsr-xr-x\s+root\/root\s/u.test(sandbox))
    throw new Error('Arch package must preserve the root-owned SUID sandbox helper.');
  console.info(
    'Verified Arch metadata, dependency resolution, source checksums, makepkg output and sandbox helper permissions.',
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
