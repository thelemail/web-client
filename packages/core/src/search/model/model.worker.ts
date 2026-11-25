/// <reference lib="webworker" />
/// <reference path="./virtual.d.ts" />
import manifest from 'virtual:model-assets';
import { browserAssetDeps } from './assets';
import { Embedder, failureOf } from './engine';
import type { ModelInit } from './protocol';
import { serveModel } from './serve';

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (e: MessageEvent<ModelInit>) => {
	const port = e.data?.op === 'init' ? e.data.port : null;
	if (!port) return;
	scope.onmessage = null;
	serveModel(port, {
		load: (progress) => Embedder.load(manifest, browserAssetDeps, progress),
		total: manifest.total,
		failureOf
	});
};
