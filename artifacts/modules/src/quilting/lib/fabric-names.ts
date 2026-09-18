/** Build the fabric ID → name map used by export error messages. */
export function buildFabricNameMap(
  fabrics: ReadonlyArray<{ id: number; name: string }>,
): Record<number, string> {
  return Object.fromEntries(fabrics.map((fabric) => [fabric.id, fabric.name]));
}
