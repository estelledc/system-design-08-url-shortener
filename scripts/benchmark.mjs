import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { encodeBase62, LinkService, MemoryLinkStore } from '../src/index.js';

const count = Number(process.env.BENCHMARK_COUNT ?? 50_000);
assert.ok(Number.isInteger(count) && count >= 1_000 && count <= 500_000);

let sequence = 0n;
const store = new MemoryLinkStore();
const service = new LinkService({
  store,
  publicBaseUrl: 'https://short.example',
  clock: () => 1_800_000_000_000,
  codeGenerator: () => encodeBase62(sequence += 1n).padStart(8, '0'),
});

const start = performance.now();
for (let index = 0; index < count; index += 1) {
  const result = await service.createLink({
    ownerId: 'benchmark-owner',
    idempotencyKey: `benchmark-request-${String(index).padStart(8, '0')}`,
    targetUrl: `https://example.com/items/${index}`,
  });
  assert.equal(result.created, true);
}
const elapsedMs = performance.now() - start;
const operationsPerSecond = Math.round((count * 1000) / elapsedMs);
const floor = 5_000;
assert.ok(operationsPerSecond >= floor, `local decision path fell below ${floor} operations/s`);

process.stdout.write(`${JSON.stringify({
  kind: 'local_memory_decision_benchmark',
  node: process.version,
  platform: process.platform,
  arch: process.arch,
  count,
  elapsedMs: Number(elapsedMs.toFixed(3)),
  operationsPerSecond,
  requirementFloorOperationsPerSecond: floor,
  claimBoundary: 'single-process in-memory create decision path with deterministic collision-free codes; excludes cryptographic RNG, PostgreSQL, HTTP, network, analytics, and production capacity',
})}\n`);
