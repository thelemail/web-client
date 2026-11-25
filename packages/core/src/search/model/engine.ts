import { Tokenizer } from '@huggingface/tokenizers';
import * as ort from 'onnxruntime-web/wasm';
import { AssetError, loadAsset, type AssetDeps, type ModelManifest } from './assets';
import { meanPool, normalized } from './pool';
import type { EmbedInput, ModelFailure } from './protocol';
import { chunk, RECIPE, type Passage, type Specials } from './recipe';

export class ModelError extends Error {
	constructor(readonly reason: ModelFailure) {
		super(`model ${reason}`);
	}
}

export function failureOf(error: unknown): ModelFailure {
	if (error instanceof ModelError) return error.reason;
	if (error instanceof AssetError) return 'assets';
	if (typeof WebAssembly !== 'undefined' && (error instanceof WebAssembly.CompileError || error instanceof WebAssembly.LinkError)) return 'wasm';
	return 'memory';
}

function json(bytes: Uint8Array): object {
	return JSON.parse(new TextDecoder().decode(bytes)) as object;
}

function int64(values: readonly number[]): BigInt64Array {
	const out = new BigInt64Array(values.length);
	for (let i = 0; i < values.length; i++) out[i] = BigInt(values[i]);
	return out;
}

export class Embedder {
	#tokenizer: Tokenizer;
	#session: ort.InferenceSession;
	#specials: Specials;
	#queryPrefix: number[];

	private constructor(tokenizer: Tokenizer, session: ort.InferenceSession) {
		this.#tokenizer = tokenizer;
		this.#session = session;
		const ids = tokenizer.encode('', { add_special_tokens: true }).ids;
		if (ids.length !== 2) throw new ModelError('invalid');
		this.#specials = { cls: ids[0], sep: ids[1] };
		this.#queryPrefix = this.tokenize(RECIPE.queryPrefix);
	}

	static async load(manifest: ModelManifest, deps: AssetDeps, progress: (bytes: number) => void): Promise<Embedder> {
		const runtime = await loadAsset(manifest.files.runtime, deps, progress);
		const tokenizerConfig = json(await loadAsset(manifest.files.tokenizerConfig, deps, progress));
		const tokenizer = new Tokenizer(json(await loadAsset(manifest.files.tokenizer, deps, progress)), tokenizerConfig);
		ort.env.wasm.wasmBinary = runtime;
		ort.env.wasm.numThreads = 1;
		ort.env.wasm.proxy = false;
		ort.env.logLevel = 'error';
		const session = await ort.InferenceSession.create(await loadAsset(manifest.files.model, deps, progress), {
			executionProviders: ['wasm'],
			graphOptimizationLevel: 'all',
			executionMode: 'sequential',
			intraOpNumThreads: 1,
			interOpNumThreads: 1
		});
		return new Embedder(tokenizer, session);
	}

	tokenize(text: string): number[] {
		return this.#tokenizer.encode(text, { add_special_tokens: false }).ids;
	}

	async vector(ids: readonly number[]): Promise<Float32Array> {
		if (ids.length > RECIPE.total) throw new ModelError('tooLong');
		const n = ids.length;
		const feeds: Record<string, ort.Tensor> = {
			input_ids: new ort.Tensor('int64', int64(ids), [1, n]),
			attention_mask: new ort.Tensor('int64', int64(new Array<number>(n).fill(1)), [1, n])
		};
		if (this.#session.inputNames.includes('token_type_ids')) feeds.token_type_ids = new ort.Tensor('int64', new BigInt64Array(n), [1, n]);
		const out = await this.#session.run(feeds);
		const hidden = out.last_hidden_state;
		try {
			const v = normalized(meanPool(hidden.data as Float32Array, n));
			if (!v) throw new ModelError('invalid');
			return v;
		} finally {
			for (const t of Object.values(out)) t.dispose();
		}
	}

	passages(input: EmbedInput): Passage[] {
		const chunked = chunk(input.subject, input.parts, (t) => this.tokenize(t), this.#specials);
		if (!chunked.ok) throw new ModelError('tooMany');
		return chunked.passages;
	}

	async query(text: string): Promise<Float32Array> {
		const content = this.tokenize(text);
		if (content.length > RECIPE.total - 2 - this.#queryPrefix.length) throw new ModelError('tooLong');
		return this.vector([this.#specials.cls, ...this.#queryPrefix, ...content, this.#specials.sep]);
	}

	async release(): Promise<void> {
		await this.#session.release().catch(() => undefined);
	}
}
