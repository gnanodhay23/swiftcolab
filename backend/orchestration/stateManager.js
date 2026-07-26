/**
 * State Manager - Conversation state persistence
 *
 * Manages:
 * 1. Creating new conversation states
 * 2. Loading existing states
 * 3. Saving state updates
 * 4. Cleaning up expired states
 */

const { v4: uuidv4 } = require('uuid');

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

class ConversationStateManager {
  constructor({ query }) {
    this.query = query;
  }

  /**
   * Create a new conversation state
   */
  async create(userId) {
    const state = {
      id: uuidv4(),
      userId,
      conversationId: uuidv4(),
      mode: 'CHAT_ONLY',
      intent: null,
      draft_params: {},
      missing_fields: [],
      selected_actions: [],
      resolved_context: {},
      plan: null,
      status: 'collecting',
      workflow_id: null,
      createdAt: new Date().toISOString(),
    };

    // Skip DB insert if userId is not a valid UUID (e.g., "anonymous", "default-xxx")
    if (!isValidUUID(userId)) {
      console.log('[StateManager] Skipping DB insert for non-UUID userId:', userId);
      return state;
    }

    try {
      await this.query(
        `INSERT INTO conversation_states (id, user_id, conversation_id, mode, intent, draft_params, missing_fields, selected_actions, resolved_context, plan, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          state.id,
          userId,
          state.conversationId,
          state.mode,
          state.intent,
          JSON.stringify(state.draft_params),
          JSON.stringify(state.missing_fields),
          JSON.stringify(state.selected_actions),
          JSON.stringify(state.resolved_context),
          state.plan ? JSON.stringify(state.plan) : null,
          state.status,
        ]
      );
    } catch (error) {
      console.error('[StateManager] Error creating state:', error);
    }

    return state;
  }

  /**
   * Load an existing conversation state
   */
  async load(userId, conversationId) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[StateManager] Skipping DB load for non-UUID userId:', userId);
      return await this.create(userId);
    }

    try {
      const result = await this.query(
        `SELECT * FROM conversation_states
         WHERE user_id = $1 AND conversation_id = $2 AND expires_at > NOW()`,
        [userId, conversationId]
      );

      if (result.rows.length === 0) {
        return await this.create(userId);
      }

      const row = result.rows[0];
      return {
        id: row.id,
        userId: row.user_id,
        conversationId: row.conversation_id,
        mode: row.mode,
        intent: row.intent,
        draft_params: row.draft_params || {},
        missing_fields: row.missing_fields || [],
        selected_actions: row.selected_actions || [],
        resolved_context: row.resolved_context || {},
        plan: row.plan,
        status: row.status,
        workflow_id: row.workflow_id,
        createdAt: row.created_at,
      };
    } catch (error) {
      console.error('[StateManager] Error loading state:', error);
      return await this.create(userId);
    }
  }

  /**
   * Save state updates
   */
  async save(state) {
    try {
      await this.query(
        `UPDATE conversation_states
         SET mode = $1, intent = $2, draft_params = $3, missing_fields = $4,
             selected_actions = $5, resolved_context = $6, plan = $7, status = $8,
             workflow_id = $9, updated_at = NOW()
         WHERE id = $10`,
        [
          state.mode,
          state.intent,
          JSON.stringify(state.draft_params),
          JSON.stringify(state.missing_fields),
          JSON.stringify(state.selected_actions),
          JSON.stringify(state.resolved_context),
          state.plan ? JSON.stringify(state.plan) : null,
          state.status,
          state.workflow_id,
          state.id,
        ]
      );
    } catch (error) {
      console.error('[StateManager] Error saving state:', error);
    }
  }

  /**
   * Get recent conversations for a user
   */
  async getRecent(userId, limit = 10) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[StateManager] Skipping getRecent for non-UUID userId:', userId);
      return [];
    }

    try {
      const result = await this.query(
        `SELECT * FROM conversation_states
         WHERE user_id = $1 AND expires_at > NOW()
         ORDER BY updated_at DESC
         LIMIT $2`,
        [userId, limit]
      );

      return result.rows.map(row => ({
        id: row.id,
        conversationId: row.conversation_id,
        intent: row.intent,
        status: row.status,
        updatedAt: row.updated_at,
      }));
    } catch (error) {
      console.error('[StateManager] Error getting recent:', error);
      return [];
    }
  }

  /**
   * Delete a conversation state
   */
  async delete(stateId) {
    try {
      await this.query(
        'DELETE FROM conversation_states WHERE id = $1',
        [stateId]
      );
    } catch (error) {
      console.error('[StateManager] Error deleting state:', error);
    }
  }

  /**
   * Clean up expired states
   */
  async cleanup() {
    try {
      const result = await this.query(
        'DELETE FROM conversation_states WHERE expires_at < NOW()'
      );
      console.log(`[StateManager] Cleaned up ${result.rowCount} expired states`);
    } catch (error) {
      console.error('[StateManager] Error cleaning up:', error);
    }
  }
}

module.exports = { ConversationStateManager };
