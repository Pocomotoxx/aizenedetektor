import { createC2pa } from '@contentauth/c2pa-web';
import wasmSrc from '@contentauth/c2pa-web/resources/c2pa.wasm?url';

let c2paPromise;
export async function inspectC2pa(file) {
  try {
    c2paPromise ??= createC2pa({ wasmSrc });
    const c2pa = await c2paPromise;
    const reader = await c2pa.reader.fromBlob(file.type || 'application/octet-stream', file);
    try {
      const manifestStore = await reader.manifestStore();
      return { available: true, status: 'érvényesíthető manifest észlelve', manifestBytes: JSON.stringify(manifestStore).length };
    } finally { await reader.free(); }
  } catch (error) {
    return { available: false, status: 'nincs olvasható C2PA-manifest vagy a formátum nem támogatott', detail: error.message };
  }
}
