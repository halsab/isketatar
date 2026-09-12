import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { platform, arch, cpus } from 'node:os';
import { navigation } from 'lighthouse';
import { launch } from 'chrome-launcher';
import { chromium } from 'playwright';
import puppeteer from 'puppeteer-core';
import { serveDist } from './serve-dist.mjs';

const probe = process.argv.includes('--probe');
const count = probe ? 1 : 5;
const output = process.env.QUALITY_OUTPUT ?? 'quality-results/performance';
const routes = [['home', '/', '.home-continuation'], ['lesson', '/lessons/V04', '.lesson-example'], ['reader', '/reading/READ-03', '.reading-line'], ['dictionary', '/dictionary', '.dictionary-group']];
assert.ok(!process.env.PROBE_ROUTE || probe && routes.some(([name]) => name === process.env.PROBE_ROUTE), 'Unknown probe route');
const settings = {
  onlyCategories: ['performance'], skipAudits: ['bf-cache'], formFactor: 'mobile', throttlingMethod: 'devtools',
  screenEmulation: { mobile: true, width: 390, height: 844, deviceScaleFactor: 1, disabled: false },
  throttling: { cpuSlowdownMultiplier: 4, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
  maxWaitForLoad: 45_000, maxWaitForFcp: 30_000,
};
const manifestBytes = await readFile('dist/release-manifest.json');
const manifest = JSON.parse(manifestBytes);
const provenance = JSON.parse(await readFile('quality-results/build-provenance.json', 'utf8'));
assert.equal(provenance.release_id, manifest.release_id);
assert.equal(provenance.manifest_sha256, createHash('sha256').update(manifestBytes).digest('hex'), 'Stale build provenance');
const traffic = { bytesPerSecond: 200000, latencyMs: 150 };
const server = await serveDist('dist', traffic);
const report = { release_id: manifest.release_id, provenance, protocol: 'HTTP/2 + gzip9; temporary localhost certificate trusted by SPKI only', traffic: { ...traffic, scope: 'shared page and service-worker gzip body bytes; headers/TLS and GET upload not modelled; CPU4 on page via CDP' }, cold_policy: 'fresh Chrome profile for every run; readiness inside throttled trace; bf-cache navigation diagnostic omitted', runner: { os: platform(), arch: arch(), cpu: cpus()[0]?.model, node: process.version }, settings, probe, routes: [] };
await mkdir(output, { recursive: true });
try {
  for (const [name, route, ready] of routes) {
    if (probe && process.env.PROBE_ROUTE && name !== process.env.PROBE_ROUTE) continue;
    const runs = [];
    for (let run = 1; run <= count; run++) {
      const networkStart = server.networkRecords.length;
      const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: [`--ignore-certificate-errors-spki-list=${server.spki}`, '--headless', '--no-sandbox', '--disable-dev-shm-usage'], logLevel: 'silent' });
      try {
        const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
        const page = await browser.newPage();
        const errors = []; page.on('pageerror', error => errors.push(String(error))); page.on('requestfailed', request => errors.push(`${request.url()} ${request.failure()?.errorText}`));
        let result;
        try {
          let readinessError;
          result = await navigation(page, async () => {
            try {
              await page.goto(`${server.url}#${route}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
              await page.waitForFunction(selector => document.querySelector(selector) && !document.querySelector('.font-message,.boot-main'), { timeout: 45_000, polling: 'mutation' }, ready);
              await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => { performance.mark('lab-route-ready'); resolve(); }))));
            } catch (error) { readinessError = error; }
          }, { flags: { logLevel: 'error' }, config: { extends: 'lighthouse:default', settings } });
          assert.ok(result && !result.lhr.runtimeError, JSON.stringify(result?.lhr.runtimeError));
          await writeFile(`${output}/${name}-${run}.json`, JSON.stringify(result.lhr));
          await writeFile(`${output}/${name}-${run}.trace.json`, JSON.stringify(result.artifacts.Trace));
          const network = server.networkRecords.slice(networkStart);
          assert.ok(network.every(record => record.first_byte_ms === null || record.first_byte_ms - record.requested_at_ms >= traffic.latencyMs), 'Traffic latency bypass');
          await writeFile(`${output}/${name}-${run}.network.json`, JSON.stringify(network));
          assert.ifError(readinessError);
          assert.ok(await page.$(ready), `Measured page not ready: ${name} ${page.url()} ${await page.$eval('body', node => node.innerText.slice(-1500))} ${errors.join('; ')}`);
          assert.equal(await page.$('.font-message'), null, `Font not ready: ${name}`);
          assert.equal(await page.$('.boot-main'), null, 'Cannot measure a failed boot as a successful page');
        } finally { await browser.disconnect(); }
        const lhr = result.lhr;
        const readyMark = lhr.audits['user-timings'].details.items.find(item => item.name === 'lab-route-ready');
        const metrics = { lcp_ms: lhr.audits['largest-contentful-paint'].numericValue, tbt_ms: lhr.audits['total-blocking-time'].numericValue, cls: lhr.audits['cumulative-layout-shift'].numericValue, route_ready_ms: readyMark?.startTime };
        assert.ok(Object.values(metrics).every(Number.isFinite));
        runs.push({ run, ...metrics, benchmarkIndex: lhr.environment.benchmarkIndex });
        report.lighthouse = lhr.lighthouseVersion; report.browser = lhr.environment.hostUserAgent;
        console.log(name, run, metrics);
      } finally { await chrome.kill(); }
    }
    const median = key => runs.map(run => run[key]).sort((a, b) => a - b)[Math.floor(count / 2)];
    report.routes.push({ name, route, runs, median: { lcp_ms: median('lcp_ms'), tbt_ms: median('tbt_ms'), cls: median('cls'), route_ready_ms: median('route_ready_ms') } });
    await writeFile(`${output}/summary.json`, JSON.stringify(report, null, 2) + '\n');
  }
} finally { await server.close(); }
if (!probe) for (const route of report.routes) {
  assert.ok(route.median.lcp_ms <= 2500 && route.median.tbt_ms <= 200 && route.median.cls <= 0.1, `Performance budget exceeded: ${route.name} ${JSON.stringify(route.median)}`);
}
