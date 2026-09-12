export async function readBoundedBytes(response: Response, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(response.headers.get('content-length')) > maximum) throw new Error('content_corrupt');
  if (!response.body) throw new Error('content_unavailable');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new Error('content_corrupt'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
