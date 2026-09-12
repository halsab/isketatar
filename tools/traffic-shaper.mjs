export function createTrafficShaper({ bytesPerSecond, latencyMs, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout }) {
  if (!(bytesPerSecond > 0) || !(latencyMs >= 0)) throw new Error('Invalid traffic profile');
  const queue = []; const records = []; let timer;
  function pump() {
    if (timer !== undefined || !queue.length) return;
    const index = queue.findIndex(job => job.readyAt <= now());
    if (index === -1) {
      timer = schedule(() => { timer = undefined; pump(); }, Math.max(1, Math.ceil(Math.min(...queue.map(job => job.readyAt)) - now())));
      return;
    }
    const [job] = queue.splice(index, 1);
    if (job.response.destroyed) { pump(); return; }
    const size = Math.min(4000, job.body.length - job.offset);
    // Одна очередь делит пропускную способность между всеми потоками, включая service worker.
    timer = schedule(() => {
      timer = undefined;
      if (!job.response.destroyed) {
        if (job.offset === 0) { job.response.writeHead(200, job.headers); job.record.first_byte_ms = now(); }
        job.response.write(job.body.subarray(job.offset, job.offset + size)); job.offset += size;
        job.record.wire_body_bytes += size; job.record.last_byte_ms = now();
        if (job.offset === job.body.length) { job.response.end(); job.record.complete = true; }
        else queue.push(job);
      }
      pump();
    }, Math.ceil(size / bytesPerSecond * 1000));
  }
  return {
    records,
    send(response, headers, body, path) {
      const requestedAt = now();
      const record = { path, requested_at_ms: requestedAt, first_byte_ms: null, last_byte_ms: null, wire_body_bytes: 0, complete: false };
      records.push(record); queue.push({ response, headers, body, offset: 0, readyAt: requestedAt + latencyMs, record }); pump();
    },
    close() { if (timer !== undefined) cancel(timer); timer = undefined; queue.length = 0; },
  };
}
