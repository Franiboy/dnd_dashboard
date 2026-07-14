export function isAiEnabled(): boolean {
  const provider = process.env.AI_PROVIDER;
  const model = process.env.AI_MODEL;

  if (!provider || !model) {
    return false;
  }

  if (provider.trim() !== 'opencode') {
    return false;
  }

  const trimmedModel = model.trim();
  if (trimmedModel.length === 0) {
    return false;
  }

  // Heuristic for placeholder values like provider/GLM5.2
  if (trimmedModel.toLowerCase().startsWith('provider/')) {
    return false;
  }

  return true;
}
