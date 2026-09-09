import { Router } from 'express';
import { z } from 'zod';
import { AppError, orFail, parseWith } from '../errors.js';
import { aiRateLimit } from '../utils/rateLimits.js';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
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
  findEntityCanonical,
  getBlacklistedEntities,
  getEntityDetail,
  getEntityMappings,
  listAllEntityRefs,
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
import {
  getStoryArcDayRange,
  knowledgeOverlapsArcRange,
  linkStoryArcEntity,
  listArcIdsForEntity,
  listEntitiesForArc,
  listEntitiesOutsideArcs,
  storyArcExists,
  unlinkStoryArcEntity,
} from '../repositories/storyArcs.js';

const router = Router();

const entityTypes = ['persons', 'organizations', 'locations', 'items'] as const;
type EntityType = (typeof entityTypes)[number];

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const entityTypeSchema = z.enum(entityTypes, { error: 'Gültiger Typ ist erforderlich' });

/** Non-empty trimmed string; message shared by combined type+name validators. */
function requiredNameSchema(message: string) {
  return z.string({ error: message }).trim().min(1, message);
}

/** Coerces anything that is not a string (incl. null/undefined) to '' and trims. */
const looseTrimmed = z.preprocess(
  (v) => (typeof v === 'string' ? v : ''),
  z.string().transform((v) => v.trim())
);

const entityQuerySchema = z.object({
  type: z.enum(entityTypes, { error: 'Gültiger Typ und Name sind erforderlich' }),
  name: requiredNameSchema('Gültiger Typ und Name sind erforderlich'),
  qualifier: looseTrimmed,
});

/** Optional arcId filter: absent, 'none' ("Ohne Arc") or an existing arc id. */
const arcIdFilterSchema = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z
    .union([z.literal('none'), z.coerce.number().int().positive()], {
      error: 'arcId muss eine positive ganze Zahl oder "none" sein',
    })
    .optional()
);

/** arcId for AI runs: absent or an existing arc id ('none' is rejected). */
const aiArcIdSchema = z.preprocess(
  (v) => (v === '' || v === null ? undefined : v),
  z.coerce.number().int().positive({ error: 'arcId muss eine positive ganze Zahl sein' }).optional()
);

const arcLinkArcIdSchema = z.coerce
  .number()
  .int()
  .positive({ error: 'Gültige arcId ist erforderlich' });

const nameTypeSchema = z.object({
  name: requiredNameSchema('Name ist erforderlich'),
  type: entityTypeSchema,
});

const reclassifySchema = z.object({
  name: requiredNameSchema('Name ist erforderlich'),
  qualifier: looseTrimmed,
  fromType: z.enum(entityTypes, { error: 'Gültige Typen sind erforderlich' }),
  toType: z.enum(entityTypes, { error: 'Gültige Typen sind erforderlich' }),
});

const aliasSchema = z.object({
  type: entityTypeSchema,
  alias: requiredNameSchema('Alias und Zielname sind erforderlich'),
  canonical: requiredNameSchema('Alias und Zielname sind erforderlich'),
  canonicalQualifier: looseTrimmed,
});

const updateEntitySchema = z.object({
  type: z.enum(entityTypes, { error: 'Gültige Daten sind erforderlich' }),
  oldName: requiredNameSchema('Gültige Daten sind erforderlich'),
  newName: requiredNameSchema('Gültige Daten sind erforderlich'),
  oldQualifier: looseTrimmed,
  newQualifier: looseTrimmed,
  aliases: z
    .array(z.coerce.string(), { error: 'Gültige Daten sind erforderlich' })
    .transform((list) => list.map((a) => a.trim()).filter(Boolean)),
});

const createKnowledgeSchema = z.object({
  type: z.enum(entityTypes, { error: 'Gültiger Typ und Name sind erforderlich' }),
  name: requiredNameSchema('Gültiger Typ und Name sind erforderlich'),
  qualifier: looseTrimmed,
  title: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : null),
    z.string().nullable()
  ),
  content: requiredNameSchema('Inhalt ist erforderlich'),
  validFrom: z.unknown().transform(normGameDayOrNull),
  validUntil: z.unknown().transform(normGameDayOrNull),
});

const idParamSchema = z.coerce.number().int().positive({ error: 'Ungültige ID' });

const knowledgeEndSchema = z.object({
  until: z.coerce
    .number()
    .int()
    .positive({ error: 'Gültiger "until" (Spieltag) ist erforderlich' }),
  reason: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() ? v.trim() : undefined),
    z.string().optional()
  ),
});

const textSchema = z.preprocess(
  (v) => (typeof v === 'string' ? v : ''),
  z.string().trim().min(1, 'Text ist erforderlich')
);

const miniSummarySchema = z.object({
  type: z.enum(entityTypes, { error: 'Gültiger Typ und Name sind erforderlich' }),
  name: requiredNameSchema('Gültiger Typ und Name sind erforderlich'),
  qualifier: looseTrimmed,
  miniSummary: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : null),
    z.string().nullable()
  ),
});

/** Normalizes a game-day reference: absent/invalid becomes null. */
function normGameDayOrNull(v: unknown): number | null {
  if (v === undefined || v === null) return null;
  return Number.isInteger(Number(v)) ? Number(v) : null;
}

/** Validates that a numeric arc filter references an existing arc. */
function requireExistingArc(value: number, status = 400): number {
  if (!storyArcExists(value)) {
    throw new AppError(status, 'Story Arc nicht gefunden');
  }
  return value;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

router.use(authMiddleware, requireApproved);

router.get('/mappings', (_req: AuthRequest, res) => {
  res.json({
    mappings: orFail('Mappings konnten nicht geladen werden', () => getEntityMappings()),
  });
});

router.get('/', (req: AuthRequest, res) => {
  const arc = parseWith(arcIdFilterSchema, req.query.arcId);
  if (typeof arc === 'number') requireExistingArc(arc);

  if (arc === 'none') {
    // "Ohne Arc": only entities that are assigned to no story arc at all.
    res.json({ ...listEntitiesOutsideArcs(), currentGameDay: getCurrentGameDay() });
    return;
  }
  if (arc !== undefined) {
    // Arc-filtered world view: only entities assigned to this story arc.
    const filtered = listEntitiesForArc(arc);
    res.json({ ...filtered, currentGameDay: getCurrentGameDay() });
    return;
  }

  const refs = orFail('Entitäten konnten nicht geladen werden', () => listAllEntityRefs());
  res.json({ ...refs, currentGameDay: getCurrentGameDay() });
});

router.get('/blacklist', (_req: AuthRequest, res) => {
  res.json(orFail('Blacklist konnte nicht geladen werden', () => getBlacklistedEntities()));
});

router.post('/blacklist', (req: AuthRequest, res) => {
  const { name, type } = parseWith(nameTypeSchema, req.body);
  orFail('Blacklisten fehlgeschlagen', () => blacklistEntity(name, type));
  res.json({ ok: true });
});

router.post('/unblacklist', (req: AuthRequest, res) => {
  const { name, type } = parseWith(nameTypeSchema, req.body);
  orFail('Entfernen fehlgeschlagen', () => unblacklistEntity(name, type));
  res.json({ ok: true });
});

router.post('/reclassify', (req: AuthRequest, res) => {
  const { name, qualifier, fromType, toType } = parseWith(reclassifySchema, req.body);
  orFail('Reklassifizierung fehlgeschlagen', () =>
    reclassifyEntity(name, fromType, toType, qualifier)
  );
  res.json({ ok: true });
});

router.post('/alias', (req: AuthRequest, res) => {
  const { type, alias, canonical, canonicalQualifier } = parseWith(aliasSchema, req.body);
  orFail('Verknüpfen fehlgeschlagen', () =>
    addEntityAlias(type, alias, canonical, canonicalQualifier)
  );
  res.json({ ok: true });
});

router.get('/detail', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.query);
  const detail = orFail('Laden fehlgeschlagen', () => getEntityDetail(type, name, qualifier));
  if (!detail) {
    throw new AppError(404, 'Entität nicht gefunden');
  }
  res.json(detail);
});

router.put('/detail', (req: AuthRequest, res) => {
  const { type, oldName, oldQualifier, newName, newQualifier, aliases } = parseWith(
    updateEntitySchema,
    req.body
  );
  // updateEntity throws AppErrors with user-facing conflict messages.
  updateEntity(type, oldName, newName, aliases, oldQualifier, newQualifier);
  res.json({ ok: true });
});

router.get('/knowledge', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.query);
  const arc = parseWith(arcIdFilterSchema, req.query.arcId);
  if (typeof arc === 'number') requireExistingArc(arc);

  let entries = orFail('Laden fehlgeschlagen', () => listEntityKnowledge(type, name, qualifier));
  if (typeof arc === 'number') {
    // Arc-filtered view: only facts whose validity window overlaps the arc.
    // ('none' has no day range, so it shows the entity's full knowledge.)
    const range = getStoryArcDayRange(arc);
    entries = entries.filter((entry) => knowledgeOverlapsArcRange(entry, range));
  }
  res.json({ entries, currentGameDay: getCurrentGameDay() });
});

router.post('/knowledge', (req: AuthRequest, res) => {
  const { type, name, qualifier, title, content, validFrom, validUntil } = parseWith(
    createKnowledgeSchema,
    req.body
  );
  const entry = orFail('Speichern fehlgeschlagen', () =>
    createEntityKnowledge(type, name, title, content, 'manual', qualifier, validFrom, validUntil)
  );
  res.status(201).json({ entry });
});

router.put('/knowledge/:id', (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);

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
      throw new AppError(400, 'Inhalt ist erforderlich');
    }
    updates.content = content.trim();
  }
  if (validFrom !== undefined) {
    updates.validFrom = normGameDayOrNull(validFrom);
  }
  if (validUntil !== undefined) {
    updates.validUntil = normGameDayOrNull(validUntil);
  }

  if (!orFail('Aktualisieren fehlgeschlagen', () => getEntityKnowledgeEntry(id))) {
    throw new AppError(404, 'Eintrag nicht gefunden');
  }
  const entry = orFail('Aktualisieren fehlgeschlagen', () => updateEntityKnowledge(id, updates));
  if (!entry) {
    throw new AppError(500, 'Aktualisieren fehlgeschlagen');
  }
  res.json({ entry });
});

router.delete('/knowledge/:id', (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const { reason } = req.body;
  const deleteReason =
    typeof reason === 'string' && reason.trim() ? reason.trim() : 'Manuell als gelöscht markiert';

  if (!orFail('Löschen fehlgeschlagen', () => getEntityKnowledgeEntry(id))) {
    throw new AppError(404, 'Eintrag nicht gefunden');
  }
  const entry = orFail('Löschen fehlgeschlagen', () =>
    markEntityKnowledgeDeleted(id, deleteReason)
  );
  res.json({ entry });
});

router.post('/knowledge/:id/end', (req: AuthRequest, res) => {
  const id = parseWith(idParamSchema, req.params.id);
  const { until, reason } = parseWith(knowledgeEndSchema, req.body);
  const endReason = reason ?? 'Gilt ab diesem Spieltag nicht mehr';

  const existing = orFail('Beenden fehlgeschlagen', () => getEntityKnowledgeEntry(id));
  if (!existing) {
    throw new AppError(404, 'Eintrag nicht gefunden');
  }
  if (existing.status !== 'active') {
    throw new AppError(400, 'Nur aktive Einträge können beendet werden');
  }
  const entry = orFail('Beenden fehlgeschlagen', () =>
    markEntityKnowledgeTimelineEnd(id, until, endReason)
  );
  res.json({ entry });
});

router.get('/arc-links', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.query);
  const resolved = orFail('Laden fehlgeschlagen', () => findEntityCanonical(type, name, qualifier));
  if (!resolved) {
    throw new AppError(404, 'Entität nicht gefunden');
  }
  const arcIds = orFail('Laden fehlgeschlagen', () =>
    listArcIdsForEntity(type, resolved.name, resolved.qualifier)
  );
  res.json({ arcIds });
});

router.post('/arc-links', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(
    nameTypeSchema.extend({ qualifier: looseTrimmed }),
    req.body
  );
  const arcId = requireExistingArc(parseWith(arcLinkArcIdSchema, req.body.arcId), 404);

  // Canonical resolution keeps the identity-based link table clean even
  // when the client sends an alias or a differently cased spelling.
  const resolved = orFail('Zuordnen fehlgeschlagen', () =>
    findEntityCanonical(type, name, qualifier)
  );
  if (!resolved) {
    throw new AppError(404, 'Entität nicht gefunden');
  }
  orFail('Zuordnen fehlgeschlagen', () => linkStoryArcEntity(arcId, type, resolved));
  res.json({ ok: true });
});

// POST instead of a DELETE-with-body: some proxies/clients drop DELETE bodies.
router.post('/arc-links/unlink', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(
    nameTypeSchema.extend({ qualifier: looseTrimmed }),
    req.body
  );
  const arcId = requireExistingArc(parseWith(arcLinkArcIdSchema, req.body.arcId), 404);

  const resolved = orFail('Lösen fehlgeschlagen', () => findEntityCanonical(type, name, qualifier));
  if (!resolved) {
    throw new AppError(404, 'Entität nicht gefunden');
  }
  orFail('Lösen fehlgeschlagen', () =>
    unlinkStoryArcEntity(arcId, type, resolved.name, resolved.qualifier)
  );
  res.json({ ok: true });
});

router.post('/knowledge/distribute', aiRateLimit, async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
  const text = parseWith(textSchema, req.body.text);
  const arc = parseWith(aiArcIdSchema, req.body.arcId);
  if (arc !== undefined) requireExistingArc(arc);

  try {
    const result = await distributeKnowledgeFromText(text, { user: req.user, arcId: arc });
    res.json(result);
  } catch (err) {
    throw new AppError(500, 'KI-Einordnung fehlgeschlagen', { cause: err });
  }
});

router.post('/knowledge/correct', aiRateLimit, async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
  const text = parseWith(textSchema, req.body.text);
  const arc = parseWith(aiArcIdSchema, req.body.arcId);
  if (arc !== undefined) requireExistingArc(arc);

  const { type, name, qualifier } = req.body;
  let focus: { entityType: EntityType; entityName: string; entityQualifier: string } | undefined;
  if (type !== undefined || name !== undefined) {
    const parsed = parseWith(entityQuerySchema, { type, name, qualifier });
    focus = { entityType: parsed.type, entityName: parsed.name, entityQualifier: parsed.qualifier };
  }

  try {
    const result = await correctKnowledgeFromText(text, focus, { user: req.user, arcId: arc });
    res.json(result);
  } catch (err) {
    throw new AppError(500, 'KI-Berichtigung fehlgeschlagen', { cause: err });
  }
});

router.post('/knowledge/review', aiRateLimit, async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.body);
  const arc = parseWith(aiArcIdSchema, req.body.arcId);
  if (arc !== undefined) requireExistingArc(arc);

  try {
    const result = await reviewEntityKnowledge(type, name, {
      qualifier,
      user: req.user,
      arcId: arc,
    });
    res.json(result);
  } catch (err) {
    throw new AppError(500, 'KI-Prüfung fehlgeschlagen', { cause: err });
  }
});

router.get('/summary', (req: AuthRequest, res) => {
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.query);
  const summary = orFail('Zusammenfassung konnte nicht geladen werden', () =>
    getEntitySummary(type, name, qualifier)
  );
  res.json(
    summary ?? {
      entityType: type,
      entityName: name,
      entityQualifier: qualifier,
      summary: null,
      miniSummary: null,
      isDirty: true,
      updatedAt: null,
    }
  );
});

router.post('/summary/generate', aiRateLimit, async (req: AuthRequest, res) => {
  if (!isAiEnabled()) {
    throw new AppError(503, 'KI-Feature ist nicht konfiguriert');
  }
  const { type, name, qualifier } = parseWith(entityQuerySchema, req.body);

  try {
    const result = await generateEntitySummary(type, name, {
      user: req.user,
      qualifier,
    });
    if (result === null) {
      throw new AppError(500, 'KI-Zusammenfassung fehlgeschlagen');
    }
    res.json({ summary: result.summary, miniSummary: result.miniSummary });
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError(500, 'KI-Zusammenfassung fehlgeschlagen', { cause: err });
  }
});

router.put('/mini-summary', (req: AuthRequest, res) => {
  const { type, name, qualifier, miniSummary } = parseWith(miniSummarySchema, req.body);
  const entry = orFail('Mini-Zusammenfassung konnte nicht gespeichert werden', () =>
    setEntityMiniSummary(type, name, miniSummary, qualifier)
  );
  res.json({ miniSummary: entry.miniSummary });
});

export default router;
