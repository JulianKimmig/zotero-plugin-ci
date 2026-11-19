/** Stage only explicitly declared generated tools while preserving their project-relative artifact layout. */
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { lstat, realpath, readdir, mkdir, copyFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { nativeToolPath, nativeToolPaths } from './native-tool-paths.mts';
/** Validate every selected file before copying to a new staging root; return false when no tools were declared. */
export async function stageNativeTools(root: string, declared: readonly string[] | undefined, destination: string): Promise<boolean> {
 const paths = nativeToolPaths(declared ?? []);
 if (!paths.length) return false;
 const base = await realpath(root), output = resolve(destination), files: string[] = [], portable = new Set<string>();
 /** Inspect a selected generated tree without following links or reading excluded content. */
 async function inspect(path: string): Promise<void> {
  nativeToolPath(path);
  const source = join(base, path), info = await lstat(source);
  assert.ok(!info.isSymbolicLink(), 'Refusing symbolic native tools link');
  if (info.isDirectory()) {
   for (const name of (await readdir(source)).sort()) await inspect(`${path}/${name}`);
  } else {
   assert.ok(info.isFile(), 'Native tools must be regular files or directories');
   assert.ok(!portable.has(path.toLowerCase()), 'Native tools contain ambiguous portable paths');
   portable.add(path.toLowerCase()); files.push(path);
  }
 }
 for (const path of paths) {
  let current = base;
  for (const part of path.split('/')) {
   current = join(current, part);
   assert.ok(!(await lstat(current)).isSymbolicLink(), 'Refusing symbolic native tools component');
  }
  assert.ok(output !== current && !output.startsWith(current + '/'), 'Native tools staging must be outside selected source trees');
  await inspect(path);
 }
 assert.ok(files.length > 0, 'Declared native tools contain no files');
 await mkdir(output, { recursive: false });
 for (const path of files) {
  const target = join(output, path);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(base, path), target, constants.COPYFILE_EXCL);
 }
 return true;
}
