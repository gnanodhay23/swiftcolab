/**
 * EmailBodyGenerator - Generate meaningful email bodies from data
 *
 * Prevents sending useless emails like "Please find the attached Jira tickets"
 * when there are no attachments and no tickets.
 *
 * Returns null/error when data is missing - signals workflow should stop.
 */

class EmailBodyGenerator {
  constructor(options = {}) {
    this.jiraBaseUrl = options.jiraBaseUrl || 'https://your-domain.atlassian.net';
    this.includeLinks = options.includeLinks !== false;
  }

  /**
   * Generate email body from content source and data
   *
   * @param {string} contentType - Type of content (jira_tickets, calendar_events, etc.)
   * @param {object|array} data - The actual data to include
   * @param {object} options - Additional options (template, format, etc.)
   * @returns {object} - { success, body, error, itemCount }
   */
  generate(contentType, data, options = {}) {
    // Validate data exists
    if (!data || (Array.isArray(data) && data.length === 0)) {
      return {
        success: false,
        body: null,
        error: `No ${contentType.replace(/_/g, ' ')} to include in email`,
        itemCount: 0,
      };
    }

    // Route to appropriate generator
    switch (contentType) {
      case 'jira_tickets':
      case 'jira_issues':
        return this._generateJiraBody(data, options);

      case 'calendar_events':
        return this._generateCalendarBody(data, options);

      case 'email_summary':
        return this._generateEmailSummaryBody(data, options);

      case 'slack_messages':
        return this._generateSlackSummaryBody(data, options);

      case 'tasks':
      case 'todo_list':
        return this._generateTaskListBody(data, options);

      case 'custom':
        return this._generateCustomBody(data, options);

      default:
        // Try to format data as a list
        return this._generateGenericBody(contentType, data, options);
    }
  }

  /**
   * Generate body for Jira tickets
   */
  _generateJiraBody(tickets, options = {}) {
    const items = this._extractTickets(tickets);

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: 'No Jira tickets found to include',
        itemCount: 0,
      };
    }

    const format = options.format || 'detailed';
    let body = '';

    // Header
    if (options.greeting) {
      body += `${options.greeting}\n\n`;
    }

    body += `Here ${items.length === 1 ? 'is' : 'are'} ${items.length} Jira ticket${items.length === 1 ? '' : 's'}:\n\n`;

    // Format based on style
    if (format === 'compact') {
      body += this._formatTicketsCompact(items);
    } else if (format === 'table') {
      body += this._formatTicketsAsTable(items);
    } else {
      body += this._formatTicketsDetailed(items);
    }

    // Footer
    if (options.footer) {
      body += `\n${options.footer}`;
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Extract tickets from various response formats
   */
  _extractTickets(data) {
    // Direct array
    if (Array.isArray(data)) {
      return data;
    }

    // Nested in data.issues
    if (data.data?.issues) {
      return data.data.issues;
    }

    // Nested in issues
    if (data.issues) {
      return data.issues;
    }

    // Nested in data
    if (Array.isArray(data.data)) {
      return data.data;
    }

    // Single ticket object
    if (data.key || data.id) {
      return [data];
    }

    return [];
  }

  /**
   * Format tickets in detailed style
   */
  _formatTicketsDetailed(tickets) {
    let body = '';

    for (const ticket of tickets) {
      const key = ticket.key || ticket.issue_key || 'Unknown';
      const summary = ticket.fields?.summary || ticket.summary || 'No title';
      const status = ticket.fields?.status?.name || ticket.status || 'Unknown';
      const assignee = ticket.fields?.assignee?.displayName || ticket.assignee || 'Unassigned';
      const priority = ticket.fields?.priority?.name || ticket.priority || 'None';

      body += `📋 ${key}: ${summary}\n`;
      body += `   Status: ${status} | Priority: ${priority}\n`;
      body += `   Assignee: ${assignee}\n`;

      if (this.includeLinks) {
        const link = ticket.self || ticket.browser_url || `${this.jiraBaseUrl}/browse/${key}`;
        body += `   Link: ${link}\n`;
      }

      body += '\n';
    }

    return body;
  }

  /**
   * Format tickets in compact style
   */
  _formatTicketsCompact(tickets) {
    let body = '';

    for (const ticket of tickets) {
      const key = ticket.key || ticket.issue_key;
      const summary = ticket.fields?.summary || ticket.summary || 'No title';
      const status = ticket.fields?.status?.name || ticket.status || '';

      body += `• ${key}: ${summary}`;
      if (status) body += ` [${status}]`;
      body += '\n';
    }

    return body;
  }

  /**
   * Format tickets as ASCII table
   */
  _formatTicketsAsTable(tickets) {
    // Headers
    let body = 'Key          | Summary                                | Status     | Assignee\n';
    body += '-------------|----------------------------------------|------------|----------------\n';

    for (const ticket of tickets) {
      const key = (ticket.key || '').padEnd(12);
      const summary = (ticket.fields?.summary || ticket.summary || '').substring(0, 38).padEnd(38);
      const status = (ticket.fields?.status?.name || ticket.status || '').padEnd(10);
      const assignee = ticket.fields?.assignee?.displayName || ticket.assignee || 'Unassigned';

      body += `${key} | ${summary} | ${status} | ${assignee}\n`;
    }

    return body;
  }

  /**
   * Generate body for calendar events
   */
  _generateCalendarBody(events, options = {}) {
    const items = Array.isArray(events) ? events :
      events.data?.items || events.items || [events];

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: 'No calendar events found to include',
        itemCount: 0,
      };
    }

    let body = options.greeting || '';
    body += body ? '\n\n' : '';
    body += `Here ${items.length === 1 ? 'is' : 'are'} ${items.length} calendar event${items.length === 1 ? '' : 's'}:\n\n`;

    for (const event of items) {
      const summary = event.summary || 'Untitled Event';
      const start = this._formatEventTime(event.start);
      const end = this._formatEventTime(event.end);
      const location = event.location || '';

      body += `📅 ${summary}\n`;
      body += `   When: ${start} - ${end}\n`;
      if (location) body += `   Where: ${location}\n`;

      if (event.attendees?.length > 0) {
        const attendeeNames = event.attendees
          .slice(0, 5)
          .map(a => a.displayName || a.email)
          .join(', ');
        body += `   With: ${attendeeNames}${event.attendees.length > 5 ? '...' : ''}\n`;
      }

      if (event.htmlLink && this.includeLinks) {
        body += `   Link: ${event.htmlLink}\n`;
      }

      body += '\n';
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Format event time
   */
  _formatEventTime(timeObj) {
    if (!timeObj) return 'TBD';

    const dateStr = timeObj.dateTime || timeObj.date;
    if (!dateStr) return 'TBD';

    try {
      const date = new Date(dateStr);
      return date.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  }

  /**
   * Generate summary of emails
   */
  _generateEmailSummaryBody(emails, options = {}) {
    // Unwrap nested structures from Composio API
    let items = [];
    if (Array.isArray(emails)) {
      items = emails;
    } else if (emails.data?.messages) {
      items = emails.data.messages;
    } else if (emails.messages) {
      items = emails.messages;
    } else if (emails.data && Array.isArray(emails.data)) {
      items = emails.data;
    }

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: 'No emails found to summarize',
        itemCount: 0,
      };
    }

    // Limit to first 20 emails to keep email body reasonable
    const displayItems = items.slice(0, 20);
    let body = `Summary of ${items.length} email${items.length === 1 ? '' : 's'}:\n\n`;

    for (const email of displayItems) {
      // Extract subject - check multiple locations (Gmail API uses payload.headers)
      let subject = email.subject || '(No subject)';
      if (subject === '(No subject)' && email.payload?.headers) {
        const subjectHeader = email.payload.headers.find(
          h => h.name?.toLowerCase() === 'subject'
        );
        if (subjectHeader?.value) subject = subjectHeader.value;
      }

      // Extract from/sender - check multiple locations
      let from = email.from || email.sender || 'Unknown';
      if (from === 'Unknown' && email.payload?.headers) {
        const fromHeader = email.payload.headers.find(
          h => h.name?.toLowerCase() === 'from'
        );
        if (fromHeader?.value) from = fromHeader.value;
      }

      // Extract date
      let date = email.date || email.receivedAt || email.messageTimestamp || '';
      if (!date && email.internalDate) {
        date = new Date(parseInt(email.internalDate)).toLocaleString();
      }
      if (!date && email.payload?.headers) {
        const dateHeader = email.payload.headers.find(
          h => h.name?.toLowerCase() === 'date'
        );
        if (dateHeader?.value) date = dateHeader.value;
      }
      if (date && typeof date === 'string' && date.includes('T')) {
        // ISO date format - convert to readable
        try { date = new Date(date).toLocaleString(); } catch { }
      }

      // Extract snippet/preview
      const snippet = email.snippet ||
        (email.messageText ? email.messageText.substring(0, 100) : '');

      body += `📧 "${subject}"\n`;
      body += `   From: ${from}\n`;
      if (date) body += `   Date: ${date}\n`;
      if (snippet) body += `   Preview: ${snippet}${snippet.length >= 100 ? '...' : ''}\n`;
      body += '\n';
    }

    if (items.length > 20) {
      body += `... and ${items.length - 20} more emails.\n`;
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Generate Slack message summary
   */
  _generateSlackSummaryBody(messages, options = {}) {
    const items = Array.isArray(messages) ? messages : messages.messages || [];

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: 'No Slack messages found',
        itemCount: 0,
      };
    }

    let body = `Summary of ${items.length} Slack message${items.length === 1 ? '' : 's'}:\n\n`;

    for (const msg of items) {
      const text = (msg.text || '').substring(0, 100);
      const user = msg.user || msg.username || 'Unknown';
      const channel = msg.channel || '';

      body += `💬 ${user}${channel ? ` in #${channel}` : ''}\n`;
      body += `   "${text}${msg.text?.length > 100 ? '...' : ''}"\n\n`;
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Generate task list body
   */
  _generateTaskListBody(tasks, options = {}) {
    const items = Array.isArray(tasks) ? tasks : tasks.tasks || tasks.items || [];

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: 'No tasks found to include',
        itemCount: 0,
      };
    }

    let body = `Task List (${items.length} item${items.length === 1 ? '' : 's'}):\n\n`;

    for (let i = 0; i < items.length; i++) {
      const task = items[i];
      const title = task.title || task.summary || task.name || `Task ${i + 1}`;
      const status = task.status || task.completed ? '✓' : '○';
      const due = task.dueDate || task.due || '';

      body += `${status} ${title}`;
      if (due) body += ` (Due: ${due})`;
      body += '\n';
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Generate custom body from template
   */
  _generateCustomBody(data, options = {}) {
    if (!options.template) {
      return {
        success: false,
        body: null,
        error: 'Custom body requires a template',
        itemCount: 0,
      };
    }

    let body = options.template;

    // Replace placeholders
    if (typeof data === 'object') {
      for (const [key, value] of Object.entries(data)) {
        body = body.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
      }
    }

    return {
      success: true,
      body,
      itemCount: 1,
    };
  }

  /**
   * Generate generic list body
   */
  _generateGenericBody(contentType, data, options = {}) {
    const items = Array.isArray(data) ? data : [data];

    if (items.length === 0) {
      return {
        success: false,
        body: null,
        error: `No ${contentType} found`,
        itemCount: 0,
      };
    }

    const typeName = contentType.replace(/_/g, ' ');
    let body = `Here ${items.length === 1 ? 'is' : 'are'} ${items.length} ${typeName}:\n\n`;

    for (const item of items) {
      if (typeof item === 'string') {
        body += `• ${item}\n`;
      } else if (typeof item === 'object') {
        // Try to find a meaningful display value
        const display = item.name || item.title || item.summary ||
          item.key || item.id || JSON.stringify(item);
        body += `• ${display}\n`;
      }
    }

    return {
      success: true,
      body,
      itemCount: items.length,
    };
  }

  /**
   * Validate that email params have meaningful content
   * Returns errors if email would be useless
   */
  validateEmailParams(params) {
    const errors = [];

    // Check subject
    if (!params.subject || params.subject.trim().length < 2) {
      errors.push('Email subject is missing or too short');
    }

    // Check body
    if (!params.body || params.body.trim().length < 10) {
      errors.push('Email body is missing or too short');
    }

    // Check for placeholder text that shouldn't be sent
    const placeholderPatterns = [
      /please find the attached/i,
      /see attached/i,
      /as discussed/i,
    ];

    if (params.body) {
      for (const pattern of placeholderPatterns) {
        if (pattern.test(params.body) && params.body.length < 50) {
          errors.push('Email body appears to be placeholder text with no actual content');
          break;
        }
      }
    }

    // Check recipient
    if (!params.to || (Array.isArray(params.to) && params.to.length === 0)) {
      errors.push('No email recipient specified');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }
}

// Singleton instance
const emailBodyGenerator = new EmailBodyGenerator();

// Helper functions
function generateEmailBody(contentType, data, options) {
  return emailBodyGenerator.generate(contentType, data, options);
}

function validateEmailParams(params) {
  return emailBodyGenerator.validateEmailParams(params);
}

module.exports = {
  EmailBodyGenerator,
  generateEmailBody,
  validateEmailParams,
};
