'use client';

import { GameState } from '@/game/core/types';

interface Props {
  onBack: () => void;
  gameState?: GameState | null;
}

export default function ScoreBoard({ onBack, gameState }: Props) {
  if (!gameState || gameState.players.length === 0) {
    return (
      <div className="h-full flex flex-col bg-slate-900">
        <div className="flex items-center p-4 border-b border-slate-700">
          <button onClick={onBack} className="text-amber-400 font-bold mr-4">← Retour</button>
          <h2 className="text-xl font-bold text-amber-400 flex-1 text-center">📊 Scores</h2>
          <div className="w-16" />
        </div>
        <div className="flex-1 flex items-center justify-center text-slate-500">
          Aucune partie en cours
        </div>
      </div>
    );
  }

  const players = gameState.players;
  const rounds = gameState.roundResults;

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <div className="flex items-center p-4 border-b border-slate-700">
        <button onClick={onBack} className="text-amber-400 font-bold mr-4">← Retour</button>
        <h2 className="text-xl font-bold text-amber-400 flex-1 text-center">📊 Tableau des Scores</h2>
        <div className="w-16" />
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="overflow-x-auto">
          <table className="score-table">
            <thead>
              <tr>
                <th className="text-amber-400">Manche</th>
                {players.map(p => (
                  <th key={p.id} className="text-amber-400">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((round, i) => (
                <tr key={i}>
                  <td className="font-bold text-slate-300">R{i + 1}</td>
                  {players.map(p => {
                    const score = round.scores[p.id] ?? 0;
                    const isWinner = round.winnerId === p.id;
                    return (
                      <td
                        key={p.id}
                        className={`${
                          isWinner
                            ? 'text-green-400 font-bold'
                            : score >= 100
                              ? 'text-red-400'
                              : 'text-slate-300'
                        }`}
                      >
                        {isWinner ? (round.endType === 'RJ' ? 'RJ' : 'RS') : score}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="bg-slate-700">
                <td className="font-bold text-amber-400">Total</td>
                {players.map(p => (
                  <td key={p.id} className="font-bold text-amber-400">{p.score}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        {rounds.length === 0 && (
          <div className="text-center text-slate-500 mt-8">
            Aucune manche jouée
          </div>
        )}
      </div>
    </div>
  );
}
