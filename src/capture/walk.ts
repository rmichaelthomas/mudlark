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

  function mediaSrc(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a' || tag === 'link') {
      return el.href || null;
    }
    if ('src' in el) {
      return el.src || null;
    }
    return null;
  }

  function geometryOf(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + window.scrollX, y: rect.top + window.scrollY, w: rect.width, h: rect.height };
  }

  function computedOf(el) {
    const style = getComputedStyle(el);
    const out = {};
    for (const prop of props) {
      out[prop] = style[prop] || '';
    }
    return out;
  }

  const records = [];

  function walk(el, parentPath) {
    const tag = el.tagName.toLowerCase();
    if (SKIP_TAGS.has(tag)) return;
    if (getComputedStyle(el).display === 'none') return; // prune: subtree is not part of the rendered artifact

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
