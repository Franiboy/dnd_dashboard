import { Link } from 'react-router-dom';

export function Home() {
  return (
    <div className="min-h-full p-6 flex flex-col items-center justify-center">
      <h1 className="text-5xl font-bold text-[var(--text-h)] mb-4">DnD Dashboard</h1>
      <p className="text-xl text-slate-400 mb-12">Wähle einen Bereich</p>
      <div className="grid gap-6 w-full max-w-2xl">
        <Link
          to="/bingo"
          className="group block bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 hover:border-[var(--accent)] transition"
        >
          <h2 className="text-2xl font-semibold text-[var(--text-h)] group-hover:text-[var(--accent)] transition">Bingo</h2>
          <p className="text-slate-400 mt-2">Aufgaben sammeln, Bingo-Runde starten und gegeneinander spielen.</p>
        </Link>
        <Link
          to="/recordings"
          className="group block bg-[var(--panel)] border border-[var(--border)] rounded-2xl p-8 hover:border-[var(--accent)] transition"
        >
          <h2 className="text-2xl font-semibold text-[var(--text-h)] group-hover:text-[var(--accent)] transition">Aufnahmen</h2>
          <p className="text-slate-400 mt-2">Discord-Sessions aufnehmen, transkribieren und als Text einsehen.</p>
        </Link>
      </div>
    </div>
  );
}
