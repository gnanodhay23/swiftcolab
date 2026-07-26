/**
 * Context Resolver - Resolves ambiguous entities and context
 *
 * Handles:
 * 1. Which connected account/workspace to use
 * 2. Entity resolution (names, projects, channels)
 * 3. User preferences
 */

/**
 * Check if a string is a valid UUID
 */
function isValidUUID(str) {
  if (!str || typeof str !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}

class ContextResolver {
  constructor({ composio, query }) {
    this.composio = composio;
    this.query = query;
  }

  /**
   * Resolve context for a request
   */
  async resolve({ message, userId, entityId, selectedToolkits, currentContext = {} }) {
    const resolved = { ...currentContext };

    // 1. Resolve workspace/account context
    resolved.workspace = await this.resolveWorkspace(userId, entityId, selectedToolkits);

    // 2. Resolve entities mentioned in the message
    resolved.entities = await this.resolveEntities(message, selectedToolkits, resolved.workspace);

    // 3. Load user preferences
    resolved.preferences = await this.loadUserPreferences(userId);

    // 4. Get timezone
    resolved.timezone = resolved.preferences?.timezone || 'America/New_York';

    // 5. Get current date/time context in user's timezone
    const now = new Date();
    const timezone = resolved.timezone || 'America/New_York';
    
    // Get today's date in user's timezone (not UTC!)
    const userDateStr = now.toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD format
    const userTimeStr = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false, hour: '2-digit' });
    const userDayOfWeek = now.toLocaleDateString('en-US', { timeZone: timezone, weekday: 'long' });
    
    // Calculate tomorrow in user's timezone
    const tomorrowDate = new Date(now.getTime() + 86400000);
    const tomorrowDateStr = tomorrowDate.toLocaleDateString('en-CA', { timeZone: timezone });
    
    resolved.dateContext = {
      today: userDateStr,
      tomorrow: tomorrowDateStr,
      currentHour: parseInt(userTimeStr, 10),
      dayOfWeek: userDayOfWeek,
    };

    return resolved;
  }

  /**
   * Resolve which workspace/account to use for each toolkit
   */
  async resolveWorkspace(userId, entityId, selectedToolkits) {
    const workspace = {};

    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping resolveWorkspace for non-UUID userId:', userId);
      return workspace;
    }

    try {
      // Get user's connected accounts
      const result = await this.query(
        `SELECT app_id, composio_connection_id, metadata
         FROM connected_accounts
         WHERE user_id = $1 AND status = 'active'`,
        [userId]
      );

      for (const row of result.rows) {
        const toolkit = this.appIdToToolkit(row.app_id);
        if (selectedToolkits.includes(toolkit)) {
          workspace[toolkit] = {
            connectionId: row.composio_connection_id,
            metadata: row.metadata || {},
          };
        }
      }
    } catch (error) {
      console.error('[ContextResolver] Error loading workspace:', error);
    }

    return workspace;
  }

  /**
   * Resolve entities mentioned in the message
   */
  async resolveEntities(message, selectedToolkits, workspace) {
    const entities = {
      projects: [],
      channels: [],
      people: [],
      emails: [],
    };

    // Extract email addresses
    const emailPattern = /[\w.-]+@[\w.-]+\.\w+/g;
    const emails = message.match(emailPattern) || [];
    entities.emails = emails;

    // Extract potential project keys (uppercase letters followed by optional numbers)
    const projectPattern = /\b([A-Z]{2,10})(?:-\d+)?\b/g;
    let match;
    while ((match = projectPattern.exec(message)) !== null) {
      if (!entities.projects.includes(match[1])) {
        entities.projects.push(match[1]);
      }
    }

    // Extract Slack channel mentions
    const channelPattern = /#([a-z0-9_-]+)/gi;
    while ((match = channelPattern.exec(message)) !== null) {
      entities.channels.push(match[1]);
    }

    // Extract @mentions
    const mentionPattern = /@([a-zA-Z0-9_]+)/g;
    while ((match = mentionPattern.exec(message)) !== null) {
      entities.people.push(match[1]);
    }

    return entities;
  }

  /**
   * Load user preferences
   */
  async loadUserPreferences(userId) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping loadUserPreferences for non-UUID userId:', userId);
      return { learned: {}, settings: {}, timezone: 'America/New_York' };
    }

    try {
      // First check learned preferences
      const learnedResult = await this.query(
        `SELECT * FROM user_preferences_learned WHERE user_id = $1`,
        [userId]
      );

      // Then check settings
      const settingsResult = await this.query(
        `SELECT * FROM user_settings WHERE user_id = $1`,
        [userId]
      );

      return {
        learned: learnedResult.rows[0] || {},
        settings: settingsResult.rows[0] || {},
        timezone: settingsResult.rows[0]?.timezone || 'America/New_York',
      };
    } catch (error) {
      console.error('[ContextResolver] Error loading preferences:', error);
      return { timezone: 'America/New_York' };
    }
  }

  /**
   * Resolve a specific entity with light tool reads if needed
   */
  async resolveSpecificEntity(entityType, entityValue, toolkit, entityId) {
    switch (entityType) {
      case 'slack_channel':
        return await this.resolveSlackChannel(entityValue, entityId);
      case 'jira_project':
        return await this.resolveJiraProject(entityValue, entityId);
      default:
        return entityValue;
    }
  }

  /**
   * Resolve Slack channel name to ID
   */
  async resolveSlackChannel(channelName, entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'SLACK_LIST_CHANNELS',
        {},
        entityId
      );

      const channels = execResult?.data?.channels || execResult?.data || [];
      const channelList = Array.isArray(channels) ? channels : [];
      const channel = channelList.find(c =>
        c.name?.toLowerCase() === channelName.toLowerCase().replace('#', '')
      );

      return channel ? { id: channel.id, name: channel.name } : null;
    } catch (error) {
      console.error('[ContextResolver] Error resolving Slack channel:', error);
      return null;
    }
  }

  /**
   * Resolve Jira project name to key
   */
  async resolveJiraProject(projectInput, entityId) {
    try {
      const execResult = await this.composio.executeAction(
        'JIRA_GET_ALL_PROJECTS',
        {},
        entityId
      );

      const projects = execResult?.data || [];
      const projectList = Array.isArray(projects) ? projects : [];
      const project = projectList.find(p =>
        p.key === projectInput.toUpperCase() ||
        p.name?.toLowerCase().includes(projectInput.toLowerCase())
      );

      return project ? { key: project.key, name: project.name } : null;
    } catch (error) {
      console.error('[ContextResolver] Error resolving Jira project:', error);
      return null;
    }
  }

  /**
   * Map app ID to toolkit name
   */
  appIdToToolkit(appId) {
    const mapping = {
      gcalender: 'GOOGLECALENDAR',
      gmail: 'GMAIL',
      slack: 'SLACK',
      jira: 'JIRA',
      trello: 'TRELLO',
      github: 'GITHUB',
      notion: 'NOTION',
      asana: 'ASANA',
    };
    return mapping[appId] || appId.toUpperCase();
  }

  /**
   * Check if context needs clarification
   */
  needsClarification(resolved, requiredContext) {
    const missing = [];

    for (const required of requiredContext) {
      switch (required) {
        case 'jira_project':
          if (resolved.entities.projects.length === 0) {
            missing.push({
              type: 'jira_project',
              question: 'Which Jira project should I use?',
            });
          } else if (resolved.entities.projects.length > 1) {
            missing.push({
              type: 'jira_project',
              question: `Which project: ${resolved.entities.projects.join(' or ')}?`,
              options: resolved.entities.projects,
            });
          }
          break;

        case 'slack_channel':
          if (resolved.entities.channels.length === 0) {
            missing.push({
              type: 'slack_channel',
              question: 'Which Slack channel should I post to?',
            });
          }
          break;

        case 'attendees':
          if (resolved.entities.emails.length === 0 && resolved.entities.people.length === 0) {
            missing.push({
              type: 'attendees',
              question: 'Who should I invite to the meeting?',
            });
          }
          break;
      }
    }

    return missing;
  }

  // ===========================================
  // ENTITY RESOLUTION: Names to Emails
  // ===========================================

  /**
   * Extract person names from message (when no email found)
   * Patterns: "email Hema", "send to John", "message Sarah", "invite Bob"
   */
  extractPersonNames(message) {
    const names = [];

    // Pattern 1: "email/send to/message/invite [Name]"
    const actionPatterns = [
      /(?:email|send\s+to|message|invite|cc|bcc)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/gi,
      /(?:to|with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:about|regarding|for)?/gi,
    ];

    for (const pattern of actionPatterns) {
      let match;
      while ((match = pattern.exec(message)) !== null) {
        const name = match[1].trim();
        // Filter out common words that might be captured
        const commonWords = ['The', 'This', 'That', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Today', 'Tomorrow', 'Meeting', 'Event', 'Task'];
        if (!commonWords.includes(name) && name.length > 1) {
          names.push(name);
        }
      }
    }

    // Pattern 2: "my manager", "my boss", "the team"
    const rolePatterns = {
      'my manager': '_ROLE_MANAGER',
      'my boss': '_ROLE_MANAGER',
      'the team': '_ROLE_TEAM',
      'my team': '_ROLE_TEAM',
    };

    const lowerMessage = message.toLowerCase();
    for (const [phrase, role] of Object.entries(rolePatterns)) {
      if (lowerMessage.includes(phrase)) {
        names.push(role);
      }
    }

    return [...new Set(names)]; // Dedupe
  }

  /**
   * Resolve person name to email address
   * Sources: 1) Recent recipients, 2) Google Contacts, 3) Org directory
   */
  async resolvePersonToEmail(name, userId, entityId) {
    console.log(`[ContextResolver] Resolving person "${name}" to email`);

    // Handle role-based lookups
    if (name.startsWith('_ROLE_')) {
      return await this.resolveRoleToEmail(name, userId);
    }

    const candidates = [];

    // Source 1: Recent recipients (from sent emails - most relevant)
    const recentMatches = await this.searchRecentRecipients(name, userId);
    candidates.push(...recentMatches.map(r => ({ ...r, source: 'recent' })));

    // Source 2: User's contact directory (stored in DB or Google Contacts)
    const contactMatches = await this.searchContacts(name, userId, entityId);
    candidates.push(...contactMatches.map(c => ({ ...c, source: 'contacts' })));

    // Source 3: Organization users (Slack workspace, Google Workspace)
    const orgMatches = await this.searchOrgUsers(name, entityId);
    candidates.push(...orgMatches.map(o => ({ ...o, source: 'org' })));

    // Dedupe by email
    const seen = new Set();
    const uniqueCandidates = candidates.filter(c => {
      if (seen.has(c.email)) return false;
      seen.add(c.email);
      return true;
    });

    console.log(`[ContextResolver] Found ${uniqueCandidates.length} candidates for "${name}":`, uniqueCandidates);

    if (uniqueCandidates.length === 0) {
      return { resolved: false, name };
    }

    if (uniqueCandidates.length === 1) {
      return { resolved: true, email: uniqueCandidates[0].email, name: uniqueCandidates[0].name, source: uniqueCandidates[0].source };
    }

    // Multiple matches - need disambiguation
    return { resolved: false, ambiguous: true, candidates: uniqueCandidates, name };
  }

  /**
   * Search recent email recipients
   */
  async searchRecentRecipients(name, userId) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping searchRecentRecipients for non-UUID userId:', userId);
      return [];
    }

    try {
      // Check our cached recent recipients table
      const result = await this.query(
        `SELECT recipient_email, recipient_name, last_sent_at, send_count
         FROM recent_recipients
         WHERE user_id = $1
           AND (LOWER(recipient_name) LIKE $2 OR LOWER(recipient_email) LIKE $2)
         ORDER BY send_count DESC, last_sent_at DESC
         LIMIT 5`,
        [userId, `%${name.toLowerCase()}%`]
      );

      return result.rows.map(r => ({
        email: r.recipient_email,
        name: r.recipient_name || r.recipient_email.split('@')[0],
        confidence: Math.min(r.send_count / 10, 1), // Higher count = higher confidence
      }));
    } catch (error) {
      console.error('[ContextResolver] Error searching recent recipients:', error);
      return [];
    }
  }

  /**
   * Search user's contacts (Google Contacts via Composio or local cache)
   */
  async searchContacts(name, userId, entityId) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping searchContacts for non-UUID userId:', userId);
      return [];
    }

    try {
      // First check local cache
      const cacheResult = await this.query(
        `SELECT email, name, phone FROM user_contacts
         WHERE user_id = $1
           AND (LOWER(name) LIKE $2 OR LOWER(email) LIKE $2)
         LIMIT 5`,
        [userId, `%${name.toLowerCase()}%`]
      );

      if (cacheResult.rows.length > 0) {
        return cacheResult.rows.map(r => ({
          email: r.email,
          name: r.name,
          confidence: 0.8,
        }));
      }

      // If no cache, try Google Contacts API via Composio
      // Note: This requires GOOGLECONTACTS toolkit to be connected
      try {
        const execResult = await this.composio.executeAction(
          'GOOGLECONTACTS_SEARCH_CONTACTS',
          { query: name },
          entityId
        );

        const contacts = execResult?.data?.contacts || execResult?.data || [];
        const contactList = Array.isArray(contacts) ? contacts : [];
        return contactList.slice(0, 5).map(c => ({
          email: c.email || c.emailAddresses?.[0]?.value,
          name: c.name || c.names?.[0]?.displayName || name,
          confidence: 0.7,
        })).filter(c => c.email);
      } catch (apiError) {
        // Google Contacts not available, skip
        console.log('[ContextResolver] Google Contacts not available:', apiError.message);
        return [];
      }
    } catch (error) {
      console.error('[ContextResolver] Error searching contacts:', error);
      return [];
    }
  }

  /**
   * Search organization users (Slack workspace members, Google Workspace)
   */
  async searchOrgUsers(name, entityId) {
    const results = [];

    // Try Slack workspace members
    try {
      const slackResult = await this.composio.executeAction(
        'SLACK_LIST_USERS',
        {},
        entityId
      );

      const members = slackResult?.data?.members || slackResult?.data || [];
      const memberList = Array.isArray(members) ? members : [];
      const matches = memberList.filter(m =>
        m.real_name?.toLowerCase().includes(name.toLowerCase()) ||
        m.name?.toLowerCase().includes(name.toLowerCase()) ||
        m.profile?.display_name?.toLowerCase().includes(name.toLowerCase())
      );

      for (const m of matches.slice(0, 3)) {
        if (m.profile?.email) {
          results.push({
            email: m.profile.email,
            name: m.real_name || m.name,
            confidence: 0.9,
            slackId: m.id,
          });
        }
      }
    } catch (error) {
      console.log('[ContextResolver] Slack users not available:', error.message);
    }

    return results;
  }

  /**
   * Resolve role-based references (my manager, my team)
   */
  async resolveRoleToEmail(role, userId) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping resolveRoleToEmail for non-UUID userId:', userId);
      return { resolved: false, name: role, needsSetup: true };
    }

    try {
      // Check user_settings for configured roles
      const result = await this.query(
        `SELECT settings FROM user_settings WHERE user_id = $1`,
        [userId]
      );

      const settings = result.rows[0]?.settings || {};

      switch (role) {
        case '_ROLE_MANAGER':
          if (settings.manager_email) {
            return { resolved: true, email: settings.manager_email, name: 'Manager', source: 'settings' };
          }
          break;
        case '_ROLE_TEAM':
          if (settings.team_emails) {
            return { resolved: true, email: settings.team_emails, name: 'Team', source: 'settings', isGroup: true };
          }
          break;
      }

      return { resolved: false, name: role, needsSetup: true };
    } catch (error) {
      console.error('[ContextResolver] Error resolving role:', error);
      return { resolved: false, name: role };
    }
  }

  /**
   * Cache a sent email recipient for future lookups
   */
  async cacheRecentRecipient(userId, recipientEmail, recipientName = null) {
    // Skip DB query if userId is not a valid UUID
    if (!isValidUUID(userId)) {
      console.log('[ContextResolver] Skipping cacheRecentRecipient for non-UUID userId:', userId);
      return;
    }

    try {
      await this.query(
        `INSERT INTO recent_recipients (user_id, recipient_email, recipient_name, last_sent_at, send_count)
         VALUES ($1, $2, $3, NOW(), 1)
         ON CONFLICT (user_id, recipient_email)
         DO UPDATE SET
           recipient_name = COALESCE($3, recent_recipients.recipient_name),
           last_sent_at = NOW(),
           send_count = recent_recipients.send_count + 1`,
        [userId, recipientEmail, recipientName]
      );
    } catch (error) {
      console.error('[ContextResolver] Error caching recipient:', error);
    }
  }
}

module.exports = ContextResolver;
