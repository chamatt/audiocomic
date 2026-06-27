import type { Env } from '@audiocomic/shared';
import type { RendererAdapter, RendererBackend } from './types.js';
import { createPlaceholderRenderer } from './placeholder.js';
import {
  createComfyUIRenderer,
  type ComfyUIRendererOptions,
} from './comfyui.js';
import {
  createAISDKImageRenderer,
  type AISDKImageRendererOptions,
} from './aisdk.js';

export type { RendererAdapter, RendererBackend } from './types.js';
export { PlaceholderRenderer, createPlaceholderRenderer } from './placeholder.js';
export {
  ComfyUIRenderer,
  createComfyUIRenderer,
  type ComfyUIRendererOptions,
} from './comfyui.js';
export {
  AISDKImageRenderer,
  createAISDKImageRenderer,
  type AISDKImageRendererOptions,
} from './aisdk.js';

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
    case 'placeholder':
    default:
      return createPlaceholderRenderer(env);
  }
}
