/**
 * Ghost KB MCP — Knowledge Graph tools.
 *
 * Replaces the previous UI-interaction tools (ui_snapshot, ui_click, etc.)
 * with knowledge graph operations.
 *
 * Tools:
 * - kb_list_graphs / kb_get_current_graph / kb_set_current_graph: Select graph scope
 * - kb_query_graph: Query assertions as N3/RDF-star text
 * - kb_find_resources: Find resources by property conditions and return N3/RDF-star context
 * - kb_get_resource: Get one resource with outbound/inbound RDF-star assertions
 * - kb_explain: Explain assertion provenance and writability as N3/RDF-star text
 * - kb_eye_query: Run strict EYE --query style N3 against graph facts
 * - kb_patch: Apply strict Turtle/N3 delete/insert patch through operation policy
 * - kb_write: Write a parameter-style triple through operation policy
 * - kb_delete: Delete a parameter-style triple through operation policy
 * - kb_list: List entries in a workspace graph
 * - kb_set_system_state: Update system-state properties
 * - kb_add_declaration: Declare ObjectProperty/DatatypeProperty
 */

import { callKbTool, KB_TOOLS } from './kbTools';
import type { McpToolDefinition, ToolInput } from './types';

export { KB_TOOLS as TOOLS };
export { KB_TOOLS };

export async function callTool(name: string, input: ToolInput): Promise<unknown> {
  return callKbTool(name, input);
}