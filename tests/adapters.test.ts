// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findPromptBox, platformLabel, readPrompt, writePrompt } from '../src/content/adapters.ts';

/** jsdom has no layout, so every test declares where its elements sit. */
function place(el: Element, rect: Partial<DOMRect>): void {
  const r = { x: 0, y: 0, top: 500, left: 20, right: 700, bottom: 560, width: 680, height: 60, ...rect };
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...r, toJSON: () => r } as DOMRect);
}

beforeEach(() => {
  document.body.innerHTML = '';
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 1200, configurable: true });
});

describe('findPromptBox', () => {
  it('finds a plain composer textarea', () => {
    document.body.innerHTML = '<textarea placeholder="Message ChatGPT"></textarea>';
    place(document.querySelector('textarea')!, {});
    const box = findPromptBox();
    expect(box?.kind).toBe('textarea');
  });

  it('finds a ProseMirror contenteditable composer', () => {
    document.body.innerHTML =
      '<div class="ProseMirror" contenteditable="true" aria-label="Write your prompt to Claude"></div>';
    place(document.querySelector('div')!, {});
    expect(findPromptBox(document, 'claude.ai')?.kind).toBe('contenteditable');
  });

  it('prefers the bottom composer over a header search box', () => {
    document.body.innerHTML = `
      <input id="ignored" />
      <textarea id="search" role="search" placeholder="Search"></textarea>
      <textarea id="composer" placeholder="Ask anything"></textarea>`;
    place(document.getElementById('search')!, { top: 10, bottom: 44, height: 34, width: 300 });
    place(document.getElementById('composer')!, {});
    expect(findPromptBox()?.el.id).toBe('composer');
  });

  it('scores a host hint selector above a generic match', () => {
    document.body.innerHTML = `
      <div id="other" contenteditable="true"></div>
      <div id="prompt-textarea" contenteditable="true"></div>`;
    place(document.getElementById('other')!, { top: 520, bottom: 580 });
    place(document.getElementById('prompt-textarea')!, { top: 480, bottom: 540 });
    expect(findPromptBox(document, 'chatgpt.com')?.el.id).toBe('prompt-textarea');
  });

  it('still works when the hint selector has rotted away', () => {
    document.body.innerHTML = '<div id="brand-new-box" contenteditable="true" aria-label="Ask Gemini"></div>';
    place(document.getElementById('brand-new-box')!, {});
    expect(findPromptBox(document, 'gemini.google.com')?.el.id).toBe('brand-new-box');
  });

  it('ignores hidden, disabled and zero-size elements', () => {
    document.body.innerHTML = `
      <textarea id="a" disabled placeholder="Message"></textarea>
      <textarea id="b" readonly placeholder="Message"></textarea>
      <textarea id="c" aria-hidden="true" placeholder="Message"></textarea>
      <textarea id="d" placeholder="Message"></textarea>`;
    for (const id of ['a', 'b', 'c']) place(document.getElementById(id)!, {});
    place(document.getElementById('d')!, {});
    expect(findPromptBox()?.el.id).toBe('d');
  });

  it('never returns our own UI', () => {
    document.body.innerHTML = '<div data-prompt-copilot><textarea placeholder="Ask"></textarea></div>';
    place(document.querySelector('textarea')!, {});
    expect(findPromptBox()).toBeNull();
  });

  it('returns null on a page with nothing prompt-like', () => {
    document.body.innerHTML = '<p>hello</p><input type="checkbox" />';
    expect(findPromptBox()).toBeNull();
  });
});

describe('platformLabel', () => {
  it('names known hosts and falls back to the hostname', () => {
    expect(platformLabel('chatgpt.com')).toBe('ChatGPT');
    expect(platformLabel('claude.ai')).toBe('Claude');
    expect(platformLabel('www.perplexity.ai')).toBe('Perplexity');
    expect(platformLabel('example.com')).toBe('example.com');
  });
});

describe('readPrompt / writePrompt', () => {
  it('round-trips a textarea and notifies React-style listeners', () => {
    document.body.innerHTML = '<textarea placeholder="Message"></textarea>';
    const el = document.querySelector('textarea')!;
    place(el, {});
    const box = findPromptBox()!;
    const seen: string[] = [];
    el.addEventListener('input', () => seen.push(el.value));

    expect(writePrompt(box, 'improved text')).toBe(true);
    expect(readPrompt(box)).toBe('improved text');
    expect(seen).toEqual(['improved text']); // the site was told about the change
  });

  it('writes into a contenteditable and reports success', () => {
    document.body.innerHTML = '<div class="ProseMirror" contenteditable="true" aria-label="Ask"></div>';
    const el = document.querySelector('div')!;
    place(el, {});
    const box = findPromptBox()!;
    expect(writePrompt(box, 'improved text')).toBe(true);
    expect(readPrompt(box)).toBe('improved text');
  });

  it('preserves multiline, emoji and code content exactly', () => {
    document.body.innerHTML = '<textarea placeholder="Message"></textarea>';
    place(document.querySelector('textarea')!, {});
    const box = findPromptBox()!;
    const text = 'Fix this 🚀\n\n```java\nMap<String,String> m = new HashMap<>();\n```\n<script>&amp;';
    writePrompt(box, text);
    expect(readPrompt(box)).toBe(text);
  });
});
