/**
 * The one client the assistant talks through.
 *
 * The key as pasted into the deployment, trimmed: a trailing newline
 * in an environment variable is an invalid header, and the SDK reads
 * the variable raw. And the workspace, when the key is not scoped to
 * one: an organization-wide key must name the workspace each request
 * is for, in the anthropic-workspace-id header, or the API refuses
 * it. ANTHROPIC_WORKSPACE_ID carries that id (Console, Settings,
 * Workspaces); a key created inside a workspace needs nothing.
 *
 * Server only: it reads the key.
 */

import Anthropic from "@anthropic-ai/sdk";

export function assistantConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function anthropicClient(opts: { maxRetries?: number } = {}): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY?.trim(),
    ...(workspace ? { defaultHeaders: { "anthropic-workspace-id": workspace } } : {}),
    ...opts,
  });
}
