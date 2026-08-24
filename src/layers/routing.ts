// The authoritative layer-membership table. Capture, delta, and player all
// import from here — layer membership has exactly one definition.
//
// The five layers were renamed in v1.3 (Bones -> Structure, Frame -> Layout,
// Skin -> Surface, Voice -> Content, Life -> Behavior). Only the names moved:
// which property belongs to which layer is byte-for-byte what it was.
export const ROUTING = {
  layout:   ['display','position','top','right','bottom','left','width','height',
             'marginTop','marginRight','marginBottom','marginLeft',
             'paddingTop','paddingRight','paddingBottom','paddingLeft',
             'flexDirection','flexWrap','flexGrow','flexShrink','flexBasis',
             'alignItems','justifyContent',
             'gridTemplateColumns','gridTemplateRows','gridColumn','gridRow','gap'],
  surface:  ['color','backgroundColor','backgroundImage',
             'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth',
             'borderTopColor','borderRightColor','borderBottomColor','borderLeftColor',
             'borderTopStyle','borderRightStyle','borderBottomStyle','borderLeftStyle',
             'boxShadow','borderRadius','opacity'],
  content:  ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight',
             'letterSpacing','textTransform'],
  behavior: ['transitionProperty','transitionDuration','animationName','animationDuration'],
} as const;

// Layer order is declared exactly once. Reverse iteration (for node removal,
// per player/render.ts) reverses this constant rather than hand-writing a
// second array.
export const LAYER_ORDER = ['structure', 'layout', 'surface', 'content', 'behavior'] as const;

export type LayerName = (typeof LAYER_ORDER)[number];

// The flat union of every computed-style property capture reads via
// getComputedStyle. Structure carries no properties (presence in the matched
// set is its only signal); content additionally carries text/src/href and
// behavior additionally carries the file-level behaviorFileChanged flag — both
// handled outside this property union, per src/capture/types.ts and
// src/delta/types.ts.
export const ROUTED_PROPERTIES: readonly string[] = [
  ...ROUTING.layout,
  ...ROUTING.surface,
  ...ROUTING.content,
  ...ROUTING.behavior,
];

export function layerOf(property: string): Exclude<LayerName, 'structure'> | null {
  if ((ROUTING.layout as readonly string[]).includes(property)) return 'layout';
  if ((ROUTING.surface as readonly string[]).includes(property)) return 'surface';
  if ((ROUTING.content as readonly string[]).includes(property)) return 'content';
  if ((ROUTING.behavior as readonly string[]).includes(property)) return 'behavior';
  return null;
}
