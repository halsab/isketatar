import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTrafficShaper } from './traffic-shaper.mjs';

test('one shared wire budget covers simultaneous page and worker streams after latency', () => {
  let now = 0; let pending;
  const writes = [];
  const shaper = createTrafficShaper({ bytesPerSecond: 200000, latencyMs: 150, now: () => now,
    schedule: (fn, delay) => { assert.equal(pending, undefined); pending = { fn, at: now + delay }; return 1; }, cancel: () => { pending = undefined; } });
  const response = name => ({ destroyed: false, writeHead: () => writes.push({ name, at: now, bytes: 0 }),
    write: body => writes.push({ name, at: now, bytes: body.length }), end: () => {} });
  shaper.send(response('page'), {}, Buffer.alloc(8000), '/page');
  shaper.send(response('worker'), {}, Buffer.alloc(8000), '/worker');
  while (pending) { const next = pending; pending = undefined; now = next.at; next.fn(); }
  const bodies = writes.filter(write => write.bytes);
  assert.deepEqual(bodies.map(write => write.name), ['page', 'worker', 'page', 'worker']);
  assert.ok(writes.every(write => write.at >= 150));
  assert.equal(now, 230);
  for (let i = 0; i < bodies.length; i++) assert.ok(bodies.slice(0, i + 1).reduce((sum, item) => sum + item.bytes, 0) <= (bodies[i].at - 150) * 200);
  assert.equal(shaper.records.length, 2); assert.ok(shaper.records.every(record => record.complete));
  shaper.close();
});

test('closed streams do not write and shutdown cancels scheduled work', () => {
  let callback; let cancelled = false;
  const shaper = createTrafficShaper({ bytesPerSecond: 200000, latencyMs: 150, now: () => 0,
    schedule: fn => { callback = fn; return 1; }, cancel: () => { cancelled = true; } });
  const response = { destroyed: true, writeHead: () => assert.fail(), write: () => assert.fail(), end: () => assert.fail() };
  shaper.send(response, {}, Buffer.alloc(1), '/closed');
  callback?.(); shaper.close();
  assert.equal(shaper.records[0].wire_body_bytes, 0);
  shaper.send({ ...response, destroyed: false }, {}, Buffer.alloc(1), '/pending');
  shaper.close(); assert.equal(cancelled, true);
});
