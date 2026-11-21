// Solmar Bay — the entry program (Node 22, standard library only). It hands the game
// in: it copies this repository's game/ and screenshots/ into the output directory and
// writes /output/dossier.json with buildDossier from the vendored make.fun library.
// Outside the grader, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The scorer's caps (from the gate): at most 4 screenshots, each at most 256 KiB;
// game/ at most 993 files and 48 MiB in all, every path at most 1000 bytes; the whole
// of /output shares the platform's 1000-entry / 64 MiB cap, so the checks below refuse
// anything the scorer would refuse before writing the dossier.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');

const LIMITS = {
  textMaxBytes: 163840,
  maxScreenshots: 4,
  maxScreenshotBytes: 262144,
  maxGameFiles: 993,
  maxGameBytes: 50331648,
  maxGamePathBytes: 1000,
};

function countGameFiles(dir, base) {
  let files = 0;
  let bytes = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = full.slice(base.length + 1);
    if (Buffer.byteLength(rel, 'utf8') > LIMITS.maxGamePathBytes) {
      throw new Error(`game path too long: ${rel}`);
    }
    if (entry.isDirectory()) {
      const sub = countGameFiles(full, base);
      files += sub.files;
      bytes += sub.bytes;
    } else if (entry.isFile()) {
      files += 1;
      bytes += statSync(full).size;
    } else {
      throw new Error(`game/ holds a non-file, non-directory entry: ${rel}`);
    }
  }
  return { files, bytes };
}

function checkScreenshots(dir) {
  if (!existsSync(dir)) return;
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  if (names.length > LIMITS.maxScreenshots) throw new Error(`too many screenshots: ${names.length}`);
  for (const name of names) {
    const size = statSync(join(dir, name)).size;
    if (size > LIMITS.maxScreenshotBytes) throw new Error(`screenshot too large: ${name} (${size} bytes)`);
  }
}

const gameStats = countGameFiles(gameDir, gameDir);
if (gameStats.files > LIMITS.maxGameFiles) throw new Error(`too many game files: ${gameStats.files}`);
if (gameStats.bytes > LIMITS.maxGameBytes) throw new Error(`game/ too large: ${gameStats.bytes} bytes`);
checkScreenshots(shotsDir);

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(gameDir, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(shotsDir)) cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

// The gate checker reads the caps out of this buildDossier call, so they are
// written here as literals (the same numbers as LIMITS above).
const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);
console.log(`Solmar Bay handed in: ${gameStats.files} game files, ${gameStats.bytes} bytes, dossier ${dossier.length} bytes.`);
