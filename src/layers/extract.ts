import { ROUTING } from './routing';
import type { NodeRecord, LayerBag } from '../capture/types';

function pick(computed: Record<string, string>, props: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const prop of props) {
    if (prop in computed) out[prop] = computed[prop];
  }
  return out;
}

// Splits a captured node's flat `computed` bag into the four property
// layers, using the one authoritative routing table. Structure has no
// properties (checkpoint §5) and so has no bag here — its only signal
// is presence in the matched set, handled by src/identity/match.ts.
export function extractLayers(node: NodeRecord): LayerBag {
  const content = pick(node.computed, ROUTING.content);
  content.text = node.text;
  if (node.src !== null) content.src = node.src;

  return {
    layout: pick(node.computed, ROUTING.layout),
    surface: pick(node.computed, ROUTING.surface),
    content,
    behavior: pick(node.computed, ROUTING.behavior),
  };
}
