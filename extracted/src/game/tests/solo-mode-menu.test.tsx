// The solo mode screen owns every table choice, including the 2-versus-2 variant.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '../core/types';
import HomeScreen from '@/components/HomeScreen';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

function renderHome(onStartSolo: (count: 2 | 3 | 4 | 5, teams?: boolean) => void) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <HomeScreen
        onStartSolo={onStartSolo}
        onStartMulti={() => {}}
        onSettings={() => {}}
        config={DEFAULT_CONFIG}
      />,
    );
  });
  return host;
}

function buttons(container: HTMLElement) {
  return Array.from(container.querySelectorAll('button')).map(button =>
    (button.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );
}

function buttonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(button =>
    (button.textContent ?? '').replace(/\s+/g, ' ').includes(text),
  );
}

describe('solo mode menu', () => {
  it('does not offer the 2v2 game in the main menu any more', () => {
    const container = renderHome(() => {});
    const menu = buttons(container);
    expect(menu.some(label => label.includes('2 contre 2'))).toBe(false);
    expect(menu.some(label => label.includes('Mode Solo'))).toBe(true);
  });

  it('lists the five table choices in the expected order', () => {
    const container = renderHome(() => {});
    act(() => buttonByText(container, 'Mode Solo')!.click());
    const labels = Array.from(container.querySelectorAll('button[aria-pressed]')).map(button =>
      (button.querySelector('span')?.textContent ?? button.textContent ?? '').trim(),
    );
    expect(labels).toEqual([
      '2 Joueurs',
      '3 Joueurs',
      '4 Joueurs',
      '4 Joueurs — 2 contre 2',
      '5 Joueurs',
    ]);
  });

  it('starts a classic game with the highlighted player count', () => {
    const calls: [number, boolean | undefined][] = [];
    const container = renderHome((count, teams) => calls.push([count, teams]));
    act(() => buttonByText(container, 'Mode Solo')!.click());
    act(() => buttonByText(container, '3 Joueurs')!.click());
    act(() => buttonByText(container, 'Commencer')!.click());
    expect(calls).toEqual([[3, false]]);
  });

  it('starts the 2v2 variant with four seats from the same screen', () => {
    const calls: [number, boolean | undefined][] = [];
    const container = renderHome((count, teams) => calls.push([count, teams]));
    act(() => buttonByText(container, 'Mode Solo')!.click());
    act(() => buttonByText(container, '4 Joueurs — 2 contre 2')!.click());
    expect(buttonByText(container, '5 Joueurs')!.getAttribute('aria-pressed')).toBe('false');
    expect(
      buttonByText(container, '4 Joueurs — 2 contre 2')!.getAttribute('aria-pressed'),
    ).toBe('true');
    act(() => buttonByText(container, 'Commencer')!.click());
    expect(calls).toEqual([[4, true]]);
  });
});
