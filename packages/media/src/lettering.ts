import type { LetteringBox, LetteringSpec } from '@audiocomic/domain';

// ============================================================================
// Lettering overlay renderer — post-render SVG pass (separate layer from art)
// ============================================================================

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Wrap text into <tspan> lines roughly fitting a max character width. */
function wrapText(
  text: string,
  x: number,
  y: number,
  fontSize: number,
  maxCharsPerLine: number,
  color: string,
  fontFamily: string,
): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`;
    if (candidate.length > maxCharsPerLine && line.length > 0) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line.length > 0) lines.push(line);

  const lineHeight = fontSize * 1.25;
  return lines
    .map(
      (ln, i) =>
        `<tspan x="${x}" y="${y + i * lineHeight}" fill="${color}" ` +
        `font-family="${fontFamily}" font-size="${fontSize}">${escapeXml(ln)}</tspan>`,
    )
    .join('');
}

interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

function toPixels(bbox: { x: number; y: number; w: number; h: number }, pw: number, ph: number): PixelBox {
  return {
    x: Math.round(bbox.x * pw),
    y: Math.round(bbox.y * ph),
    w: Math.round(bbox.w * pw),
    h: Math.round(bbox.h * ph),
  };
}

function renderSpeech(box: LetteringBox, pb: PixelBox, pw: number, ph: number): string {
  const fill = box.backgroundColor ?? '#ffffff';
  const stroke = box.color ?? '#000000';
  const fontColor = '#111111';
  const fontFamily = box.fontFamily ?? 'Comic Sans MS, sans-serif';
  const fontSize = box.fontSize ?? Math.max(12, Math.round(pb.h * 0.12));
  const r = Math.min(18, pb.h * 0.25);
  const cx = pb.x + pb.w / 2;
  const cy = pb.y + pb.h / 2;

  // Tail: a triangle from the bubble edge toward tailTarget (or a default
  // bottom-left direction). Clamped to the page so it never points off-canvas.
  const target = box.tailTarget
    ? { x: Math.max(0, Math.min(pw, box.tailTarget.x * pw)), y: Math.max(0, Math.min(ph, box.tailTarget.y * ph)) }
    : { x: pb.x + pb.w * 0.25, y: Math.min(ph, pb.y + pb.h + 24) };

  // Anchor the tail on the bubble edge nearest the target.
  const dx = target.x - cx;
  const dy = target.y - cy;
  const edgeX = dx === 0 ? cx : cx + Math.sign(dx) * pb.w * 0.3;
  const edgeY = dy === 0 ? cy : cy + Math.sign(dy) * pb.h * 0.35;
  const tailBase = Math.max(8, fontSize * 0.6);
  const tail =
    `<polygon points="${edgeX - tailBase},${edgeY} ` +
    `${edgeX + tailBase},${edgeY} ${target.x},${target.y}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"/>`;

  const bubble =
    `<rect x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" rx="${r}" ry="${r}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;

  const maxChars = Math.max(8, Math.floor(pb.w / (fontSize * 0.55)));
  const text = wrapText(
    box.text,
    cx,
    cy - (Math.ceil(box.text.length / maxChars) - 1) * fontSize * 0.625 + fontSize * 0.35,
    fontSize,
    maxChars,
    fontColor,
    fontFamily,
  );

  return `<g>${tail}${bubble}${text}</g>`;
}

function renderThought(box: LetteringBox, pb: PixelBox, pw: number, ph: number): string {
  const fill = box.backgroundColor ?? '#ffffff';
  const stroke = box.color ?? '#000000';
  const fontColor = '#111111';
  const fontFamily = box.fontFamily ?? 'Comic Sans MS, sans-serif';
  const fontSize = box.fontSize ?? Math.max(12, Math.round(pb.h * 0.12));
  const r = Math.min(24, pb.h * 0.3);
  const cx = pb.x + pb.w / 2;
  const cy = pb.y + pb.h / 2;

  // Thought tail: a chain of small circles leading toward the speaker.
  const target = box.tailTarget
    ? { x: Math.max(0, Math.min(pw, box.tailTarget.x * pw)), y: Math.max(0, Math.min(ph, box.tailTarget.y * ph)) }
    : { x: pb.x + pb.w * 0.5, y: Math.min(ph, pb.y + pb.h + 30) };
  const start = { x: pb.x + pb.w * 0.5, y: pb.y + pb.h };
  const steps = 3;
  let tail = '';
  for (let i = 1; i <= steps; i++) {
    const t = i / (steps + 1);
    const px = start.x + (target.x - start.x) * t;
    const py = start.y + (target.y - start.y) * t;
    const rad = Math.max(3, 10 - i * 2);
    tail += `<circle cx="${px}" cy="${py}" r="${rad}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  }

  const bubble =
    `<rect x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" rx="${r}" ry="${r}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-dasharray="6 4"/>`;

  const maxChars = Math.max(8, Math.floor(pb.w / (fontSize * 0.55)));
  const text = wrapText(
    box.text,
    cx,
    cy - (Math.ceil(box.text.length / maxChars) - 1) * fontSize * 0.625 + fontSize * 0.35,
    fontSize,
    maxChars,
    fontColor,
    fontFamily,
  );

  return `<g>${bubble}${tail}${text}</g>`;
}

function renderNarration(box: LetteringBox, pb: PixelBox): string {
  const fill = box.backgroundColor ?? '#fff7cc';
  const stroke = box.color ?? '#000000';
  const fontColor = '#111111';
  const fontFamily = box.fontFamily ?? 'Georgia, serif';
  const fontSize = box.fontSize ?? Math.max(11, Math.round(pb.h * 0.1));
  const cx = pb.x + pb.w / 2;
  const cy = pb.y + pb.h / 2;
  const pad = 6;

  const rect =
    `<rect x="${pb.x + pad}" y="${pb.y + pad}" width="${pb.w - pad * 2}" height="${pb.h - pad * 2}" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;

  const maxChars = Math.max(8, Math.floor((pb.w - pad * 2) / (fontSize * 0.5)));
  const text = wrapText(
    box.text,
    cx,
    cy - (Math.ceil(box.text.length / maxChars) - 1) * fontSize * 0.625 + fontSize * 0.35,
    fontSize,
    maxChars,
    fontColor,
    fontFamily,
  );

  return `<g>${rect}${text}</g>`;
}

function renderSfx(box: LetteringBox, pb: PixelBox): string {
  const color = box.color ?? '#ff2d2d';
  const fontFamily = box.fontFamily ?? 'Impact, sans-serif';
  const fontSize = box.fontSize ?? Math.max(24, Math.round(pb.h * 0.4));
  const cx = pb.x + pb.w / 2;
  const cy = pb.y + pb.h / 2;

  // Starburst: a many-pointed polygon behind the text.
  const points: string[] = [];
  const spikes = 12;
  const outer = Math.min(pb.w, pb.h) / 2;
  const inner = outer * 0.7;
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const ang = (Math.PI / spikes) * i;
    points.push(`${cx + Math.cos(ang) * r},${cy + Math.sin(ang) * r}`);
  }
  const burst =
    `<polygon points="${points.join(' ')}" fill="${box.backgroundColor ?? '#ffe600'}" ` +
    `stroke="${color}" stroke-width="2"/>`;

  const text =
    `<text x="${cx}" y="${cy + fontSize * 0.35}" text-anchor="middle" ` +
    `font-family="${fontFamily}" font-size="${fontSize}" font-weight="bold" ` +
    `fill="${color}" stroke="#000000" stroke-width="1" paint-order="stroke">${escapeXml(box.text)}</text>`;

  return `<g>${burst}${text}</g>`;
}

/**
 * Render a lettering spec as an SVG overlay string.
 *
 * Produces a transparent SVG document sized to the page that can be composited
 * over the rendered page art. Speech and thought bubbles are placed inside
 * their normalized bounding boxes with tails pointing at `tailTarget`; narration
 * boxes are flat caption rectangles; SFX text is rendered over a starburst.
 *
 * Bubble placement follows the spec's `bbox` and is independent of panel art —
 * callers should position boxes to avoid panel boundaries upstream (the planner
 * emits boxes that respect panel gutters).
 */
export function renderLetteringOverlay(
  spec: LetteringSpec,
  pageWidth: number,
  pageHeight: number,
): string {
  const groups = spec.boxes.map((box) => {
    const pb = toPixels(box.bbox, pageWidth, pageHeight);
    switch (box.type) {
      case 'speech':
        return renderSpeech(box, pb, pageWidth, pageHeight);
      case 'thought':
        return renderThought(box, pb, pageWidth, pageHeight);
      case 'narration':
      case 'caption':
        return renderNarration(box, pb);
      case 'sfx':
        return renderSfx(box, pb);
      default:
        return renderNarration(box, pb);
    }
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pageWidth}" height="${pageHeight}" ` +
    `viewBox="0 0 ${pageWidth} ${pageHeight}">\n` +
    groups.join('\n') +
    '\n</svg>'
  );
}
