/**
 * PreflightResolver - Pre-execution Validation and Auto-fill
 *
 * This module handles everything BEFORE we ask the user questions:
 * 1. Connection Validation - Check OAuth connections for required toolkits
 * 2. Singleton Detection - Auto-fill if only one option (e.g., 1 Jira project)
 * 3. Entity Resolution - Resolve names to emails, project names to keys
 *
 * The goal: Ask the user as FEW questions as possible by auto-filling
 * everything we can determine automatically.
 */

class PreflightResolver {
  constructor({ composio, query }) {
    this.composio = composio;
    this.query = query; // Database query function

    // Toolkit to app name mapping
    this.toolkitToApp = {
      'JIRA': 'jira',
      'GMAIL': 'gmail',
      'GOOGLECALENDAR': 'googlecalendar',
      'SLACK': 'slack',
      'GITHUB': 'github',
      'HUBSPOT': 'hubspot'
    };
  }

  /**
   * Main resolve method - runs all preflight checks
   */
  async resolve({ intentGraph, selectedToolkits, entityId, userId }) {
    console.log('[PreflightResolver] Starting preflight checks...');

    const result = {
      enrichedGraph: JSON.parse(JSON.stringify(intentGraph)), // Deep copy
      needsConnection: false,
      needsApp: false,
      connectionIssues: [],
      autoFilled: [],
      resolvedEntities: []
    };

    try {
      // ===========================================
      // STEP 1: Connection Validation
      // ===========================================
      const connectionResult = await this.validateConnections({
        intentGraph,
        selectedToolkits,
        entityId
      });

      if (connectionResult.needsConnection) {
        return {
          ...result,
          needsConnection: true,
          connectionIssues: connectionResult.issues,
          missingToolkit: connectionResult.missingToolkit,
          authUrl: connectionResult.authUrl
        };
      }

      if (connectionResult.needsApp) {
        return {
          ...result,
          needsApp: true,
          missingApp: connectionResult.missingApp
        };
      }

      // Store connection info for later use
      result.connections = connectionResult.connections;

      // ===========================================
      // STEP 2: Singleton Detection & Auto-fill
      // ===========================================
      const singletonResult = await this.detectSingletons({
        intentGraph: result.enrichedGraph,
        connections: connectionResult.connections,
        entityId
      });

      // Apply auto-filled values to the graph
      for (const autoFill of singletonResult.autoFilled) {
        this.applyAutoFill(result.enrichedGraph, autoFill);
        result.autoFilled.push(autoFill);
      }

      // ===========================================
      // STEP 3: Entity Resolution
      // ===========================================
      const entityResult = await this.resolveEntities({
        intentGraph: result.enrichedGraph,
        entities: intentGraph.entities || [],
        userId
      });

      // Apply resolved entities
      for (const resolved of entityResult.resolved) {
        this.applyEntityResolution(result.enrichedGraph, resolved);
        result.resolvedEntities.push(resolved);
      }

      console.log('[PreflightResolver] Preflight complete:', {
        autoFilled: result.autoFilled.length,
        resolvedEntities: result.resolvedEntities.length
      });

      return result;

    } catch (error) {
      console.error('[PreflightResolver] Error:', error);
      // Don't fail - just return the original graph
      return result;
    }
  }

  /**
   * Validate OAuth connections for all required toolkits
   */
  async validateConnections({ intentGraph, selectedToolkits, entityId }) {
    const result = {
      needsConnection: false,
      needsApp: false,
      connections: {},
      issues: []
    };

    // Determine which toolkits are actually needed
    const requiredToolkits = new Set();
    for (const action of intentGraph.actions || []) {
      const toolkit = action.tool.split('_')[0];
      requiredToolkits.add(toolkit);
    }

    // Check each required toolkit
    for (const toolkit of requiredToolkits) {
      const appName = this.toolkitToApp[toolkit];
      if (!appName) continue;

      try {
        // Check if connection exists
        const entity = await this.composio.getEntity(entityId);
        const connection = await entity.getConnection({ app: appName });

        if (connection) {
          result.connections[toolkit] = {
            connected: true,
            connectionId: connection.id,
            appName
          };
        } else {
          result.needsConnection = true;
          result.missingToolkit = toolkit;
          result.issues.push({
            toolkit,
            message: `${toolkit} is not connected. Please connect your account.`
          });

          // Try to get auth URL
          try {
            const authUrl = await this.getAuthUrl(entityId, appName);
            result.authUrl = authUrl;
          } catch (e) {
            console.error(`[PreflightResolver] Could not get auth URL for ${appName}:`, e);
          }
          break;
        }
      } catch (error) {
        // Connection doesn't exist
        result.needsConnection = true;
        result.missingToolkit = toolkit;
        result.issues.push({
          toolkit,
          message: `${toolkit} connection failed: ${error.message}`
        });
        break;
      }
    }

    return result;
  }

  /**
   * Get OAuth URL for a toolkit
   */
  async getAuthUrl(entityId, appName) {
    try {
      const entity = await this.composio.getEntity(entityId);
      const connectionRequest = await entity.initiateConnection({ appName });
      return connectionRequest.redirectUrl;
    } catch (error) {
      console.error(`[PreflightResolver] Failed to get auth URL:`, error);
      return null;
    }
  }

  /**
   * Detect singletons and auto-fill values
   *
   * Examples:
   * - User has only 1 Jira project → auto-fill project_key
   * - User has only 1 Slack workspace → auto-fill workspace
   * - User's email is known → auto-fill "from" fields
   */
  async detectSingletons({ intentGraph, connections, entityId }) {
    const result = {
      autoFilled: []
    };

    for (const action of intentGraph.actions || []) {
      const toolkit = action.tool.split('_')[0];

      // JIRA: Check for single project
      if (toolkit === 'JIRA' && !action.params?.project_key) {
        const projects = await this.fetchJiraProjects(entityId);
        if (projects && projects.length === 1) {
          result.autoFilled.push({
            actionId: action.id,
            field: 'project_key',
            value: projects[0].key,
            reason: `Only one Jira project found: ${projects[0].name}`
          });
        } else if (projects && projects.length > 1) {
          // Store available options for slot filler
          action.availableOptions = action.availableOptions || {};
          action.availableOptions.project_key = projects.map(p => ({
            value: p.key,
            label: `${p.key} - ${p.name}`
          }));
        }
      }

      // SLACK: Check for channel
      if (toolkit === 'SLACK' && !action.params?.channel) {
        const channels = await this.fetchSlackChannels(entityId);
        if (channels && channels.length === 1) {
          result.autoFilled.push({
            actionId: action.id,
            field: 'channel',
            value: channels[0].id,
            reason: `Only one Slack channel found: ${channels[0].name}`
          });
        } else if (channels && channels.length > 0) {
          action.availableOptions = action.availableOptions || {};
          action.availableOptions.channel = channels.map(c => ({
            value: c.id,
            label: `#${c.name}`
          }));
        }
      }

      // GOOGLE CALENDAR: Auto-fill calendar ID to primary
      if (toolkit === 'GOOGLECALENDAR' && !action.params?.calendar_id) {
        result.autoFilled.push({
          actionId: action.id,
          field: 'calendar_id',
          value: 'primary',
          reason: 'Using primary calendar'
        });
      }
    }

    return result;
  }

  /**
   * Resolve entities from the intent graph
   *
   * Examples:
   * - "John" → john@company.com (from contacts/directory)
   * - "Marketing team" → marketing@company.com
   * - "Bob's project" → BOB (Jira project key)
   */
  async resolveEntities({ intentGraph, entities, userId }) {
    const result = {
      resolved: [],
      unresolved: []
    };

    for (const entity of entities) {
      // Already resolved (e.g., explicit email address)
      if (entity.resolved) {
        continue;
      }

      // Try to resolve based on type
      switch (entity.type) {
        case 'person':
        case 'name':
          const email = await this.resolvePersonToEmail(entity.raw, userId);
          if (email) {
            result.resolved.push({
              raw: entity.raw,
              type: entity.type,
              resolved: email,
              field: 'to' // Most likely field for person names
            });
          } else {
            result.unresolved.push(entity);
          }
          break;

        case 'project':
          const projectKey = await this.resolveProjectName(entity.raw, userId);
          if (projectKey) {
            result.resolved.push({
              raw: entity.raw,
              type: entity.type,
              resolved: projectKey,
              field: 'project_key'
            });
          } else {
            result.unresolved.push(entity);
          }
          break;

        default:
          result.unresolved.push(entity);
      }
    }

    return result;
  }

  /**
   * Try to resolve a person's name to their email
   */
  async resolvePersonToEmail(name, userId) {
    try {
      // First check our local contacts/directory
      if (this.query) {
        const contacts = await this.query(
          `SELECT email FROM contacts WHERE user_id = ? AND (name ILIKE ? OR nickname ILIKE ?)`,
          [userId, `%${name}%`, `%${name}%`]
        );
        if (contacts && contacts.length === 1) {
          return contacts[0].email;
        }
      }

      // Could also integrate with:
      // - Google Contacts API
      // - Microsoft Graph API
      // - Company directory LDAP
      // For now, return null if not found
      return null;
    } catch (error) {
      console.error('[PreflightResolver] Error resolving person:', error);
      return null;
    }
  }

  /**
   * Try to resolve a project name to its key
   */
  async resolveProjectName(name, userId) {
    // This would query Jira projects and fuzzy match
    // For now, return null - could be implemented with:
    // - Jira API search
    // - Local cache of user's projects
    return null;
  }

  /**
   * Fetch Jira projects for singleton detection
   */
  async fetchJiraProjects(entityId) {
    try {
      const entity = await this.composio.getEntity(entityId);
      const connection = await entity.getConnection({ app: 'jira' });

      if (!connection) return null;

      // Execute Jira API call to get projects
      const result = await this.composio.executeAction({
        actionName: 'JIRA_GET_PROJECTS',
        connectedAccountId: connection.id,
        input: {}
      });

      if (result.successfull && result.data?.values) {
        return result.data.values.map(p => ({
          key: p.key,
          name: p.name,
          id: p.id
        }));
      }

      return null;
    } catch (error) {
      console.error('[PreflightResolver] Error fetching Jira projects:', error);
      return null;
    }
  }

  /**
   * Fetch Slack channels for singleton detection
   */
  async fetchSlackChannels(entityId) {
    try {
      const entity = await this.composio.getEntity(entityId);
      const connection = await entity.getConnection({ app: 'slack' });

      if (!connection) return null;

      // Execute Slack API call to get channels
      const result = await this.composio.executeAction({
        actionName: 'SLACK_LIST_CHANNELS',
        connectedAccountId: connection.id,
        input: { limit: 100 }
      });

      if (result.successfull && result.data?.channels) {
        return result.data.channels.map(c => ({
          id: c.id,
          name: c.name,
          is_member: c.is_member
        }));
      }

      return null;
    } catch (error) {
      console.error('[PreflightResolver] Error fetching Slack channels:', error);
      return null;
    }
  }

  /**
   * Apply an auto-fill value to the intent graph
   */
  applyAutoFill(intentGraph, autoFill) {
    const action = intentGraph.actions.find(a => a.id === autoFill.actionId);
    if (action) {
      action.params = action.params || {};
      action.params[autoFill.field] = autoFill.value;
      action.autoFilled = action.autoFilled || [];
      action.autoFilled.push({
        field: autoFill.field,
        reason: autoFill.reason
      });
    }
  }

  /**
   * Apply entity resolution to the intent graph
   */
  applyEntityResolution(intentGraph, resolved) {
    // Find actions that might need this entity
    for (const action of intentGraph.actions) {
      // Check if any param placeholder matches the raw entity
      for (const [key, value] of Object.entries(action.params || {})) {
        if (typeof value === 'string' &&
            value.toLowerCase().includes(resolved.raw.toLowerCase())) {
          action.params[key] = resolved.resolved;
        }
      }

      // Also check if the field is empty and we can fill it
      if (resolved.field && !action.params?.[resolved.field]) {
        // Only apply if the action type matches the entity type
        const toolkit = action.tool.split('_')[0];
        if ((resolved.type === 'person' && ['GMAIL', 'GOOGLECALENDAR'].includes(toolkit)) ||
            (resolved.type === 'project' && toolkit === 'JIRA')) {
          action.params = action.params || {};
          action.params[resolved.field] = resolved.resolved;
        }
      }
    }
  }
}

module.exports = PreflightResolver;
