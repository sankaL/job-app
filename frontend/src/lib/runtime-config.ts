export function normalizeRuntimeConfig(config: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!config) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => !(typeof value === "string" && value.trim() === "")),
  );
}
