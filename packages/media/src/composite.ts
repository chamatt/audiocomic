import sharp from 'sharp';

import type { PageSpec, PanelSpec } from '@audiocomic/domain';

// ============================================================================
// Page compositor — place panel art on a canvas per panel bounding boxes
// ============================================================================

export interface OutputSize {
  width: number;
  height: number;
}

export interface ComposeOptions {
  /** Gutter color between panels. */
  gutterColor?: string;
  /** Page background color (borders / bleed area). */
  backgroundColor?: string;
  /** Border drawn around each panel in pixels. */
  panelBorder?: number;
}

/**
 * Compose panel images into a single page image.
 *
 * Each panel image is resized to cover its bounding box (normalized 0-1,
 * relative to the page) and placed at the corresponding pixel position with
 * gutters and an optional border. Panels are matched to images by `index`
 * (panelSpecs sorted ascending; `panelImages[i]` corresponds to the i-th panel
 * in that order). The result is a PNG buffer.
 *
 * Uses sharp's composite pipeline: a flat background is created and every
 * panel is layered on top in z-index then index order.
 */
export async function composePage(
  panelImages: Buffer[],
  pageSpec: PageSpec,
  panelSpecs: PanelSpec[],
  outputSize: OutputSize,
  options?: ComposeOptions,
): Promise<Buffer> {
  const { width, height } = outputSize;
  if (width <= 0 || height <= 0) {
    throw new Error('composePage: outputSize width and height must be positive');
  }
  if (panelSpecs.length === 0) {
    throw new Error('composePage: no panel specs supplied');
  }

  const gutterColor = options?.gutterColor ?? '#101010';
  const backgroundColor = options?.backgroundColor ?? '#202020';
  const panelBorder = options?.panelBorder ?? 2;

  const gutterPx = Math.round(pageSpec.bleedGutter.gutter * width);
  const border = Math.max(0, panelBorder);

  // Order panels by index and pair with images.
  const ordered = [...panelSpecs].sort((a, b) => a.index - b.index);
  // Stable secondary sort by zIndex so higher z draws on top.
  ordered.sort((a, b) => a.zIndex - b.zIndex || a.index - b.index);

  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (let i = 0; i < ordered.length; i++) {
    const panel = ordered[i]!;
    const img = panelImages[i];
    if (!img) continue;

    const bx = Math.round(panel.bbox.x * width);
    const by = Math.round(panel.bbox.y * height);
    const bw = Math.max(1, Math.round(panel.bbox.w * width) - gutterPx);
    const bh = Math.max(1, Math.round(panel.bbox.h * height) - gutterPx);

    // Resize to cover the box, then crop to the exact box dimensions.
    let layer = sharp(img).resize(bw, bh, {
      fit: 'cover',
      position: 'centre',
    });

    if (border > 0) {
      // Draw a border by extending the image edges.
      layer = layer.extend({
        top: border,
        bottom: border,
        left: border,
        right: border,
        background: gutterColor,
      });
    }

    const buf = await layer.png().toBuffer();
    composites.push({
      input: buf,
      left: Math.max(0, bx - (border > 0 ? border : 0)),
      top: Math.max(0, by - (border > 0 ? border : 0)),
    });
  }

  const page = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: backgroundColor,
    },
  });

  if (composites.length === 0) {
    return page.png().toBuffer();
  }

  return page.composite(composites).png().toBuffer();
}
