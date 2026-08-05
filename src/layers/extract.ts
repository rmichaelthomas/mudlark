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
// layers, using the one authoritative routing table. Bones has no
// properties (checkpoint §5) and so has no bag here — its only signal
// is presence in the matched set, handled by src/identity/match.ts.
export function extractLayers(node: NodeRecord): LayerBag {
  const voice = pick(node.computed, ROUTING.voice);
  voice.text = node.text;
  if (node.src !== null) voice.src = node.src;

  return {
    frame: pick(node.computed, ROUTING.frame),
    skin: pick(node.computed, ROUTING.skin),
    voice,
    life: pick(node.computed, ROUTING.life),
  };
}
