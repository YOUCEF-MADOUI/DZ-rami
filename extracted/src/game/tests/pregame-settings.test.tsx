// "Commencer" always opens the rules of the pending table before the deal.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG } from '../core/types';
import SettingsScreen from '@/components/SettingsScreen';
import Page from '@/app/page';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
  window.localStorage.clear();
});

async function flush(ms = 40) {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, ms));
  });
}

async function mountPage() {
  const container = mount(<Page />);
  // The page loads the stored config in a deferred effect.
  await flush();
  return container;
}

function mount(element: React.ReactElement) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(element));
  return host;
}

function buttonByText(container: ParentNode, text: string) {
  return Array.from(container.querySelectorAll('button')).find(button =>
    (button.textContent ?? '').replace(/\s+/g, ' ').includes(text),
  );
}

function press(container: ParentNode, text: string) {
  const button = buttonByText(container, text);
  expect(button, `button "${text}"`).toBeTruthy();
  act(() => button!.click());
}

describe('pre-game settings', () => {
  it('describes the pending table and starts it instead of just saving', () => {
    let saved: typeof DEFAULT_CONFIG | null = null;
    const container = mount(
      <SettingsScreen
        config={DEFAULT_CONFIG}
        preGame={{ table: '4 Joueurs — 2 contre 2', detail: '2 équipes de 2' }}
        onSave={config => { saved = config; }}
        onBack={() => {}}
      />,
    );
    expect(container.querySelector('[data-pregame-summary]')?.textContent).toContain('4 Joueurs — 2 contre 2');
    expect(container.querySelector('[data-pregame-summary]')?.textContent).toContain('2 équipes de 2');
    expect(buttonByText(container, 'Sauvegarder')).toBeUndefined();
    press(container, 'Commencer la partie');
    expect(saved).not.toBeNull();
    expect(saved!.maxCycles).toBe(DEFAULT_CONFIG.maxCycles);
  });

  it('keeps the plain "Sauvegarder" behaviour outside a pending game', () => {
    const container = mount(
      <SettingsScreen config={DEFAULT_CONFIG} onSave={() => {}} onBack={() => {}} />,
    );
    expect(container.querySelector('[data-pregame-summary]')).toBeNull();
    expect(buttonByText(container, 'Sauvegarder')).toBeTruthy();
    expect(buttonByText(container, 'Commencer la partie')).toBeUndefined();
  });

  it('sends the edited rules to the launch', () => {
    let saved: typeof DEFAULT_CONFIG | null = null;
    const container = mount(
      <SettingsScreen
        config={DEFAULT_CONFIG}
        preGame={{ table: '3 Joueurs' }}
        onSave={config => { saved = config; }}
        onBack={() => {}}
      />,
    );
    const cycles = container.querySelectorAll('[data-setting="maxCycles"] button');
    act(() => (cycles[1] as HTMLButtonElement).click());
    press(container, 'Commencer la partie');
    expect(saved!.maxCycles).toBe(DEFAULT_CONFIG.maxCycles + 1);
  });
});

describe('start flow', () => {
  it('opens the rules when "Commencer" is pressed, without dealing', async () => {
    const container = await mountPage();
    press(container, 'Mode Solo');
    press(container, '5 Joueurs');
    press(container, 'Commencer');
    expect(container.querySelector('[data-pregame-summary]')?.textContent).toContain('5 Joueurs');
    expect(container.querySelector('[data-pregame-start="true"]')).toBeTruthy();
    // No table has been dealt yet: the game screen is not mounted.
    expect(container.querySelector('[data-ci]')).toBeNull();
    expect(container.querySelector('.game-table-surface')).toBeNull();
  });

  it('"Changer de table" returns to the same setup, count and names kept', async () => {
    const container = await mountPage();
    press(container, 'Multijoueur');
    press(container, 'Mode local existant');
    press(container, '3J');
    const inputs = container.querySelectorAll('input[type="text"]');
    act(() => {
      const first = inputs[0] as HTMLInputElement;
      // React tracks the value setter, so go through the native one.
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      setter.call(first, 'Yacine');
      first.dispatchEvent(new Event('input', { bubbles: true }));
    });
    press(container, 'Commencer');
    expect(container.querySelector('[data-pregame-summary]')?.textContent).toContain('3 joueurs');
    press(container, 'Changer de table');
    expect(buttonByText(container, 'Commencer')).toBeTruthy();
    const later = Array.from(container.querySelectorAll('input[type="text"]')) as HTMLInputElement[];
    expect(later.length).toBe(3);
    expect(later[0].value).toBe('Yacine');
  });
});
