import type { Page } from 'playwright';
import type { NodeRecord } from './types';

// The walker is defined as a raw JS source string, not a TS function
// reference. Playwright serializes a function pageFunction via
// `Function.prototype.toString()` to inject it into the page; tsx/esbuild
// wraps function declarations with a `__name(...)` helper call for
// better stack traces, and that helper isn't part of the serialized
// string, so the injected code throws `__name is not defined` in the
// browser. A string pageFunction sidesteps this — it's evaluated as
// written, with no compile step in between.
function walkerSource(routedProperties: readonly string[]): string {
  return `(() => {
  const props = ${JSON.stringify(routedProperties)};
  const SKIP_TAGS = new Set(['script', 'style', 'head']);

  function ownText(el) {
    let text = '';
    el.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent || '';
      }
    });
    return text.trim();
  }

  // Same-origin URLs are relativized so the captured value doesn't bake
  // in the capture server's ephemeral port — otherwise re-capturing the
  // same commit is spuriously non-deterministic (checkpoint failure mode #2).
  function relativizeIfSameOrigin(url) {
    if (!url) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin === window.location.origin) {
        return parsed.pathname + parsed.search + parsed.hash;
      }
      return url;
    } catch {
      return url;
    }
  }

  function mediaSrc(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'link') {
      return relativizeIfSameOrigin(el.href) || null;
    }
    if ('src' in el) {
      return relativizeIfSameOrigin(el.src) || null;
    }
    return null;
  }

  // A 3D-transform card flip (backface-visibility: hidden, rotated by an
  // ancestor) stacks a front and back face at the identical box — only
  // one is actually painted, but a naive walk captures both, and the
  // player renders both, producing overlapping text. Ask the browser
  // what it actually painted at this element's own center point rather
  // than re-deriving the full 3D transform math ourselves: a
  // backface-hidden element that isn't in that point's paint stack is
  // facing away and isn't part of the rendered artifact right now.
  function isFacingAway(el) {
    if (getComputedStyle(el).backfaceVisibility !== 'hidden') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) return false;
    return !document.elementsFromPoint(cx, cy).includes(el);
  }

  // Chromium's layout engine doesn't always land on the exact same
  // sub-pixel value for the same content across separate loads (confirmed:
  // recapturing the same commit landed on 2828px and 2827.765625px
  // scrollHeight, a ~0.23px drift, with nothing else different) — real
  // enough to break byte-identical determinism checks, too small to be a
  // real content change or to matter visually. Rounding to the nearest
  // whole pixel comfortably absorbs that noise (a genuine layout change
  // is virtually never sub-pixel) everywhere geometry and pixel-valued
  // computed properties are read, not just the one call site that
  // happened to surface it.
  function roundPx(n) {
    return Math.round(n);
  }

  // Backslashes are doubled (\\\\d, not \\d) because this whole function
  // is text inside walkerSource's outer template literal — the outer
  // parser consumes one level of backslash-escaping before this string
  // ever reaches the browser. A single \\d here silently becomes a
  // literal "d" in the string the browser evaluates, and the regex
  // would never match anything (confirmed: it didn't, silently).
  function roundPxString(value) {
    const m = /^(-?\\d*\\.?\\d+)px$/.exec(value);
    return m ? roundPx(Number(m[1])) + 'px' : value;
  }

  function geometryOf(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: roundPx(rect.left + window.scrollX),
      y: roundPx(rect.top + window.scrollY),
      w: roundPx(rect.width),
      h: roundPx(rect.height),
    };
  }

  function computedOf(el) {
    const style = getComputedStyle(el);
    const out = {};
    for (const prop of props) {
      out[prop] = roundPxString(style[prop] || '');
    }
    return out;
  }

  const records = [];

  function walk(el, parentPath) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (getComputedStyle(el).display === 'none') return; // prune: subtree is not part of the rendered artifact
    if (isFacingAway(el)) return; // prune: 3D-rotated away (e.g. the back face of a flip card), not actually painted

    const siblingsOfTag = el.parentElement
      ? Array.from(el.parentElement.children).filter((c) => c.tagName.toLowerCase() === tag)
      : [el];
    const ordinal = siblingsOfTag.indexOf(el);
    const ownPath = parentPath + '/' + tag + ':' + ordinal;

    records.push({
      key: '',
      tag,
      id: el.id || null,
      classes: Array.from(el.classList),
      ordinal,
      parentPath,
      text: ownText(el),
      src: mediaSrc(el),
      geometry: geometryOf(el),
      computed: computedOf(el),
    });

    for (const child of Array.from(el.children)) {
      walk(child, ownPath);
    }
  }

  walk(document.body, '');
  return records;
})()`;
}

// Depth-first walk of the settled DOM from document.body, producing raw
// node records. Runs inside the page — see walkerSource() above for why
// it's a string rather than a closure. The routed-properties list is
// inlined into the source as a JSON literal (rather than passed via
// page.evaluate's `arg`) because Playwright evaluates a string
// pageFunction as a bare expression, not a function invoked with `arg`.
export async function walkPage(page: Page, routedProperties: readonly string[]): Promise<NodeRecord[]> {
  return page.evaluate(walkerSource(routedProperties)) as Promise<NodeRecord[]>;
}
