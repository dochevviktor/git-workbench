import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';

/** Derive attribution from the modules actually shipped, not the development dependency tree. */
export function dependencyNotices(): Plugin {
  return {
    name: 'bundled-dependency-notices',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const packages = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const moduleId of Object.keys(output.modules)) {
          const normalized = moduleId.replaceAll('\\', '/');
          const match = /^(.*\/node_modules\/(?:@[^/]+\/)?[^/]+)\//u.exec(normalized);
          if (match?.[1]) packages.add(match[1].replace(/^\0/u, ''));
        }
      }
      const dependencies: { name: string; version: string; license: string }[] = [];
      const notices: string[] = ['Git Workbench — bundled JavaScript dependency notices\n'];
      for (const directory of [...packages].sort()) {
        const metadata = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as {
          name: string;
          version: string;
          license: string;
        };
        const files = (await readdir(directory)).filter((file) =>
          /^(licen[cs]e|copying|notice)(\.|$)/iu.test(file),
        );
        if (!files.length) throw new Error(`Missing license text for bundled package ${metadata.name}.`);
        dependencies.push({ name: metadata.name, version: metadata.version, license: metadata.license });
        notices.push(`\n${metadata.name} ${metadata.version} (${metadata.license})\n`);
        for (const file of files.sort()) notices.push(await readFile(join(directory, file), 'utf8'));
      }
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: notices.join('\n') });
      this.emitFile({
        type: 'asset',
        fileName: 'bundled-dependencies.json',
        source: JSON.stringify(dependencies, null, 2) + '\n',
      });
    },
  };
}
