import { Modal } from './Modal';
import { typeLabels } from '../lib/entityLabels';
import type { EntityType } from '../../shared/types';

export interface EntityCandidate {
  type: EntityType;
  name: string;
  qualifier: string;
  miniSummary?: string | null;
}

interface EntityChooserModalProps {
  candidates: EntityCandidate[];
  onClose: () => void;
  onPick: (candidate: EntityCandidate) => void;
}

/**
 * Asks the user which homonym was meant when a text mention matches several
 * entities with the same name (e.g. two "Kerigan").
 */
export function EntityChooserModal({ candidates, onClose, onPick }: EntityChooserModalProps) {
  return (
    <Modal isOpen title="Welche Entität ist gemeint?" onClose={onClose} className="max-w-md">
      <div className="space-y-2">
        <p className="text-sm text-slate-400">
          Dieser Name passt zu mehreren Entitäten. Welche soll geöffnet werden?
        </p>
        {candidates.map((candidate) => (
          <button
            key={`${candidate.type}-${candidate.name}-${candidate.qualifier}`}
            type="button"
            onClick={() => onPick(candidate)}
            className="w-full text-left px-3 py-2 rounded border border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 transition"
          >
            <span className="block text-sm font-medium text-[var(--text-h)]">
              {candidate.qualifier ? `${candidate.name} (${candidate.qualifier})` : candidate.name}
            </span>
            <span className="block text-xs text-slate-500">
              {typeLabels[candidate.type]}
              {candidate.miniSummary ? ` — ${candidate.miniSummary}` : ''}
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
