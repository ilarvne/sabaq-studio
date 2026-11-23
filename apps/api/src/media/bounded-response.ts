export async function readBounded(response: Response, limit: number) {
  if (!response.body || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    return;
  }
  const parts: Buffer[] = [];
  const reader = response.body.getReader();
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(parts, size);
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        return;
      }
      parts.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
}
