/// <reference lib="webworker" />
import { buildChunk, type ChunkRequest } from './chunkBuilder';

self.onmessage = (ev: MessageEvent<ChunkRequest>) => {
  const data = buildChunk(ev.data);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(data, [data.positions.buffer, data.normals.buffer, data.colors.buffer, data.trees.buffer]);
};
