import type { Env } from '@audiocomic/shared';
import type { RendererAdapter, RendererBackend } from './types';
import { createPlaceholderRenderer } from './placeholder';
import {
	createComfyUIRenderer,
	type ComfyUIRendererOptions,
} from './comfyui';
import {
	createAISDKImageRenderer,
	type AISDKImageRendererOptions,
} from './aisdk';
import {
	createPollinationsRenderer,
} from './pollinations';

export type { RendererAdapter, RendererBackend } from './types';
export { PlaceholderRenderer, createPlaceholderRenderer } from './placeholder';
export {
	ComfyUIRenderer,
	createComfyUIRenderer,
	type ComfyUIRendererOptions,
} from './comfyui';
export {
	AISDKImageRenderer,
	createAISDKImageRenderer,
	type AISDKImageRendererOptions,
} from './aisdk';
export {
	PollinationsRenderer,
	createPollinationsRenderer,
} from './pollinations';

/**
 * Resolve a renderer adapter by backend name. Unknown or unsupported backends
 * fall back to the placeholder renderer, which is always available and requires
 * no external services — matching the `DEFAULT_RENDERER=placeholder` default.
 */
export function createRenderer(
	backend: string,
	env?: Env,
): RendererAdapter {
	switch (backend as RendererBackend) {
		case 'comfyui':
			return createComfyUIRenderer(env);
		case 'aisdk':
			return createAISDKImageRenderer(env);
		case 'pollinations':
			return createPollinationsRenderer(env);
		case 'placeholder':
		default:
			return createPlaceholderRenderer(env);
	}
}
