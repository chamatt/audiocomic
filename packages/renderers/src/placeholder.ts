import { Buffer } from 'node:buffer';
import sharp from 'sharp';
import { getEnv } from '@audiocomic/shared';
import type { Env } from '@audiocomic/shared';
import type { PanelRenderRequest, PanelRenderResult } from '@audiocomic/domain';
import type { RendererAdapter } from './types';
import { panelRenderKey, promptHash, writeLocalImage } from './util';

const PLACEHOLDER_BG = '#1e1e2e';
const PLACEHOLDER_BORDER = '#cdd6f4';
const PLACEHOLDER_TEXT = '#cdd6f4';
const PLACEHOLDER_MUTED = '#a6adc8';

/**
 * Escape a string for safe inclusion in SVG `<text>` and XML body content.
 */
function escapeSvg(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Word-wrap a description into lines that fit the panel width at the given
 * approximate character budget. SVG has no native wrapping, so we split on
 * word boundaries.
 */
function wrapText(text: string, maxChars: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = words[0]!;
  for (let i = 1; i < words.length; i++) {
    const candidate = `${current} ${words[i]}`;
    if (candidate.length > maxChars) {
      lines.push(current);
      current = words[i]!;
    } else {
      current = candidate;
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Build an SVG placeholder describing the panel: a colored rectangle, border,
 * panel index badge, and the wrapped prompt/description text. The SVG is
 * rasterized to PNG via sharp so downstream consumers always receive a bitmap.
 */
function buildSvg(req: PanelRenderRequest): string {
  const { width, height, prompt, panelId, version } = req;
  const maxChars = Math.max(20, Math.floor(width / 9));
  const lines = wrapText(prompt, maxChars).slice(0, 12);
  const lineHeight = 26;
  const startY = Math.floor(height / 2) - ((lines.length - 1) * lineHeight) / 2;
  const textLines = lines
    .map(
      (line, i) =>
        `<text x="${Math.floor(width / 2)}" y="${startY + i * lineHeight}" font-family="Helvetica, Arial, sans-serif" font-size="20" fill="${PLACEHOLDER_TEXT}" text-anchor="middle">${escapeSvg(line)}</text>`,
    )
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect x="0" y="0" width="${width}" height="${height}" fill="${PLACEHOLDER_BG}"/>
  <rect x="8" y="8" width="${width - 16}" height="${height - 16}" fill="none" stroke="${PLACEHOLDER_BORDER}" stroke-width="6"/>
  <g font-family="Helvetica, Arial, sans-serif">
    <rect x="24" y="24" width="220" height="44" rx="8" fill="${PLACEHOLDER_BORDER}"/>
    <text x="34" y="52" font-size="20" font-weight="bold" fill="${PLACEHOLDER_BG}">PANEL #${version}</text>
    <text x="${width - 24}" y="52" font-size="16" fill="${PLACEHOLDER_MUTED}" text-anchor="end">${escapeSvg(panelId.slice(0, 8))}</text>
    ${textLines}
    <text x="${Math.floor(width / 2)}" y="${height - 28}" font-size="14" fill="${PLACEHOLDER_MUTED}" text-anchor="middle">placeholder render</text>
  </g>
</svg>`;
}

/**
 * Default fallback renderer. Produces a deterministic, cheap PNG that visually
 * represents the panel (description text, index, border) without any GPU or
 * external API. Used when no renderer backend is configured or available.
 */
export class PlaceholderRenderer implements RendererAdapter {
  readonly backend = 'placeholder' as const;
  private readonly env: Env;

  constructor(env: Env = getEnv()) {
    this.env = env;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async render(req: PanelRenderRequest): Promise<PanelRenderResult> {
    const start = Date.now();
    const svg = buildSvg(req);
    const png = await sharp(Buffer.from(svg)).png().toBuffer();
    const imageKey = panelRenderKey(req.projectId, req.panelId, req.version, 'png');
    await writeLocalImage(this.env, imageKey, png);

    return {
      id: crypto.randomUUID(),
      panelId: req.panelId,
      projectId: req.projectId,
      requestId: req.id,
      backend: 'placeholder',
      imageKey,
      width: req.width,
      height: req.height,
      seed: req.seed,
      durationMs: Date.now() - start,
      modelUsed: 'placeholder',
      promptHash: promptHash(req.prompt),
      createdAt: new Date().toISOString(),
      accepted: false,
    };
  }
}

export function createPlaceholderRenderer(env?: Env): PlaceholderRenderer {
  return new PlaceholderRenderer(env);
}
