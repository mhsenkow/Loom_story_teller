// Opt-in hardware audit. Uses an isolated headed Chrome profile; never software GPU flags.
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, platform, release, arch } from 'node:os';
import { createHash } from 'node:crypto';

const output = resolve(process.env.LOOM_GPU_REPORT_DIR ?? 'test-results/gpu-renderer');
const baseURL = process.env.LOOM_E2E_BASE_URL ?? 'http://127.0.0.1:3000';
await mkdir(output, { recursive: true });
const bundle = await build({ entryPoints: ['scripts/fixtures/webgpuHardware.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', loader: { '.wgsl': 'text' } });
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(30_000);
  await page.route('**/__hardware-audit', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Loom GPU hardware audit</title><body></body>' }));
  await page.goto(`${baseURL}/__hardware-audit`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => Promise.race([
    window.runHardwareChecks(),
    new Promise((_, reject) => setTimeout(() => reject(new Error('Hardware audit timed out after 45 seconds')), 45_000)),
  ]));
  const report = { date: new Date().toISOString(), browser: browser.version(), host: { cpu: cpus()[0]?.model, platform: platform(), release: release(), arch: arch() }, buildId: (await readFile('out/build-id.txt', 'utf8')).trim(), fixtureBundleSha256: createHash('sha256').update(bundle.outputFiles[0].text).digest('hex'), ...result };
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
  await page.screenshot({ path: resolve(output, 'renderers.png'), fullPage: true });
  console.log(JSON.stringify(report, null, 2));
  if (report.checks.some(check => !check.pass)) process.exitCode = 1;
} finally { await browser.close(); }
