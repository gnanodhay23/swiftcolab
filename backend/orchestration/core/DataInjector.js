/**
 * DataInjector - Unified data injection utility for multi-step orchestration
 * 
 * Used by both ExecutorV2 (direct execution) and Temporal workflow (durable execution)
 * to ensure consistent data injection between steps/tasks.
 */

// Patterns for fields that typically need content injection
const CONTENT_FIELD_PATTERNS = [
    /^body$/i, /^text$/i, /^content$/i, /^message$/i, /^description$/i,
    /^notes$/i, /^details$/i, /^html_body$/i, /^plain_text$/i, /^summary$/i
];

// Patterns for fields that reference IDs from previous actions
const REFERENCE_FIELD_PATTERNS = [
    /customer/i, /item/i, /invoice/i, /order/i, /ticket/i, /issue/i, /project/i,
    /parent/i, /document/i, /reference/i, /link/i
];

/**
 * Check if a field name matches content patterns (body, text, description, etc.)
 */
function isContentField(fieldName) {
    return CONTENT_FIELD_PATTERNS.some(p => p.test(fieldName));
}

/**
 * Check if a field name matches reference patterns (customer, item, etc.)
 */
function isReferenceField(fieldName) {
    return REFERENCE_FIELD_PATTERNS.some(p => p.test(fieldName));
}

/**
 * Extract usable data from a task/step result
 */
function extractResultData(result) {
    if (!result) return null;

    // Try common data locations
    if (result.data) return result.data;
    if (result.result) return result.result;
    if (result.output) return result.output;
    if (result.response) return result.response;

    // If result is already the data
    if (typeof result === 'object' && !result.success) {
        return result;
    }

    return result;
}

/**
 * Format data for injection into a text field (body, description, etc.)
 */
function formatDataForContent(data, sourceAction, options = {}) {
    const { maxChars = 4000, format = 'markdown' } = options;

    if (!data) return '';

    // If data is already a string, use it
    if (typeof data === 'string') {
        return data.length > maxChars ? data.slice(0, maxChars) + '...' : data;
    }

    // Format arrays (like lists of tickets, customers, etc.)
    if (Array.isArray(data)) {
        const items = data.slice(0, 20); // Limit to 20 items

        // Try to format nicely based on source
        if (/JIRA.*SEARCH|GET.*ISSUE/i.test(sourceAction)) {
            return formatJiraIssues(items, format);
        }
        if (/FRAPPE.*LIST.*CUSTOMER|LIST.*CUSTOMER/i.test(sourceAction)) {
            return formatFrappeCustomers(items, format);
        }
        if (/CALENDAR.*FIND|GET.*EVENT/i.test(sourceAction)) {
            return formatCalendarEvents(items, format);
        }

        // Generic array formatting
        return items.map((item, i) => {
            if (typeof item === 'object') {
                return `${i + 1}. ${JSON.stringify(item)}`;
            }
            return `${i + 1}. ${item}`;
        }).join('\n');
    }

    // Format objects
    if (typeof data === 'object') {
        return JSON.stringify(data, null, 2).slice(0, maxChars);
    }

    return String(data);
}

/**
 * Format Jira issues for email/message body
 */
function formatJiraIssues(issues, format = 'markdown') {
    if (!Array.isArray(issues) || issues.length === 0) {
        return 'No Jira issues found.';
    }

    const lines = ['## Jira Tickets', ''];
    for (const issue of issues) {
        const key = issue.key || issue.id || 'Unknown';
        const summary = issue.fields?.summary || issue.summary || issue.title || 'No summary';
        const status = issue.fields?.status?.name || issue.status || 'Unknown';
        const assignee = issue.fields?.assignee?.displayName || issue.assignee || 'Unassigned';

        lines.push(`- **${key}**: ${summary}`);
        lines.push(`  - Status: ${status} | Assignee: ${assignee}`);
    }

    return lines.join('\n');
}

/**
 * Format Frappe customers for email/message body
 */
function formatFrappeCustomers(customers, format = 'markdown') {
    if (!Array.isArray(customers) || customers.length === 0) {
        return 'No customers found.';
    }

    const lines = ['## Customers', ''];
    for (const customer of customers) {
        const name = customer.customer_name || customer.name || 'Unknown';
        const type = customer.customer_type || 'N/A';
        const group = customer.customer_group || 'N/A';

        lines.push(`- **${name}**`);
        if (type !== 'N/A' || group !== 'N/A') {
            lines.push(`  - Type: ${type} | Group: ${group}`);
        }
    }

    return lines.join('\n');
}

/**
 * Format calendar events for email/message body
 */
function formatCalendarEvents(events, format = 'markdown') {
    if (!Array.isArray(events) || events.length === 0) {
        return 'No calendar events found.';
    }

    const lines = ['## Calendar Events', ''];
    for (const event of events) {
        const summary = event.summary || event.title || 'Untitled';
        const start = event.start?.dateTime || event.start?.date || event.startTime || 'TBD';
        const end = event.end?.dateTime || event.end?.date || event.endTime || '';

        lines.push(`- **${summary}**`);
        lines.push(`  - ${start}${end ? ` to ${end}` : ''}`);
    }

    return lines.join('\n');
}

/**
 * Aggregate data from multiple sources for a single field (e.g., email body)
 */
function aggregateDataFromSources(sources, targetField, options = {}) {
    const { maxChars = 8000 } = options;

    if (!sources || sources.length === 0) return '';

    const sections = [];

    for (const source of sources) {
        const { action, data } = source;
        if (!data) continue;

        const formattedData = formatDataForContent(data, action, { maxChars: maxChars / sources.length });
        if (formattedData && formattedData.trim()) {
            sections.push(formattedData);
        }
    }

    return sections.join('\n\n---\n\n');
}

/**
 * Inject previous task results into current task params
 * 
 * @param {Object} task - Current task with params to inject into
 * @param {Map|Object} previousResults - Map of taskId -> result
 * @param {Object} params - Current params object
 * @returns {Object} - Params with injected data
 */
function injectPreviousTaskData(task, previousResults, params) {
    const injectedParams = { ...params };
    const dependsOn = task.dependsOn || [];

    // Get data from dependent tasks
    const dependentData = [];
    for (const depId of dependsOn) {
        const result = previousResults instanceof Map ? previousResults.get(depId) : previousResults[depId];
        if (result && (result.success !== false)) {
            dependentData.push({
                action: result.action || depId,
                data: extractResultData(result),
            });
        }
    }

    // Inject into content fields (body, description, etc.)
    for (const [field, value] of Object.entries(injectedParams)) {
        // Check for injection markers
        if (value === '_inject_from_previous' || value === '{{previous}}' || value === '') {
            if (isContentField(field) && dependentData.length > 0) {
                injectedParams[field] = aggregateDataFromSources(dependentData, field);
            }
        }

        // Handle template variables like {{t1.result}} or {{step1.data}}
        if (typeof value === 'string' && /\{\{(t\d+|step\d+)\./.test(value)) {
            const matches = value.matchAll(/\{\{(t\d+|step\d+)\.([^}]+)\}\}/g);
            let newValue = value;

            for (const match of matches) {
                const [fullMatch, refId, path] = match;
                const result = previousResults instanceof Map ? previousResults.get(refId) : previousResults[refId];

                if (result) {
                    const data = extractResultData(result);
                    const resolvedValue = getNestedValue(data, path);
                    newValue = newValue.replace(fullMatch, resolvedValue ?? '');
                }
            }

            injectedParams[field] = newValue;
        }
    }

    return injectedParams;
}

/**
 * Get nested value from object using dot-notation path
 */
function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;

    const parts = path.split('.');
    let current = obj;

    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }

    return current;
}

/**
 * Detect if a params object needs injection (has markers or empty content fields)
 */
function needsInjection(params, dependsOn = []) {
    if (!params || typeof params !== 'object') return false;
    if (dependsOn.length === 0) return false;

    for (const [field, value] of Object.entries(params)) {
        // Check for explicit markers
        if (value === '_inject_from_previous' || value === '{{previous}}') {
            return true;
        }

        // Check for template variables
        if (typeof value === 'string' && /\{\{(t\d+|step\d+)\./.test(value)) {
            return true;
        }

        // Check for empty content fields
        if (isContentField(field) && (value === '' || value === null || value === undefined)) {
            return true;
        }
    }

    return false;
}

module.exports = {
    // Field detection
    isContentField,
    isReferenceField,

    // Data extraction
    extractResultData,

    // Formatting
    formatDataForContent,
    formatJiraIssues,
    formatFrappeCustomers,
    formatCalendarEvents,
    aggregateDataFromSources,

    // Injection
    injectPreviousTaskData,
    needsInjection,

    // Helpers
    getNestedValue,

    // Constants
    CONTENT_FIELD_PATTERNS,
    REFERENCE_FIELD_PATTERNS,
};
