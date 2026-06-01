import fs from 'node:fs/promises';
import path from 'node:path';

function parseArgs(argv) {
  const args = { awsRoot: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--aws-root') {
      args.awsRoot = argv[i + 1] ?? null;
      i += 1;
    }
  }
  return args;
}

async function exists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

function isExcluded(filePath, excludeGlobs) {
  const base = path.basename(filePath);
  if (excludeGlobs?.includes('**/.DS_Store') && base === '.DS_Store') return true;
  return false;
}

async function ensureRepo(root, name) {
  const gitDir = path.join(root, '.git');
  if (!(await exists(gitDir))) {
    throw new Error(`[parity] ${name} repo not found (missing .git): ${root}`);
  }
}

async function readManifest(platformRoot) {
  const manifestPath = path.join(platformRoot, 'scripts', 'parity.manifest.json');
  const raw = await fs.readFile(manifestPath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed?.paths || !Array.isArray(parsed.paths)) {
    throw new Error('[parity] Invalid manifest: missing paths[]');
  }
  return { manifestPath, manifest: parsed };
}

async function copyFileStrict(srcAbs, destAbs) {
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.copyFile(srcAbs, destAbs);
}

async function mirrorDirStrict(srcAbs, destAbs, excludeGlobs) {
  await fs.rm(destAbs, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  await fs.cp(srcAbs, destAbs, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: (entry) => !isExcluded(entry, excludeGlobs),
  });
}

async function main() {
  const platformRoot = process.cwd();
  await ensureRepo(platformRoot, 'dinodia-platform');

  const { awsRoot: awsRootArg } = parseArgs(process.argv.slice(2));
  const awsRoot = awsRootArg
    ? path.resolve(platformRoot, awsRootArg)
    : path.resolve(platformRoot, '..', 'dinodia-platform-aws');
  await ensureRepo(awsRoot, 'dinodia-platform-aws');

  const { manifest } = await readManifest(platformRoot);
  const excludeGlobs = Array.isArray(manifest.excludeGlobs) ? manifest.excludeGlobs : [];

  const changed = [];
  for (const entry of manifest.paths) {
    const mode = entry?.mode;
    const srcRel = entry?.src;
    const destRel = entry?.dest;
    if (!mode || !srcRel || !destRel) {
      throw new Error(`[parity] Invalid manifest entry: ${JSON.stringify(entry)}`);
    }
    const srcAbs = path.join(platformRoot, srcRel);
    const destAbs = path.join(awsRoot, destRel);

    if (mode === 'file') {
      if (!(await exists(srcAbs))) throw new Error(`[parity] Missing source file: ${srcRel}`);
      await copyFileStrict(srcAbs, destAbs);
      changed.push(destRel);
      continue;
    }
    if (mode === 'dir') {
      if (!(await exists(srcAbs))) throw new Error(`[parity] Missing source dir: ${srcRel}`);
      await mirrorDirStrict(srcAbs, destAbs, excludeGlobs);
      changed.push(`${destRel}/**`);
      continue;
    }
    throw new Error(`[parity] Unknown mode "${mode}" for ${srcRel}`);
  }

  process.stdout.write(`[parity] Synced ${changed.length} manifest entries into dinodia-platform-aws.\n`);
  for (const item of changed) process.stdout.write(`- ${item}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

