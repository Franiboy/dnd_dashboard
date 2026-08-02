export function isValidModel(value: string | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  // Heuristic for placeholder values like provider/GLM5.2
  if (trimmed.toLowerCase().startsWith('provider/')) return false;
  return true;
}

export function isAiEnabled(): boolean {
  const provider = process.env.AI_PROVIDER;
  const model = process.env.AI_MODEL;

  if (!provider || !isValidModel(model)) {
    return false;
  }

  if (provider.trim() !== 'opencode') {
    return false;
  }

  return true;
}
