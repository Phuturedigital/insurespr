import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const conceptHost = 'insurespr-concept.phuturedigital.co.za';

test('concept hostname receives authoritative no-index and no-store headers', async () => {
  const config = JSON.parse(await readFile(path.join(root, 'vercel.json'), 'utf8'));
  const rule = config.headers.find((candidate) =>
    candidate.has?.some((condition) => condition.type === 'host' && condition.value === conceptHost)
  );
  assert.ok(rule, 'concept host-scoped header rule is required');
  const headers = new Map(rule.headers.map((header) => [header.key.toLowerCase(), header.value]));
  assert.match(headers.get('x-robots-tag') ?? '', /\bnoindex\b/i);
  assert.match(headers.get('x-robots-tag') ?? '', /\bnoimageindex\b/i);
  assert.match(headers.get('cache-control') ?? '', /\bno-store\b/i);
  assert.equal(headers.get('referrer-policy'), 'no-referrer');
});

test('concept hostname labels itself and exits before production integrations', async () => {
  const source = await readFile(path.join(root, 'production.js'), 'utf8');
  const disabledControls = [{ disabled: false }, { disabled: false }];
  let blockedSubmit = false;
  const form = {
    attributes: new Map(),
    setAttribute(name, value) { this.attributes.set(name, value); },
    querySelectorAll() { return disabledControls; },
    addEventListener(type, handler) {
      if (type === 'submit') {
        const event = { preventDefault() { blockedSubmit = true; } };
        handler(event);
      }
    }
  };
  const link = (href) => ({
    attributes: new Map([['href', href], ['target', '_blank']]),
    removeAttribute(name) { this.attributes.delete(name); },
    setAttribute(name, value) { this.attributes.set(name, value); },
    classList: { add(name) { this.owner.className = name; }, owner: null }
  });
  const contactLink = link('mailto:motselisi@bonevc.co.za');
  const directionsLink = link('https://www.google.com/maps/dir/?api=1&destination=7+Malibongwe+Drive');
  contactLink.classList.owner = contactLink;
  directionsLink.classList.owner = directionsLink;
  const robots = { setAttribute(name, value) { this[name] = value; } };
  let banner;
  let apiCalls = 0;
  const styleValues = new Map();
  const document = {
    documentElement: {
      classList: { add(name) { document.documentElement.className = name; } },
      style: { setProperty(name, value) { styleValues.set(name, value); } }
    },
    body: { prepend(node) { banner = node; } },
    querySelector(selector) { return selector === 'meta[name="robots"]' ? robots : null; },
    querySelectorAll(selector) {
      if (selector === 'form') return [form];
      if (selector.startsWith('a[')) return [contactLink, directionsLink];
      return [];
    },
    createElement() {
      return {
        attributes: new Map(),
        setAttribute(name, value) { this.attributes.set(name, value); },
        getBoundingClientRect() { return { height: 52 }; }
      };
    }
  };
  const window = {
    location: { hostname: conceptHost },
    addEventListener() {},
  };

  vm.runInNewContext(source, {
    window,
    document,
    fetch() { apiCalls += 1; throw new Error('concept preview must not call an API'); }
  });

  assert.equal(document.documentElement.className, 'is-concept-preview');
  assert.match(banner?.textContent ?? '', /concept preview/i);
  assert.match(banner?.textContent ?? '', /not a completed client case study/i);
  assert.match(robots.content ?? '', /\bnoindex\b/i);
  assert.equal(styleValues.get('--concept-preview-banner-height'), '52px');
  assert.ok(disabledControls.every((control) => control.disabled));
  assert.equal(form.attributes.get('inert'), '');
  assert.equal(blockedSubmit, true);
  assert.equal(contactLink.attributes.has('href'), false);
  assert.equal(contactLink.attributes.get('aria-disabled'), 'true');
  assert.equal(directionsLink.attributes.has('href'), false);
  assert.equal(directionsLink.attributes.get('aria-disabled'), 'true');
  assert.equal(apiCalls, 0);
});
