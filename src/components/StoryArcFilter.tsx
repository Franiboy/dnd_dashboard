import { useStoryArcs } from '../hooks/useStoryArcs';
import { formatArcLabel } from '../lib/storyArcs';

/** Global story-arc filter select; rendered in the app header. */
export function StoryArcFilter() {
  const { arcs, selectedArcId, setSelectedArcId } = useStoryArcs();

  return (
    <div className="relative flex items-center">
      <select
        value={selectedArcId === null ? '' : String(selectedArcId)}
        onChange={(e) => {
          const raw = e.target.value;
          setSelectedArcId(raw === '' ? null : raw === 'none' ? 'none' : Number(raw));
        }}
        title="Story Arc filtern (wirkt auf Sessions, Tagebuch und Welt)"
        aria-label="Story-Arc-Filter"
        className="appearance-none bg-slate-900/60 border border-[var(--border)] hover:border-slate-600 rounded-lg pl-2 pr-6 py-1 text-xs font-medium text-slate-300 focus:outline-none focus:border-[var(--accent)] max-w-[12rem] min-w-0 cursor-pointer transition-colors"
      >
        <option value="">Alle Story Arcs</option>
        <option value="none">Ohne Arc</option>
        {arcs.map((arc) => (
          <option key={arc.id} value={arc.id}>
            {formatArcLabel(arc)}
          </option>
        ))}
      </select>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </div>
  );
}
