import type { PageTool, PageToolApproval, PagewayActionSource } from './types.js';

/** Discovery and execution use the same policy; hidden tools are never authority. */
export function isToolAllowed(
  tool: Pick<PageTool, 'enabled' | 'allowedSources'>,
  source: PagewayActionSource,
): boolean {
  return (
    tool.enabled !== false &&
    (tool.allowedSources === undefined || tool.allowedSources.includes(source))
  );
}

export function assertToolAllowed(tool: PageTool, source: PagewayActionSource): void {
  if (!isToolAllowed(tool, source))
    throw new Error(`The tool "${tool.name}" is not permitted for ${source} requests.`);
}

/** Evaluate using an isolated argument copy so review callbacks cannot change the operation. */
export function getToolApproval(
  tool: PageTool,
  args: Record<string, unknown>,
): PageToolApproval | null {
  if (tool.approval === undefined) return null;
  const approval =
    typeof tool.approval === 'function'
      ? tool.approval(JSON.parse(JSON.stringify(args)))
      : tool.approval;
  if (approval === false) return null;
  if (
    !approval ||
    typeof approval.title !== 'string' ||
    !approval.title.trim() ||
    typeof approval.description !== 'string' ||
    !approval.description.trim()
  )
    throw new Error(`The tool "${tool.name}" has an invalid approval policy.`);
  return { title: approval.title, description: approval.description };
}
