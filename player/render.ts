import type { NodeRecord, Snapshot, LayerBag } from '../src/capture/types';
import { extractLayers } from '../src/layers/extract';
import { matchTrees } from '../src/identity/match';
import { nodeKey } from '../src/identity/signature';
import { LAYER_ORDER, type LayerName } from '../src/layers/routing';

export type LayerVisibility = Record<LayerName, boolean>;

export const DEFAULT_LAYER_VISIBILITY: LayerVisibility = {
  structure: true,
  layout: true,
  surface: true,
  content: true,
  behavior: true,
};

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TrackedNode {
  el: HTMLDivElement;
  kind: 'matched' | 'inserted' | 'removed';
  fromLayers: LayerBag | null;
  toLayers: LayerBag | null;
  fromGeometry: Geometry;
  toGeometry: Geometry;
  fromText: string;
  toText: string;
}

let tracked = new Map<string, TrackedNode>();

function depthOf(node: NodeRecord): number {
  return node.parentPath.split('/').filter(Boolean).length;
}

function makeElement(node: NodeRecord, depth: number): HTMLDivElement {
  const el = document.createElement('div');
  el.dataset.key = nodeKey(node);
  el.dataset.tag = node.tag;
  el.style.position = 'absolute';
  el.style.boxSizing = 'border-box';
  el.style.overflow = 'hidden';
  el.style.zIndex = String(depth);
  el.style.willChange = 'transform, opacity';
  return el;
}

// Forward-layer stagger windows (Structure, Layout, Surface, Content,
// Behavior), each spanning a fifth of the transition with 50% overlap
// into the next, so the reveal cascades rather than snapping layer by
// layer. Both indices are derived from LAYER_ORDER (invariant 3: layer
// order is declared once; reverse iteration reverses that same constant
// rather than hand-writing a second array).
const REVERSED_LAYER_ORDER = [...LAYER_ORDER].reverse();

function forwardIndex(layer: Exclude<LayerName, 'structure'>): number {
  return LAYER_ORDER.indexOf(layer);
}
function reverseIndex(layer: Exclude<LayerName, 'structure'>): number {
  return REVERSED_LAYER_ORDER.indexOf(layer);
}

function windowFor(index: number): [number, number] {
  const span = 0.3;
  const step = 0.1;
  const start = index * step;
  return [start, Math.min(1, start + span)];
}

// windowFor's four layer windows span [0, 0.7]. Rescaled into an
// arbitrary [rangeStart, rangeEnd), so inserted/removed nodes keep a
// genuine per-layer cascade (matching the forward/reverse grammar order
// the spec calls for) while that whole cascade is compressed into one
// half of the transition — see REMOVED_FADE_WINDOW / INSERTED_REVEAL_WINDOW.
function windowForScaled(index: number, rangeStart: number, rangeEnd: number): [number, number] {
  const [s, e] = windowFor(index);
  const scale = (rangeEnd - rangeStart) / 0.7;
  return [rangeStart + s * scale, rangeStart + e * scale];
}

// Removed and inserted nodes are sequenced, not simultaneous: the
// checkpoint describes a wholesale replacement as "the old page coming
// apart before the new one goes up" — before, not alongside. The
// original per-layer stagger windows put removed's fade-out at [0, 0.5]
// and inserted's reveal at [0.2, 0.7], overlapping for 0.3 of the
// transition — old and new content visibly competing for the same
// screen space. Splitting the transition in half (with a small gap as
// a beat where the stage is briefly emptier) removes that collision and
// gives the reveal a clearer "then" rather than an "at the same time."
const REMOVED_FADE_WINDOW: [number, number] = [0, 0.45];
const INSERTED_REVEAL_WINDOW: [number, number] = [0.5, 1];

function windowProgress(t: number, [start, end]: [number, number]): number {
  if (end <= start) return t >= start ? 1 : 0;
  if (t <= start) return 0;
  if (t >= end) return 1;
  return (t - start) / (end - start);
}

// --- OKLab color interpolation (Björn Ottosson's reference transform) ---

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}
function rgbToOklab(r: number, g: number, b: number): [number, number, number] {
  const lr = srgbToLinear(r / 255);
  const lg = srgbToLinear(g / 255);
  const lb = srgbToLinear(b / 255);
  const l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  const m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  const s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}
function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const lr = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [Math.round(linearToSrgb(lr) * 255), Math.round(linearToSrgb(lg) * 255), Math.round(linearToSrgb(lb) * 255)];
}
function parseColor(value: string): [number, number, number, number] | null {
  const m = value.match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
  if (parts.length < 3 || parts.some(Number.isNaN)) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}
function interpolateColor(from: string, to: string, t: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  if (!a || !b) return t < 0.5 ? from : to;
  const [la, aa, ba] = rgbToOklab(a[0], a[1], a[2]);
  const [lb, ab, bb] = rgbToOklab(b[0], b[1], b[2]);
  const [r, g, bl] = oklabToRgb(la + (lb - la) * t, aa + (ab - aa) * t, ba + (bb - ba) * t);
  const alpha = a[3] + (b[3] - a[3]) * t;
  return `rgba(${r}, ${g}, ${bl}, ${alpha.toFixed(3)})`;
}

// --- generic property interpolation ---

const NUMERIC_UNIT = /^(-?\d*\.?\d+)([a-z%]*)$/i;

function interpolateValue(from: string, to: string, t: number): string {
  if (from === to) return to;
  if (/^rgba?\(/i.test(from) && /^rgba?\(/i.test(to)) return interpolateColor(from, to, t);
  const fm = from.match(NUMERIC_UNIT);
  const tm = to.match(NUMERIC_UNIT);
  if (fm && tm && fm[2].toLowerCase() === tm[2].toLowerCase()) {
    const v = Number(fm[1]) + (Number(tm[1]) - Number(fm[1])) * t;
    return `${v}${fm[2]}`;
  }
  // Non-interpolable (display, position, fontFamily, textTransform, ...):
  // switch at the segment midpoint.
  return t < 0.5 ? from : to;
}

// Positioning/box properties the render model already owns via absolute
// positioning from captured geometry (setGeometry/setStaticGeometry).
// Copying their raw computed-style values (frequently "auto" for a
// statically-positioned source element, or a `position` other than
// `absolute`) would clobber that placement, so they're never applied
// from a layer bag even though they're part of ROUTING.layout.
const GEOMETRY_OWNED = new Set(['display', 'position', 'top', 'right', 'bottom', 'left', 'width', 'height']);

function applyBag(
  el: HTMLElement,
  from: Record<string, string>,
  to: Record<string, string>,
  t: number,
  skipOpacity: boolean,
): void {
  const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
  for (const key of keys) {
    if (key === 'text' || key === 'src') continue;
    if (skipOpacity && key === 'opacity') continue;
    if (GEOMETRY_OWNED.has(key)) continue;
    const fv = from[key];
    const tv = to[key];
    if (fv === undefined || tv === undefined) continue;
    (el.style as unknown as Record<string, string>)[key] = interpolateValue(fv, tv, t);
  }
}

function applyStatic(el: HTMLElement, bag: Record<string, string>, skipOpacity: boolean): void {
  applyBag(el, bag, bag, 0, skipOpacity);
}

function parseOpacity(v: string | undefined): number {
  const n = v !== undefined ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : 1;
}

function applyStructureOutline(el: HTMLElement, on: boolean): void {
  el.style.outline = on ? '1px solid rgba(120, 140, 170, 0.35)' : 'none';
  el.style.outlineOffset = '-1px';
}

function clearSurface(el: HTMLElement): void {
  el.style.backgroundColor = 'transparent';
  el.style.backgroundImage = 'none';
  el.style.borderTopWidth = '0px';
  el.style.borderRightWidth = '0px';
  el.style.borderBottomWidth = '0px';
  el.style.borderLeftWidth = '0px';
  el.style.boxShadow = 'none';
  el.style.borderRadius = '0px';
}

function clearContent(el: HTMLElement): void {
  el.style.color = 'transparent';
  el.textContent = '';
}

function setGeometry(el: HTMLElement, from: Geometry, to: Geometry, t: number): void {
  el.style.left = `${from.x + (to.x - from.x) * t}px`;
  el.style.top = `${from.y + (to.y - from.y) * t}px`;
  el.style.width = `${Math.max(0, from.w + (to.w - from.w) * t)}px`;
  el.style.height = `${Math.max(0, from.h + (to.h - from.h) * t)}px`;
}

function setStaticGeometry(el: HTMLElement, g: Geometry): void {
  el.style.left = `${g.x}px`;
  el.style.top = `${g.y}px`;
  el.style.width = `${g.w}px`;
  el.style.height = `${g.h}px`;
}

function addTracked(container: HTMLElement, kind: TrackedNode['kind'], fromNode: NodeRecord | null, toNode: NodeRecord | null): void {
  const refNode = (toNode ?? fromNode) as NodeRecord;
  const el = makeElement(refNode, depthOf(refNode));
  const key = kind === 'removed' ? nodeKey(fromNode as NodeRecord) : nodeKey(toNode as NodeRecord);

  tracked.set(key, {
    el,
    kind,
    fromLayers: fromNode ? extractLayers(fromNode) : null,
    toLayers: toNode ? extractLayers(toNode) : null,
    fromGeometry: (fromNode ?? toNode as NodeRecord).geometry,
    toGeometry: (toNode ?? fromNode as NodeRecord).geometry,
    fromText: fromNode ? fromNode.text : '',
    toText: toNode ? toNode.text : '',
  });
  container.appendChild(el);
}

// Rebuilds the tracked node set for the transition into `toSnapshot`.
// `fromSnapshot` is null only for the very first commit in the film,
// which has no predecessor — every one of its nodes is treated as
// freshly inserted (checkpoint §6: "elements accrete").
export function enterSegment(container: HTMLElement, fromSnapshot: Snapshot | null, toSnapshot: Snapshot): void {
  container.innerHTML = '';
  tracked = new Map();

  if (!fromSnapshot) {
    for (const toNode of toSnapshot.nodes) addTracked(container, 'inserted', null, toNode);
    return;
  }

  const { matched, inserted, removed } = matchTrees(fromSnapshot, toSnapshot);
  for (const [fromNode, toNode] of matched) addTracked(container, 'matched', fromNode, toNode);
  for (const toNode of inserted) addTracked(container, 'inserted', null, toNode);
  for (const fromNode of removed) addTracked(container, 'removed', fromNode, null);
}

function updateMatched(node: TrackedNode, t: number, visibility: LayerVisibility): void {
  const layoutT = windowProgress(t, windowFor(forwardIndex('layout')));
  if (visibility.layout) {
    setGeometry(node.el, node.fromGeometry, node.toGeometry, layoutT);
    applyBag(node.el, node.fromLayers?.layout ?? {}, node.toLayers?.layout ?? {}, layoutT, false);
  } else {
    setStaticGeometry(node.el, node.toGeometry);
  }
  applyStructureOutline(node.el, visibility.structure);

  if (visibility.surface) {
    const surfaceT = windowProgress(t, windowFor(forwardIndex('surface')));
    applyBag(node.el, node.fromLayers?.surface ?? {}, node.toLayers?.surface ?? {}, surfaceT, true);
    const fromOpacity = parseOpacity(node.fromLayers?.surface.opacity);
    const toOpacity = parseOpacity(node.toLayers?.surface.opacity);
    node.el.style.opacity = String(fromOpacity + (toOpacity - fromOpacity) * surfaceT);
  } else {
    clearSurface(node.el);
    node.el.style.opacity = '1';
  }

  if (visibility.content) {
    const contentT = windowProgress(t, windowFor(forwardIndex('content')));
    applyBag(node.el, node.fromLayers?.content ?? {}, node.toLayers?.content ?? {}, contentT, true);
    node.el.textContent = contentT < 0.5 ? node.fromText : node.toText;
  } else {
    clearContent(node.el);
  }

  if (visibility.behavior) {
    const behaviorT = windowProgress(t, windowFor(forwardIndex('behavior')));
    applyBag(node.el, node.fromLayers?.behavior ?? {}, node.toLayers?.behavior ?? {}, behaviorT, true);
  }
}

function updateInserted(node: TrackedNode, t: number, visibility: LayerVisibility): void {
  setStaticGeometry(node.el, node.toGeometry);
  applyStructureOutline(node.el, visibility.structure);

  const surfaceWindow = windowForScaled(forwardIndex('surface'), ...INSERTED_REVEAL_WINDOW);
  const contentWindow = windowForScaled(forwardIndex('content'), ...INSERTED_REVEAL_WINDOW);
  const revealing = visibility.surface || visibility.content || visibility.behavior;
  const surfaceReveal = revealing ? windowProgress(t, surfaceWindow) : 1;
  const contentReveal = revealing ? windowProgress(t, contentWindow) : 1;

  if (visibility.surface) {
    applyStatic(node.el, node.toLayers?.surface ?? {}, true);
    node.el.style.opacity = String(surfaceReveal * parseOpacity(node.toLayers?.surface.opacity));
  } else {
    clearSurface(node.el);
    node.el.style.opacity = '1';
  }

  if (visibility.content) {
    applyStatic(node.el, node.toLayers?.content ?? {}, true);
    node.el.textContent = contentReveal > 0.5 ? node.toText : '';
  } else {
    clearContent(node.el);
  }

  if (visibility.behavior) {
    applyStatic(node.el, node.toLayers?.behavior ?? {}, true);
  }
}

function updateRemoved(node: TrackedNode, t: number, visibility: LayerVisibility): void {
  setStaticGeometry(node.el, node.fromGeometry);
  applyStructureOutline(node.el, visibility.structure);

  // Reverse grammar order (Behavior -> Content -> Surface -> Layout ->
  // Structure): reverseIndex('behavior') < reverseIndex('content') <
  // reverseIndex('surface'), so within the compressed fade-out window,
  // behavior goes first and surface lingers longest.
  const surfaceWindow = windowForScaled(reverseIndex('surface'), ...REMOVED_FADE_WINDOW);
  const contentWindow = windowForScaled(reverseIndex('content'), ...REMOVED_FADE_WINDOW);
  const fading = visibility.surface || visibility.content || visibility.behavior;
  const surfaceVisible = fading ? 1 - windowProgress(t, surfaceWindow) : 1;
  const contentVisible = fading ? 1 - windowProgress(t, contentWindow) : 1;

  if (visibility.surface) {
    applyStatic(node.el, node.fromLayers?.surface ?? {}, true);
    node.el.style.opacity = String(surfaceVisible * parseOpacity(node.fromLayers?.surface.opacity));
  } else {
    clearSurface(node.el);
    node.el.style.opacity = '1';
  }

  if (visibility.content) {
    applyStatic(node.el, node.fromLayers?.content ?? {}, true);
    node.el.textContent = contentVisible > 0.5 ? node.fromText : '';
  } else {
    clearContent(node.el);
  }

  if (visibility.behavior) {
    applyStatic(node.el, node.fromLayers?.behavior ?? {}, true);
  }
}

// Advances every tracked node to progress `t` (0..1) within the current
// segment, applying only the layers `visibility` allows. A single call
// site drives all rendering — used both by the play loop and by scrub.
export function updateProgress(t: number, visibility: LayerVisibility): void {
  const clamped = Math.max(0, Math.min(1, t));
  for (const node of tracked.values()) {
    if (node.kind === 'matched') updateMatched(node, clamped, visibility);
    else if (node.kind === 'inserted') updateInserted(node, clamped, visibility);
    else updateRemoved(node, clamped, visibility);
  }
}

export function clearStage(container: HTMLElement): void {
  container.innerHTML = '';
  tracked = new Map();
}
