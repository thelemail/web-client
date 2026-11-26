/// <reference lib="webworker" />
/// <reference path="./virtual.d.ts" />
import manifest from 'virtual:model-assets';
import { AssetError, browserAssetDeps, type AssetDeps } from './assets';
import { Embedder, failureOf } from './engine';
import type { ModelInit } from './protocol';
import { serveModel } from './serve';

const scope = self as unknown as DedicatedWorkerGlobalScope;
const cachedOnly: AssetDeps = { ...browserAssetDeps, fetch: () => Promise.reject(new AssetError('fetch')) };

scope.onmessage = (e: MessageEvent<ModelInit>) => {
	const port = e.data?.op === 'init' ? e.data.port : null;
	if (!port) return;
	scope.onmessage = null;
	serveModel(port, {
		load: (progress, offline) => Embedder.load(manifest, offline ? cachedOnly : browserAssetDeps, progress),
		total: manifest.total,
		failureOf
	});
};
