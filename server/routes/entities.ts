import { Router } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { db } from '../database.js';
import type { DiaryEntities } from '../ai/rewrite.js';
import { isAiEnabled } from '../ai/config.js';
import {
  distributeKnowledgeFromText,
  correctKnowledgeFromText,
  reviewEntityKnowledge,
  generateEntitySummary,
} from '../ai/knowledge.js';
import {
  addEntityAlias,
  blacklistEntity,
  getBlacklistedEntities,
  getEntityDetail,
  getEntityMappings,
  reclassifyEntity,
  unblacklistEntity,
  updateEntity,
} from '../repositories/diary.js';
import {
  createEntityKnowledge,
  getEntityKnowledgeEntry,
  listEntityKnowledge,
  markEntityKnowledgeDeleted,
  markEntityKnowledgeTimelineEnd,
  updateEntityKnowledge,
} from '../repositories/entityKnowledge.js';
import { getCurrentGameDay } from '../repositories/gameTimeline.js';
import { getEntitySummary, setEntityMiniSummary } from '../repositories/entitySummaries.js';

const router = Router();

const ENTITY_TYPES: Array<keyof DiaryEntities> = ['persons', 'organizations', 'locations', 'items'];

router.use(authMiddleware, requireApproved);

router.get('/mappings', (_req: AuthRequest, res) => {
  try {
    res.json({ mappings: getEntityMappings() });
  } catch {
    res.status(500).json({ error: 'Mappings konnten nicht geladen werden' });
  }
});

router.get('/', (_req: AuthRequest, res) => {
  const fetchRefs = (table: string) => {
    const rows = db
      .prepare(
        `SELECT name, qualifier FROM ${table} ORDER BY name COLLATE NOCASE, qualifier COLLATE NOCASE`
      )
      .all() as { name: string; qualifier?: string }[];
    return rows.map((row) => ({ name: row.name, qualifier: row.qualifier ?? '' }));
  };

  const entities = {
    persons: fetchRefs('persons'),
    organizations: fetchRefs('organizations'),
    locations: fetchRefs('locations'),
    items: fetchRefs('items'),
  };

  res.json({ ...entities, currentGameDay: getCurrentGameDay() });
});

router.get('/blacklist', (_req: AuthRequest, res) => {
  try {
    res.json(getBlacklistedEntities());
  } catch {
    res.status(500).json({ error: 'Blacklist konnte nicht geladen werden' });
  }
});

router.post('/blacklist', (req: AuthRequest, res) => {
  const { name, type } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }
  if (!type || !ENTITY_TYPES.includes(type)) {
    res.status(400).json({ error: 'Gültiger Typ ist erforderlich' });
    return;
  }

  try {
    blacklistEntity(name.trim(), type);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Blacklisten fehlgeschlagen' });
  }
});

router.post('/unblacklist', (req: AuthRequest, res) => {
  const { name, type } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }
  if (!type || !ENTITY_TYPES.includes(type)) {
    res.status(400).json({ error: 'Gültiger Typ ist erforderlich' });
    return;
  }

  try {
    unblacklistEntity(name.trim(), type);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Entfernen fehlgeschlagen' });
  }
});

router.post('/reclassify', (req: AuthRequest, res) => {
  const { name, qualifier, fromType, toType } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }
  if (!fromType || !ENTITY_TYPES.includes(fromType) || !toType || !ENTITY_TYPES.includes(toType)) {
    res.status(400).json({ error: 'Gültige Typen sind erforderlich' });
    return;
  }

  try {
    reclassifyEntity(
      name.trim(),
      fromType,
      toType,
      typeof qualifier === 'string' ? qualifier.trim() : ''
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Reklassifizierung fehlgeschlagen' });
  }
});

router.post('/alias', (req: AuthRequest, res) => {
  const { type, alias, canonical, canonicalQualifier } = req.body;
  if (
    !alias ||
    typeof alias !== 'string' ||
    !alias.trim() ||
    !canonical ||
    typeof canonical !== 'string' ||
    !canonical.trim()
  ) {
    res.status(400).json({ error: 'Alias und Zielname sind erforderlich' });
    return;
  }
  if (!type || !ENTITY_TYPES.includes(type)) {
    res.status(400).json({ error: 'Gültiger Typ ist erforderlich' });
    return;
  }

  try {
    addEntityAlias(
      type,
      alias.trim(),
      canonical.trim(),
      typeof canonicalQualifier === 'string' ? canonicalQualifier.trim() : ''
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Verknüpfen fehlgeschlagen' });
  }
});

router.get('/detail', (req: AuthRequest, res) => {
  const { type, name, qualifier } = req.query;
  if (
    !type ||
    typeof type !== 'string' ||
    !ENTITY_TYPES.includes(type as keyof DiaryEntities) ||
    !name ||
    typeof name !== 'string' ||
    !name.trim()
  ) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  try {
    const detail = getEntityDetail(
      type as keyof DiaryEntities,
      name.trim(),
      typeof qualifier === 'string' ? qualifier : ''
    );
    if (!detail) {
      res.status(404).json({ error: 'Entität nicht gefunden' });
      return;
    }
    res.json(detail);
  } catch {
    res.status(500).json({ error: 'Laden fehlgeschlagen' });
  }
});

router.put('/detail', (req: AuthRequest, res) => {
  const { type, oldName, oldQualifier, newName, newQualifier, aliases } = req.body;
  if (
    !type ||
    !ENTITY_TYPES.includes(type) ||
    !oldName ||
    typeof oldName !== 'string' ||
    !oldName.trim() ||
    !newName ||
    typeof newName !== 'string' ||
    !newName.trim() ||
    !Array.isArray(aliases)
  ) {
    res.status(400).json({ error: 'Gültige Daten sind erforderlich' });
    return;
  }

  try {
    updateEntity(
      type,
      oldName.trim(),
      newName.trim(),
      aliases.map((a: unknown) => String(a).trim()).filter(Boolean),
      typeof oldQualifier === 'string' ? oldQualifier.trim() : '',
      typeof newQualifier === 'string' ? newQualifier.trim() : ''
    );
    res.json({ ok: true });
  } catch (err) {
    res
      .status(500)
      .json({ error: err instanceof Error ? err.message : 'Speichern fehlgeschlagen' });
  }
});

router.get('/knowledge', (req: AuthRequest, res) => {
  const { type, name, qualifier } = req.query;
  if (
    !type ||
    typeof type !== 'string' ||
    !ENTITY_TYPES.includes(type as keyof DiaryEntities) ||
    !name ||
    typeof name !== 'string' ||
    !name.trim()
  ) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  try {
    const entries = listEntityKnowledge(
      type as keyof DiaryEntities,
      name.trim(),
      typeof qualifier === 'string' ? qualifier : ''
    );
    res.json({ entries, currentGameDay: getCurrentGameDay() });
  } catch {
    res.status(500).json({ error: 'Laden fehlgeschlagen' });
  }
});

router.post('/knowledge', (req: AuthRequest, res) => {
  const { type, name, qualifier, title, content, validFrom, validUntil } = req.body;
  if (!type || !ENTITY_TYPES.includes(type) || !name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }
  if (!content || typeof content !== 'string' || !content.trim()) {
    res.status(400).json({ error: 'Inhalt ist erforderlich' });
    return;
  }

  const normInt = (v: unknown): number | null =>
    v === undefined || v === null ? null : Number.isInteger(Number(v)) ? Number(v) : null;

  try {
    const entry = createEntityKnowledge(
      type,
      name.trim(),
      title && typeof title === 'string' ? title.trim() : null,
      content.trim(),
      'manual',
      typeof qualifier === 'string' ? qualifier.trim() : '',
      normInt(validFrom),
      normInt(validUntil)
    );
    res.status(201).json({ entry });
  } catch {
    res.status(500).json({ error: 'Speichern fehlgeschlagen' });
  }
});

router.put('/knowledge/:id', (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  const { title, content, validFrom, validUntil } = req.body;
  const updates: {
    title?: string | null;
    content?: string;
    validFrom?: number | null;
    validUntil?: number | null;
  } = {};
  if (title !== undefined) {
    updates.title = title && typeof title === 'string' ? title.trim() : null;
  }
  if (content !== undefined) {
    if (typeof content !== 'string' || !content.trim()) {
      res.status(400).json({ error: 'Inhalt ist erforderlich' });
      return;
    }
    updates.content = content.trim();
  }
  if (validFrom !== undefined) {
    updates.validFrom =
      validFrom === null ? null : Number.isInteger(Number(validFrom)) ? Number(validFrom) : null;
  }
  if (validUntil !== undefined) {
    updates.validUntil =
      validUntil === null ? null : Number.isInteger(Number(validUntil)) ? Number(validUntil) : null;
  }

  try {
    const existing = getEntityKnowledgeEntry(id);
    if (!existing) {
      res.status(404).json({ error: 'Eintrag nicht gefunden' });
      return;
    }
    const entry = updateEntityKnowledge(id, updates);
    if (!entry) {
      res.status(500).json({ error: 'Aktualisieren fehlgeschlagen' });
      return;
    }
    res.json({ entry });
  } catch {
    res.status(500).json({ error: 'Aktualisieren fehlgeschlagen' });
  }
});

router.delete('/knowledge/:id', (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  const { reason } = req.body;
  const deleteReason =
    typeof reason === 'string' && reason.trim() ? reason.trim() : 'Manuell als gelöscht markiert';

  try {
    const existing = getEntityKnowledgeEntry(id);
    if (!existing) {
      res.status(404).json({ error: 'Eintrag nicht gefunden' });
      return;
    }
    const entry = markEntityKnowledgeDeleted(id, deleteReason);
    res.json({ entry });
  } catch {
    res.status(500).json({ error: 'Löschen fehlgeschlagen' });
  }
});

router.post('/knowledge/:id/end', (req: AuthRequest, res) => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Ungültige ID' });
    return;
  }

  const { until, reason } = req.body;
  const untilNum = Number(until);
  if (!Number.isInteger(untilNum) || untilNum <= 0) {
    res.status(400).json({ error: 'Gültiger "until" (Spieltag) ist erforderlich' });
    return;
  }
  const endReason =
    typeof reason === 'string' && reason.trim()
      ? reason.trim()
      : 'Gilt ab diesem Spieltag nicht mehr';

  try {
    const existing = getEntityKnowledgeEntry(id);
    if (!existing) {
      res.status(404).json({ error: 'Eintrag nicht gefunden' });
      return;
    }
    if (existing.status !== 'active') {
      res.status(400).json({ error: 'Nur aktive Einträge können beendet werden' });
      return;
    }
    const entry = markEntityKnowledgeTimelineEnd(id, untilNum, endReason);
    res.json({ entry });
  } catch {
    res.status(500).json({ error: 'Beenden fehlgeschlagen' });
  }
});

router.post('/knowledge/distribute', async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const { text } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Text ist erforderlich' });
    return;
  }

  try {
    const result = await distributeKnowledgeFromText(text.trim(), { user: req.user });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'KI-Einordnung fehlgeschlagen' });
  }
});

router.post('/knowledge/correct', async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const { text, type, name, qualifier } = req.body;
  if (!text || typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'Text ist erforderlich' });
    return;
  }

  let focus:
    | { entityType: (typeof ENTITY_TYPES)[number]; entityName: string; entityQualifier: string }
    | undefined;
  if (type !== undefined || name !== undefined) {
    if (
      !type ||
      !ENTITY_TYPES.includes(type) ||
      !name ||
      typeof name !== 'string' ||
      !name.trim()
    ) {
      res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
      return;
    }
    focus = {
      entityType: type,
      entityName: name.trim(),
      entityQualifier: typeof qualifier === 'string' ? qualifier.trim() : '',
    };
  }

  try {
    const result = await correctKnowledgeFromText(text.trim(), focus, { user: req.user });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'KI-Berichtigung fehlgeschlagen' });
  }
});

router.post('/knowledge/review', async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const { type, name, qualifier } = req.body;
  if (!type || !ENTITY_TYPES.includes(type) || !name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  try {
    const result = await reviewEntityKnowledge(type, name.trim(), {
      qualifier: typeof qualifier === 'string' ? qualifier.trim() : '',
      user: req.user,
    });
    res.json(result);
  } catch {
    res.status(500).json({ error: 'KI-Prüfung fehlgeschlagen' });
  }
});

router.get('/summary', (req: AuthRequest, res) => {
  const { type, name, qualifier } = req.query;
  if (
    !type ||
    !ENTITY_TYPES.includes(type as keyof DiaryEntities) ||
    !name ||
    typeof name !== 'string' ||
    !name.trim()
  ) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  try {
    const summaryQualifier = typeof qualifier === 'string' ? qualifier : '';
    const summary = getEntitySummary(type as keyof DiaryEntities, name.trim(), summaryQualifier);
    res.json(
      summary ?? {
        entityType: type,
        entityName: name.trim(),
        entityQualifier: summaryQualifier,
        summary: null,
        miniSummary: null,
        isDirty: true,
        updatedAt: null,
      }
    );
  } catch {
    res.status(500).json({ error: 'Zusammenfassung konnte nicht geladen werden' });
  }
});

router.post('/summary/generate', async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    res.status(503).json({ error: 'KI-Feature ist nicht konfiguriert' });
    return;
  }

  const { type, name, qualifier } = req.body;
  if (!type || !ENTITY_TYPES.includes(type) || !name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  try {
    const result = await generateEntitySummary(type, name.trim(), {
      user: req.user,
      qualifier: typeof qualifier === 'string' ? qualifier.trim() : '',
    });
    if (result === null) {
      res.status(500).json({ error: 'KI-Zusammenfassung fehlgeschlagen' });
      return;
    }
    res.json({ summary: result.summary, miniSummary: result.miniSummary });
  } catch {
    res.status(500).json({ error: 'KI-Zusammenfassung fehlgeschlagen' });
  }
});

router.put('/mini-summary', (req: AuthRequest, res) => {
  const { type, name, qualifier, miniSummary } = req.body;
  if (!type || !ENTITY_TYPES.includes(type) || !name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Gültiger Typ und Name sind erforderlich' });
    return;
  }

  const normalizedMini = typeof miniSummary === 'string' ? miniSummary.trim() : null;

  try {
    const entry = setEntityMiniSummary(
      type,
      name.trim(),
      normalizedMini,
      typeof qualifier === 'string' ? qualifier.trim() : ''
    );
    res.json({ miniSummary: entry.miniSummary });
  } catch {
    res.status(500).json({ error: 'Mini-Zusammenfassung konnte nicht gespeichert werden' });
  }
});

export default router;
