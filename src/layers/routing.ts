// The authoritative layer-membership table. Capture, delta, and player all
// import from here — layer membership has exactly one definition.
export const ROUTING = {
  frame: ['display','position','top','right','bottom','left','width','height',
          'marginTop','marginRight','marginBottom','marginLeft',
          'paddingTop','paddingRight','paddingBottom','paddingLeft',
          'flexDirection','flexWrap','flexGrow','flexShrink','flexBasis',
          'alignItems','justifyContent',
          'gridTemplateColumns','gridTemplateRows','gridColumn','gridRow','gap'],
  skin:  ['color','backgroundColor','backgroundImage',
          'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
          'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
          'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle',
          'boxShadow','borderRadius','opacity'],
  voice: ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight',
          'letterSpacing','textTransform'],
  life:  ['transitionProperty','transitionDuration','animationName','animationDuration'],
} as const;

// Layer order is declared exactly once. Reverse iteration (for node removal,
// per player/render.ts) reverses this constant rather than hand-writing a
// second array.
export const LAYER_ORDER = ['bones', 'frame', 'skin', 'voice', 'life'] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

// The flat union of every computed-style property capture reads via
// getComputedStyle. Bones carries no properties (presence in the matched
// set is its only signal); voice additionally carries text/src/href and
// life additionally carries the file-level lifeFileChanged flag — both
// handled outside this property union, per src/capture/types.ts and
// src/delta/types.ts.
export const ROUTED_PROPERTIES: readonly string[] = [
  ...ROUTING.frame,
  ...ROUTING.skin,
  ...ROUTING.voice,
  ...ROUTING.life,
];

export function layerOf(property: string): Exclude<LayerName, 'bones'> | null {
  if ((ROUTING.frame as readonly string[]).includes(property)) return 'frame';
  if ((ROUTING.skin as readonly string[]).includes(property)) return 'skin';
  if ((ROUTING.voice as readonly string[]).includes(property)) return 'voice';
  if ((ROUTING.life as readonly string[]).includes(property)) return 'life';
  return null;
}
