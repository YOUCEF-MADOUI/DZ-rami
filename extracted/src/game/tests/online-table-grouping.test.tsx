// The online table groups melds exactly like the local one.
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_CONFIG, type Combination, type GameCard, type Rank, type Suit } from '@/game/core/types';
import { createInitialGameState, performDrawing, startNewRound } from '@/game/core/engine';
import { projectPlayerView } from '@/game/core/public-view';
import type { RoomView } from '@/game/online/protocol';
import OnlineGameScreen from '@/components/online/OnlineGameScreen';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  host?.remove();
  root = null;
  host = null;
});

let serial = 0;
const card = (rank: Rank, suit: Suit): GameCard => ({
  id: `online-${rank}-${suit}-${++serial}`,
  rank,
  suit,
  pack: 1,
  isJoker: false,
});

const tierce = (ownerId: string, rank: Rank, suit: Suit): Combination => ({
  id: `combo-${ownerId}-${rank}-${suit}`,
  type: 'tierce',
  ownerId,
  cards: [card(rank, suit), card(rank, suit), card(rank, suit)],
});

/** A started 3-player online room whose table already holds three melds. */
function roomWithTable(): RoomView {
  const config = { ...DEFAULT_CONFIG, playerCount: 3 as const };
  const names = ['Yacine', 'Amine', 'Karim'];
  let state = startNewRound(performDrawing(createInitialGameState(config, names)));

  // Take cards out of the stock so the deck stays a valid 108-card deck.
  const stock = [...state.deck];
  const pick = (rank: Rank, suit: Suit) => stock.splice(stock.findIndex(c => !c.isJoker && c.rank === rank && c.suit === suit), 1)[0];
  const meld = (ownerIdx: number, ranks: Rank[], suit: Suit): Combination => ({
    id: `online-meld-${ownerIdx}-${ranks[0]}-${suit}`,
    type: 'tierce',
    ownerId: state.players[ownerIdx].id,
    cards: ranks.map(rank => pick(rank, suit)),
  });
  state = {
    ...state,
    deck: stock,
    tableCombinations: [
      meld(1, ['3', '4', '5'], 'hearts'),
      meld(0, ['9', '10', 'J'], 'spades'),
      meld(2, ['Q', 'K', 'A'], 'clubs'),
      meld(1, ['6', '7', '8'], 'diamonds'),
    ],
  };

  const view = projectPlayerView(state, state.players[0].id);
  const ids = state.players.map(p => p.id);
  return {
    id: 'room-1',
    name: 'Table groupée',
    variant: 'classic',
    count: 3,
    capacity: 3,
    status: 'playing',
    spectatorCount: 0,
    viewerRole: 'player',
    allowReplacement: false,
    spectators: [],
    leftSeats: [],
    canReplace: false,
    private: false,
    revision: 1,
    hostPlayerId: ids[0],
    viewerId: ids[0],
    config,
    members: state.players.map((p, i) => ({
      playerId: p.id,
      name: p.name,
      ready: true,
      connected: true,
      seat: p.seat,
    })),
    game: {
      ...view,
      draw: null,
      pristine: false,
      viewerId: ids[0],
      roundNumber: 1,
      suite: state.suite,
      lastOpeningTotal: 0,
      vierge: state.initialThreshold,
      turnPhase: state.turnState?.phase ?? null,
      myDraft: [],
      actions: null,
      chopPending: false,
      chopMustOpen: false,
      phase: 'playing',
    },
  } as RoomView;
}

describe('online table grouping', () => {
  it('renders one box per player, with all of their melds inside', () => {
    const room = roomWithTable();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root!.render(
        <OnlineGameScreen
          room={room}
          disabled={false}
          send={async () => true}
          onBack={() => {}}
          onLeave={() => {}}
          onClaimHost={() => {}}
        />,
      );
    });

    const groups = Array.from(
      host.querySelectorAll('[aria-label="Combinaisons publiques"] [data-meld-group]'),
    );
    expect(groups).toHaveLength(3);
    expect(groups.map(group => group.getAttribute('data-meld-group'))).toEqual([
      room.game!.players[1].id,
      room.game!.players[0].id,
      room.game!.players[2].id,
    ]);
    expect(groups.map(group => group.querySelectorAll('[data-online-combo]').length)).toEqual([2, 1, 1]);
    expect(groups.map(group => group.querySelector('.meld-group-name')?.textContent)).toEqual([
      'Amine',
      'Yacine',
      'Karim',
    ]);
    // Nothing is rendered outside a group box.
    expect(
      Array.from(host.querySelectorAll('[aria-label="Combinaisons publiques"] > [data-online-combo]')),
    ).toHaveLength(0);
  });
});
