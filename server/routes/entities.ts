import { Router } from 'express';
import { authMiddleware, requireApproved, type AuthRequest } from '../auth.js';
import { db } from '../database.js';
import type { DiaryEntities } from '../ai/rewrite.js';
import {
  addEntityAlias,
  blacklistEntity,
  finalizeEntities,
  getBlacklistedEntities,
  reclassifyEntity,
  unblacklistEntity,
} from '../repositories/diary.js';

const router = Router();

const ENTITY_TYPES: Array<keyof DiaryEntities> = ['persons', 'organizations', 'locations'];

router.use(authMiddleware, requireApproved);

router.get('/', (_req: AuthRequest, res) => {
  const fetchNames = (table: string): string[] => {
    const rows = db
      .prepare(`SELECT name FROM ${table} ORDER BY name COLLATE NOCASE`)
      .all() as { name: string }[];
    return rows.map((row) => row.name);
  };

  const entities = finalizeEntities({
    persons: fetchNames('persons'),
    organizations: fetchNames('organizations'),
    locations: fetchNames('locations'),
  });

  res.json(entities);
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
  const { name, fromType, toType } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'Name ist erforderlich' });
    return;
  }
  if (!fromType || !ENTITY_TYPES.includes(fromType) || !toType || !ENTITY_TYPES.includes(toType)) {
    res.status(400).json({ error: 'Gültige Typen sind erforderlich' });
    return;
  }

  try {
    reclassifyEntity(name.trim(), fromType, toType);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Reklassifizierung fehlgeschlagen' });
  }
});

router.post('/alias', (req: AuthRequest, res) => {
  const { type, alias, canonical } = req.body;
  if (!alias || typeof alias !== 'string' || !alias.trim() || !canonical || typeof canonical !== 'string' || !canonical.trim()) {
    res.status(400).json({ error: 'Alias und Zielname sind erforderlich' });
    return;
  }
  if (!type || !ENTITY_TYPES.includes(type)) {
    res.status(400).json({ error: 'Gültiger Typ ist erforderlich' });
    return;
  }

  try {
    addEntityAlias(type, alias.trim(), canonical.trim());
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Verknüpfen fehlgeschlagen' });
  }
});

export default router;
