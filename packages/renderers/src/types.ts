import type { PanelRenderRequest, PanelRenderResult } from '@audiocomic/domain';

/**
 * Supported renderer backends. Mirrors the `backend` enum on `RenderPreset`
 * and `PanelRenderResult`.
 */
export type RendererBackend = 'comfyui' | 'aisdk' | 'pollinations' | 'placeholder';

/**
 * A renderer adapter turns a {@link PanelRenderRequest} into a persisted
 * {@link PanelRenderResult}. Implementations are responsible for writing the
 * generated image bytes to storage and returning the storage `imageKey`.
 */
export interface RendererAdapter {
  readonly backend: RendererBackend;
  render(req: PanelRenderRequest): Promise<PanelRenderResult>;
  isAvailable(): Promise<boolean>;
}
