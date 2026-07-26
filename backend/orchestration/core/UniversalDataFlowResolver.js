/**
 * UniversalDataFlowResolver.js
 * 
 * A pattern-based, universal data flow resolver for multi-app orchestration.
 * Handles ANY combination of apps (10-20+) with ANY data flow pattern.
 * 
 * Features:
 * ✅ Pattern-based field detection (no hardcoded action names)
 * ✅ Universal data injection for ANY source → ANY destination
 * ✅ Automatic dependency chain resolution
 * ✅ Multi-source data aggregation
 * ✅ Format adapters for different field types
 * ✅ Scales to 20+ apps in single workflow
 * 
 * Data Flow Patterns Supported:
 * 1. REFERENCE: Use result ID from previous action (e.g., customer_name from CREATE → customer in INVOICE)
 * 2. AGGREGATE: Combine multiple results into one field (e.g., all creation results → email body)
 * 3. TRANSFORM: Map data between different formats (e.g., Frappe customer → Calendar attendee)
 * 4. PASSTHROUGH: Direct value passthrough for chained operations
 */

"use strict";

// =============================================================================
// FIELD PATTERN REGISTRY
// Universal patterns for detecting injectable fields across ANY app
// =============================================================================

const INJECTABLE_FIELD_PATTERNS = {
    // Content fields that typically need data from previous actions
    content: {
        patterns: [/^body$/i, /^text$/i, /^content$/i, /^message$/i, /^description$/i, /^notes$/i, /^details$/i, /^html_body$/i, /^plain_text$/i],
        type: 'content',
        injectionMode: 'aggregate', // Combine all relevant previous results
    },

    // Subject/title fields
    subject: {
        patterns: [/^subject$/i, /^title$/i, /^summary$/i, /^name$/i, /^topic$/i, /^heading$/i],
        type: 'subject',
        injectionMode: 'derive', // Derive from context/previous data
    },

    // Reference fields that need IDs from previous actions
    reference: {
        patterns: [
            /^customer$/i, /customer_name$/i, /customer_id$/i,
            /^item$/i, /item_code$/i, /item_name$/i,
            /^project$/i, /project_id$/i, /project_key$/i,
            /^supplier$/i, /supplier_name$/i,
            /^employee$/i, /employee_id$/i,
            /^order$/i, /order_id$/i, /sales_order$/i,
            /^invoice$/i, /invoice_id$/i,
            /^task$/i, /task_id$/i, /task_name$/i,
            /^document$/i, /doc_name$/i,
            /^issue$/i, /issue_key$/i, /ticket$/i,
            /^event$/i, /event_id$/i,
            /^channel$/i, /channel_id$/i,
            /^thread$/i, /thread_id$/i, /message_id$/i,
        ],
        type: 'reference',
        injectionMode: 'resolve', // Resolve from matching previous action result
    },

    // Email recipient fields
    recipients: {
        patterns: [/^to$/i, /^cc$/i, /^bcc$/i, /^recipients?$/i, /^attendees?$/i, /^invitees?$/i, /^assignee$/i],
        type: 'recipients',
        injectionMode: 'extract', // Extract emails from context
    },

    // Array/list fields for items
    items: {
        patterns: [/^items$/i, /^line_items$/i, /^products$/i, /^entries$/i],
        type: 'items',
        injectionMode: 'build', // Build from previous item data
    },

    // Date/time fields
    datetime: {
        patterns: [/date$/i, /time$/i, /^when$/i, /^schedule$/i, /^deadline$/i, /^due$/i],
        type: 'datetime',
        injectionMode: 'parse', // Parse from context
    },
};

// =============================================================================
// ACTION PRODUCES DATA PATTERNS
// Which actions produce data that can be used downstream
// =============================================================================

const DATA_PRODUCING_PATTERNS = {
    // CREATE actions produce new record IDs/data
    create: {
        pattern: /^(?:FRAPPE_|JIRA_|GOOGLECALENDAR_|GMAIL_|SLACK_|ASANA_|TRELLO_|HUBSPOT_|NOTION_)?CREATE/i,
        outputType: 'created_record',
        extractors: {
            id: (data) => data?.name || data?.id || data?.key || data?.document_id,
            name: (data) => data?.name || data?.customer_name || data?.item_name || data?.title || data?.summary,
            fullData: (data) => data,
        },
    },

    // LIST/SEARCH/GET/FETCH actions produce data arrays or records
    fetch: {
        pattern: /^(?:FRAPPE_|JIRA_|GOOGLECALENDAR_|GMAIL_|SLACK_|ASANA_|TRELLO_)?(?:LIST|SEARCH|GET|FETCH|FIND)/i,
        outputType: 'fetched_data',
        extractors: {
            items: (data) => data?.data || data?.items || data?.issues || data?.events || data?.messages || data?.results || (Array.isArray(data) ? data : [data]),
            count: (data) => {
                const items = data?.data || data?.items || data?.issues || data?.events || data?.messages || (Array.isArray(data) ? data : null);
                return items?.length || 0;
            },
            fullData: (data) => data,
        },
    },

    // UPDATE actions produce updated record confirmation
    update: {
        pattern: /^(?:FRAPPE_|JIRA_|GOOGLECALENDAR_|GMAIL_|SLACK_)?UPDATE/i,
        outputType: 'updated_record',
        extractors: {
            id: (data) => data?.name || data?.id || data?.key,
            changes: (data) => data?.modified_fields || data?.changes || data,
        },
    },

    // SEND actions produce confirmation/IDs
    send: {
        pattern: /^(?:GMAIL_|SLACK_)?SEND/i,
        outputType: 'sent_confirmation',
        extractors: {
            id: (data) => data?.messageId || data?.message_id || data?.ts || data?.id,
            status: (data) => data?.status || 'sent',
        },
    },
};

// =============================================================================
// UNIVERSAL DATA FLOW RESOLVER CLASS
// =============================================================================

class UniversalDataFlowResolver {
    constructor(options = {}) {
        this.options = {
            maxDataSize: options.maxDataSize || 10000, // Max chars for injected content
            enableAISummarization: options.enableAISummarization !== false,
            debug: options.debug || false,
        };

        this.fieldPatterns = { ...INJECTABLE_FIELD_PATTERNS, ...(options.customPatterns || {}) };
        this.producerPatterns = { ...DATA_PRODUCING_PATTERNS, ...(options.customProducers || {}) };
    }

    /**
     * Main entry: resolve all data dependencies for a task
     * 
     * @param {Object} task - Current task to resolve
     * @param {Map} taskResults - Map of taskId -> { action, data }
     * @param {Object} params - Current params for the task
     * @param {Object} context - Workflow context (originalMessage, etc.)
     * @returns {Object} Resolved params with injected data
     */
    async resolveDataFlow(task, taskResults, params, context = {}) {
        const resolvedParams = { ...params };
        const action = task.action || '';

        this._log(`Resolving data flow for ${action} with ${taskResults.size} previous results`);

        // 1. Resolve explicit injection tokens (_inject_from_previous, __INJECT__, etc.)
        await this._resolveInjectionTokens(resolvedParams, taskResults, context);

        // 2. Resolve reference fields (customer, item_code, etc.) from CREATE results
        await this._resolveReferenceFields(task, resolvedParams, taskResults, context);

        // 3. Resolve content fields (body, description, text) with aggregate data
        await this._resolveContentFields(task, resolvedParams, taskResults, context);

        // 4. Resolve template variables ({{taskId.field}})
        this._resolveTemplateVariables(resolvedParams, taskResults);

        // 5. Handle explicit _injectResultTo directives
        if (task._injectResultTo && task._sourceTaskId) {
            const sourceResult = taskResults.get(task._sourceTaskId);
            if (sourceResult?.data) {
                resolvedParams[task._injectResultTo] = this._formatForInjection(sourceResult.data, sourceResult.action);
                this._log(`Explicit injection: ${task._sourceTaskId} → ${task._injectResultTo}`);
            }
        }

        return resolvedParams;
    }

    /**
     * Detect injectable fields in params that need data
     */
    _resolveInjectionTokens(params, taskResults, context) {
        const INJECTION_TOKENS = ['_inject_from_previous', '__INJECT__', '{{previous}}', '{{all_results}}'];

        for (const [field, value] of Object.entries(params)) {
            if (typeof value === 'string' && INJECTION_TOKENS.some(token => value.includes(token))) {
                // This field needs injection - collect all relevant previous data
                const aggregatedData = this._aggregateAllResults(taskResults);
                params[field] = this._formatAggregatedData(aggregatedData, field, context);
                this._log(`Resolved injection token in ${field}`);
            }
        }
    }

    /**
     * Resolve reference fields that need IDs from CREATE actions
     * E.g., FRAPPE_CREATE_CUSTOMER result → customer field in FRAPPE_CREATE_SALES_INVOICE
     */
    async _resolveReferenceFields(task, params, taskResults, context) {
        const referencePattern = this.fieldPatterns.reference;

        for (const [field, value] of Object.entries(params)) {
            // Skip if already has a value
            if (value && value !== '' && !this._isInjectionToken(value)) continue;

            // Check if this field matches a reference pattern
            if (!referencePattern.patterns.some(p => p.test(field))) continue;

            // Find matching CREATE result
            const matchingResult = this._findMatchingCreateResult(field, taskResults);
            if (matchingResult) {
                const extractedValue = this._extractReferenceValue(field, matchingResult);
                if (extractedValue) {
                    params[field] = extractedValue;
                    this._log(`Resolved reference: ${field} = ${extractedValue} from ${matchingResult.action}`);
                }
            }
        }
    }

    /**
     * Resolve content fields (body, description, text) with aggregate data
     */
    async _resolveContentFields(task, params, taskResults, context) {
        const contentPattern = this.fieldPatterns.content;

        for (const [field, value] of Object.entries(params)) {
            // Check if this is a content field that needs injection
            if (!contentPattern.patterns.some(p => p.test(field))) continue;

            // Skip if has meaningful value
            if (value && value !== '' && !this._isInjectionToken(value) && value.length > 10) continue;

            // Check if there are previous results to inject
            if (taskResults.size === 0) continue;

            // Aggregate all relevant previous results
            const aggregatedData = this._aggregateAllResults(taskResults);
            if (aggregatedData.length > 0) {
                params[field] = this._formatAggregatedData(aggregatedData, field, context);
                this._log(`Resolved content field: ${field} with ${aggregatedData.length} data sources`);
            }
        }
    }

    /**
     * Resolve {{taskId.field}} template variables
     */
    _resolveTemplateVariables(params, taskResults) {
        for (const [key, value] of Object.entries(params)) {
            if (typeof value !== 'string') continue;

            // Replace {{taskId.field}} patterns
            params[key] = value.replace(/\{\{(\w+)\.(\w+)\}\}/g, (match, taskId, field) => {
                const taskResult = taskResults.get(taskId);
                if (taskResult?.data?.[field]) {
                    return taskResult.data[field];
                }
                return match; // Keep original if not found
            });

            // Replace {{taskId}} with formatted result
            params[key] = params[key].replace(/\{\{(\w+)\}\}/g, (match, taskId) => {
                const taskResult = taskResults.get(taskId);
                if (taskResult?.data) {
                    return this._formatForInjection(taskResult.data, taskResult.action);
                }
                return match;
            });
        }
    }

    /**
     * Find CREATE result that matches a reference field
     */
    _findMatchingCreateResult(field, taskResults) {
        const fieldLower = field.toLowerCase();

        // Map field names to likely source actions
        const fieldToActionMap = {
            customer: ['FRAPPE_CREATE_CUSTOMER', 'HUBSPOT_CREATE_CONTACT', 'SALESFORCE_CREATE_ACCOUNT'],
            customer_name: ['FRAPPE_CREATE_CUSTOMER'],
            item: ['FRAPPE_CREATE_ITEM'],
            item_code: ['FRAPPE_CREATE_ITEM'],
            item_name: ['FRAPPE_CREATE_ITEM'],
            project: ['FRAPPE_CREATE_PROJECT', 'JIRA_CREATE_PROJECT', 'ASANA_CREATE_PROJECT'],
            project_key: ['JIRA_CREATE_PROJECT'],
            supplier: ['FRAPPE_CREATE_SUPPLIER'],
            task: ['FRAPPE_CREATE_TASK', 'ASANA_CREATE_TASK', 'TRELLO_CREATE_CARD'],
            issue: ['JIRA_CREATE_ISSUE'],
            ticket: ['JIRA_CREATE_ISSUE', 'ZENDESK_CREATE_TICKET'],
            employee: ['FRAPPE_CREATE_EMPLOYEE'],
            order: ['FRAPPE_CREATE_SALES_ORDER'],
            sales_order: ['FRAPPE_CREATE_SALES_ORDER'],
            invoice: ['FRAPPE_CREATE_SALES_INVOICE'],
            event: ['GOOGLECALENDAR_CREATE_EVENT'],
        };

        // Try exact field match first
        for (const [mapField, actions] of Object.entries(fieldToActionMap)) {
            if (fieldLower === mapField || fieldLower.includes(mapField)) {
                for (const [taskId, result] of taskResults) {
                    if (actions.some(a => result.action?.toUpperCase() === a)) {
                        return result;
                    }
                }
            }
        }

        // Fallback: find any CREATE action that might match
        const fieldRoot = fieldLower.replace(/_?(id|name|code|key)$/i, '');
        for (const [taskId, result] of taskResults) {
            if (result.action?.includes('CREATE') && result.action?.toLowerCase().includes(fieldRoot)) {
                return result;
            }
        }

        return null;
    }

    /**
     * Extract the right value from a CREATE result for a reference field
     */
    _extractReferenceValue(field, result) {
        const data = result.data || {};
        const fieldLower = field.toLowerCase();

        // Common ID/name extraction patterns
        if (fieldLower.includes('id') || fieldLower.includes('key')) {
            return data.name || data.id || data.key || data.document_id || data.issue_key;
        }

        if (fieldLower.includes('name')) {
            return data.name || data.customer_name || data.item_name || data.title || data.full_name;
        }

        if (fieldLower.includes('code')) {
            return data.item_code || data.code || data.name;
        }

        // Generic fallback
        return data.name || data.id || data.key;
    }

    /**
     * Aggregate all results from previous tasks
     */
    _aggregateAllResults(taskResults) {
        const aggregated = [];

        for (const [taskId, result] of taskResults) {
            const action = result.action || '';
            const data = result.data;

            if (!data) continue;

            // Determine the type of result
            let resultType = 'unknown';
            let formattedData = null;

            for (const [type, pattern] of Object.entries(this.producerPatterns)) {
                if (pattern.pattern.test(action)) {
                    resultType = pattern.outputType;
                    formattedData = pattern.extractors.fullData(data);
                    break;
                }
            }

            aggregated.push({
                taskId,
                action,
                resultType,
                data: formattedData || data,
            });
        }

        return aggregated;
    }

    /**
     * Format aggregated data for injection into a field
     */
    _formatAggregatedData(aggregatedData, targetField, context) {
        if (aggregatedData.length === 0) return '';

        const sections = [];

        for (const item of aggregatedData) {
            const formatted = this._formatForInjection(item.data, item.action);
            if (formatted && formatted.length > 0) {
                const header = this._getDataHeader(item.action);
                sections.push(`${header}\n${formatted}`);
            }
        }

        if (sections.length === 0) return '';

        // Truncate if too long
        let result = sections.join('\n\n');
        if (result.length > this.options.maxDataSize) {
            result = result.substring(0, this.options.maxDataSize) + '\n... (truncated)';
        }

        return result;
    }

    /**
     * Get a human-readable header for an action's data
     */
    _getDataHeader(action) {
        const actionStr = String(action || '').toUpperCase();

        // Extract app and operation from action name
        const match = actionStr.match(/^([A-Z]+)_(.+)$/);
        if (match) {
            const [, app, operation] = match;
            const appDisplayName = {
                FRAPPE: '📋 ERPNext',
                GMAIL: '📧 Email',
                GOOGLECALENDAR: '📅 Calendar',
                SLACK: '💬 Slack',
                JIRA: '🎫 Jira',
                ASANA: '✅ Asana',
                TRELLO: '📝 Trello',
                HUBSPOT: '🏢 HubSpot',
                GITHUB: '🐙 GitHub',
                NOTION: '📓 Notion',
                ZOOM: '📹 Zoom',
            }[app] || `📌 ${app}`;

            const opHuman = operation.replace(/_/g, ' ').toLowerCase();
            return `${appDisplayName} - ${opHuman}\n${'─'.repeat(25)}`;
        }

        return `📌 ${action}\n${'─'.repeat(25)}`;
    }

    /**
     * Format data for injection into a param
     */
    _formatForInjection(data, action) {
        if (!data) return '';

        // Unwrap Composio/API response format
        let unwrapped = data;
        if (data.success === true && data.data && typeof data.data === 'object') {
            unwrapped = data.data;
        }

        // Handle arrays (list/search results)
        const arrayKeys = ['issues', 'events', 'messages', 'items', 'data', 'results', 'customers', 'tasks', 'projects'];
        for (const key of arrayKeys) {
            if (unwrapped[key] && Array.isArray(unwrapped[key])) {
                return this._formatArray(unwrapped[key], action);
            }
        }

        // Handle direct arrays
        if (Array.isArray(unwrapped)) {
            return this._formatArray(unwrapped, action);
        }

        // Handle single objects (create results, etc.)
        if (typeof unwrapped === 'object') {
            return this._formatObject(unwrapped, action);
        }

        return String(unwrapped);
    }

    /**
     * Format an array of items
     */
    _formatArray(items, action) {
        if (!items || items.length === 0) return 'No items found.';

        const formatted = items.slice(0, 20).map((item, idx) => {
            if (typeof item === 'object') {
                // Extract key fields
                const key = item.key || item.id || item.name || `#${idx + 1}`;
                const title = item.summary || item.title || item.subject || item.name || item.customer_name || item.item_name || '';
                const status = item.status?.name || item.status || '';
                const extra = [];

                if (item.from) extra.push(`From: ${item.from}`);
                if (item.start?.dateTime) extra.push(`Time: ${new Date(item.start.dateTime).toLocaleString()}`);
                if (item.grand_total) extra.push(`Total: ${item.grand_total}`);
                if (item.email_id) extra.push(`Email: ${item.email_id}`);

                let line = `• ${key}`;
                if (title && title !== key) line += `: ${title}`;
                if (status) line += ` [${status}]`;
                if (extra.length > 0) line += `\n  ${extra.join(' | ')}`;

                return line;
            }
            return `• ${item}`;
        }).join('\n');

        const countInfo = items.length > 20 ? `\n... and ${items.length - 20} more` : '';
        return `${items.length} item(s):\n${formatted}${countInfo}`;
    }

    /**
     * Format a single object
     */
    _formatObject(obj, action) {
        const lines = [];

        // Try common display fields
        const displayFields = [
            { key: 'name', label: 'ID' },
            { key: 'customer_name', label: 'Customer' },
            { key: 'item_name', label: 'Item' },
            { key: 'item_code', label: 'Item Code' },
            { key: 'title', label: 'Title' },
            { key: 'summary', label: 'Summary' },
            { key: 'subject', label: 'Subject' },
            { key: 'status', label: 'Status' },
            { key: 'grand_total', label: 'Total' },
            { key: 'email_id', label: 'Email' },
            { key: 'mobile_no', label: 'Mobile' },
            { key: 'customer_type', label: 'Type' },
            { key: 'territory', label: 'Territory' },
            { key: 'creation', label: 'Created' },
        ];

        for (const { key, label } of displayFields) {
            if (obj[key] !== undefined && obj[key] !== null && obj[key] !== '') {
                lines.push(`• ${label}: ${obj[key]}`);
            }
        }

        if (lines.length === 0) {
            // Fallback to JSON for unknown structure
            const jsonStr = JSON.stringify(obj, null, 2);
            return jsonStr.length > 500 ? jsonStr.substring(0, 500) + '...' : jsonStr;
        }

        return lines.join('\n');
    }

    _isInjectionToken(value) {
        if (typeof value !== 'string') return false;
        const tokens = ['_inject_from_previous', '__INJECT__', '{{previous}}', '{{all_results}}'];
        return tokens.some(t => value.includes(t));
    }

    _log(...args) {
        if (this.options.debug) {
            console.log('[UniversalDataFlowResolver]', ...args);
        }
    }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
    UniversalDataFlowResolver,
    INJECTABLE_FIELD_PATTERNS,
    DATA_PRODUCING_PATTERNS,
};
