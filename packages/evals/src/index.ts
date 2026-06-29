import type { PageSpec, PanelSpec, NarrationTimeline, StorySection, CharacterProfile } from '@audiocomic/domain';
import { validatePageLayout } from '@audiocomic/domain';

// ============================================================================
// Evaluation metrics — MangaFlow-style layout adherence, consistency, timing
// ============================================================================

export interface LayoutMetrics {
  panelCountAdherence: number; // fraction of pages with correct panel count
  overlapRate: number; // fraction of panels that overlap
  boundsViolationRate: number; // fraction of panels exceeding page bounds
  coverageRatio: number; // average page coverage by panels
  readingOrderCorrectRate: number; // fraction of pages with correct reading order
  overallScore: number; // 0-1 weighted average
}

export function evaluateLayout(pages: PageSpec[], allPanels: PanelSpec[]): LayoutMetrics {
  let panelCountOk = 0;
  let overlapCount = 0;
  let boundsViolationCount = 0;
  let totalCoverage = 0;
  let readingOrderOk = 0;
  let totalPanels = 0;

  for (const page of pages) {
    const pagePanels = allPanels.filter((p) => p.pageId === page.id);
    totalPanels += pagePanels.length;

    const result = validatePageLayout(page, pagePanels);
    if (result.valid) {
      panelCountOk++;
      readingOrderOk++;
    }

    // Check overlaps
    for (let i = 0; i < pagePanels.length; i++) {
      for (let j = i + 1; j < pagePanels.length; j++) {
        const a = pagePanels[i]!.bbox;
        const b = pagePanels[j]!.bbox;
        if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
          overlapCount++;
        }
      }
    }

    // Check bounds
    for (const panel of pagePanels) {
      if (panel.bbox.x + panel.bbox.w > 1.001 || panel.bbox.y + panel.bbox.h > 1.001) {
        boundsViolationCount++;
      }
    }

    // Coverage
    const coverage = pagePanels.reduce((sum, p) => sum + p.bbox.w * p.bbox.h, 0);
    totalCoverage += coverage;
  }

  const pageCount = pages.length || 1;
  const panelCountAdherence = panelCountOk / pageCount;
  const overlapRate = totalPanels > 0 ? overlapCount / totalPanels : 0;
  const boundsViolationRate = totalPanels > 0 ? boundsViolationCount / totalPanels : 0;
  const coverageRatio = totalCoverage / pageCount;
  const readingOrderCorrectRate = readingOrderOk / pageCount;

  const overallScore =
    panelCountAdherence * 0.3 +
    (1 - overlapRate) * 0.25 +
    (1 - boundsViolationRate) * 0.2 +
    Math.min(coverageRatio, 1) * 0.15 +
    readingOrderCorrectRate * 0.1;

  return {
    panelCountAdherence,
    overlapRate,
    boundsViolationRate,
    coverageRatio,
    readingOrderCorrectRate,
    overallScore,
  };
}

// ============================================================================
// Timing drift — narration timeline vs actual audio duration
// ============================================================================

export interface TimingMetrics {
  totalDriftSec: number; // sum of |planned - actual| per segment
  maxDriftSec: number;
  overlapViolations: number; // segments where end > next start
  coverageRatio: number; // timeline duration / audio duration
}

export function evaluateTiming(
  timeline: NarrationTimeline,
  audioDurationSec: number,
): TimingMetrics {
  let totalDrift = 0;
  let maxDrift = 0;
  let overlapViolations = 0;
  let timelineDuration = 0;

  const sorted = [...timeline.segments].sort((a, b) => a.startSec - b.startSec);
  for (let i = 0; i < sorted.length; i++) {
    const seg = sorted[i]!;
    const segDuration = seg.endSec - seg.startSec;
    timelineDuration += segDuration;

    if (i > 0) {
      const prev = sorted[i - 1]!;
      if (seg.startSec < prev.endSec) {
        overlapViolations++;
      }
    }

    // Drift: difference between planned and ideal even distribution
    const idealDuration = audioDurationSec / sorted.length;
    const drift = Math.abs(segDuration - idealDuration);
    totalDrift += drift;
    if (drift > maxDrift) maxDrift = drift;
  }

  return {
    totalDriftSec: totalDrift,
    maxDriftSec: maxDrift,
    overlapViolations,
    coverageRatio: audioDurationSec > 0 ? timelineDuration / audioDurationSec : 0,
  };
}

// ============================================================================
// Section reference compliance — every panel must reference a StorySection
// ============================================================================

export interface SectionRefMetrics {
  panelsWithSection: number;
  panelsWithoutSection: number;
  complianceRate: number;
}

export function evaluateSectionRefs(
  panels: PanelSpec[],
  sections: StorySection[],
): SectionRefMetrics {
  const sectionIds = new Set(sections.map((s) => s.id));
  let withSection = 0;
  let withoutSection = 0;

  for (const panel of panels) {
    if (sectionIds.has(panel.storySectionId)) {
      withSection++;
    } else {
      withoutSection++;
    }
  }
  return {
    panelsWithSection: withSection,
    panelsWithoutSection: withoutSection,
    complianceRate: panels.length > 0 ? withSection / panels.length : 0,
  };
}

// ============================================================================
// Consistency metrics — character appearance across panels
// ============================================================================

export interface ConsistencyMetrics {
  charactersWithRefs: number;
  charactersWithoutRefs: number;
  refCoverageRate: number;
  lockedCharacters: number;
}

export function evaluateConsistency(
  characters: CharacterProfile[],
  panels: PanelSpec[],
): ConsistencyMetrics {
  let withRefs = 0;
  let withoutRefs = 0;
  let locked = 0;

  for (const char of characters) {
    if (char.canonicalFaceRef || char.canonicalBodyRef) {
      withRefs++;
    } else {
      withoutRefs++;
    }
    if (char.locked) locked++;
  }

  return {
    charactersWithRefs: withRefs,
    charactersWithoutRefs: withoutRefs,
    refCoverageRate: characters.length > 0 ? withRefs / characters.length : 0,
    lockedCharacters: locked,
  };
}


// Image-level QA — re-exported from image-qa.ts
export { evaluateImageQuality } from './image-qa';
export type { ImageQAMetrics } from './image-qa';
