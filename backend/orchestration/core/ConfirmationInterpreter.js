/**
 * Enhanced confirmation interpretation helpers for AssistantOrchestrator
 * This file provides smart interpretation of user responses during confirmation.
 */

/**
 * Use LLM to interpret a user's response during confirmation phase
 * Supports: approvals, updates, partial approvals, corrections, rejections
 */
async function interpretConfirmationResponseWithLLM(callGemini, userText, pendingExecution) {
    const tools = pendingExecution?.tools || [];

    // Build detailed tool info for better context
    const toolDetails = tools.map(t => {
        const action = t.composio_action || t.name || '';
        const params = t.params || {};
        const category = action.includes('GMAIL') ? 'email' :
            action.includes('CALENDAR') ? 'calendar' :
                action.includes('SLACK') ? 'slack' :
                    action.includes('JIRA') ? 'jira' : 'other';
        return {
            action,
            category,
            summary: params.summary || params.subject || '',
            time: params.start_datetime || '',
            recipients: params.to || params.attendees || []
        };
    });

    const prompt = `You are interpreting a user's response to a confirmation prompt.

PENDING ACTIONS:
${JSON.stringify(toolDetails, null, 2)}

USER RESPONSE: "${userText}"

Analyze the response and return a JSON object with:

1. "intent": one of:
   - "approve": User confirms (yes, sure, go ahead, sounds good, lgtm, do it)
   - "approve_with_updates": User approves AND provides additions (yes with john@email.com, add Sarah)
   - "partial_approve": User wants to skip some actions (just the email, skip calendar, only jira)
   - "correction": User wants to change something (make it 4pm, change title to X, tomorrow instead)
   - "reject": User cancels (no, stop, cancel, never mind)
   - "clarify": User asks a question or response is ambiguous

2. "updates": Object with any extracted changes:
   - "attendees": Array of email addresses mentioned
   - "to": Array of email recipients
   - "start_datetime": If user specifies new time, provide in natural form (e.g., "4pm", "tomorrow at 3")
   - "summary": New title/summary if mentioned
   - "skipActions": Array of action CATEGORIES to skip (e.g., ["email", "slack"])
   - "onlyActions": Array of action CATEGORIES to run (e.g., ["calendar"])

3. "response": Brief acknowledgment message to show the user

INTERPRETATION RULES:
- "yes with john@test.com" = approve_with_updates with attendees
- "skip the email" = partial_approve with skipActions: ["email"]  
- "just the calendar" = partial_approve with onlyActions: ["calendar"]
- "make it 4pm" = correction with start_datetime: "4pm"
- "change the title to Team Sync" = correction with summary: "Team Sync"
- "yes but tomorrow" = correction with start_datetime: "tomorrow"
- Extract ALL email addresses you see

Return ONLY valid JSON, nothing else.`;

    try {
        const response = await callGemini(prompt, "", 0.2);
        const text = String(response || "").trim();

        // Try to parse JSON from response
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            return {
                intent: parsed.intent || "clarify",
                updates: parsed.updates || {},
                response: parsed.response || null,
            };
        }
    } catch (err) {
        console.warn("[ConfirmationInterpreter] LLM parsing failed:", err.message);
    }

    return null; // Signal to use fallback
}

/**
 * Simple pattern-based interpretation as fallback (no LLM needed)
 */
function interpretConfirmationResponseSimple(userText) {
    const text = String(userText || "").trim().toLowerCase();

    // Rejection patterns
    if (/^(no|n|nope|nah|don't|do not|stop|cancel|never\s*mind)$/i.test(text)) {
        return { intent: "reject", updates: {} };
    }

    // Skip/partial patterns
    const skipMatch = text.match(/(?:skip|without|no)\s+(?:the\s+)?(email|calendar|slack|jira|meeting)/i);
    if (skipMatch) {
        return {
            intent: "partial_approve",
            updates: { skipActions: [skipMatch[1].toLowerCase()] },
            response: `Skipping ${skipMatch[1]}`
        };
    }

    const onlyMatch = text.match(/(?:just|only)\s+(?:the\s+)?(email|calendar|slack|jira|meeting)/i);
    if (onlyMatch) {
        return {
            intent: "partial_approve",
            updates: { onlyActions: [onlyMatch[1].toLowerCase()] },
            response: `Running only ${onlyMatch[1]}`
        };
    }

    // Correction patterns
    const timeMatch = text.match(/(?:make\s+it|change\s+(?:it\s+)?to|at)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
    if (timeMatch) {
        return {
            intent: "correction",
            updates: { start_datetime: timeMatch[1] },
            response: `I'll update the time to ${timeMatch[1]}`
        };
    }

    const titleMatch = text.match(/(?:call\s+it|title|name\s+it|change\s+(?:title|name)\s+to)\s+["']?([^"']+)["']?/i);
    if (titleMatch) {
        return {
            intent: "correction",
            updates: { summary: titleMatch[1].trim() },
            response: `I'll change the title to "${titleMatch[1].trim()}"`
        };
    }

    // Approval patterns (including with additions)
    const approvalPatterns = [
        /^(yes|y|yeah|yep|ok|okay|sure|go\s*ahead|do\s*it|run\s*it|confirm|proceed|lgtm|sounds?\s*good)/i,
        /^(that'?s?\s+)?(right|correct|good|fine|perfect)/i,
    ];

    const isApproval = approvalPatterns.some(p => p.test(text));

    // Extract email addresses
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = text.match(emailPattern) || [];

    if (isApproval) {
        if (emails.length > 0) {
            return {
                intent: "approve_with_updates",
                updates: { attendees: emails },
                response: `Adding ${emails.join(", ")} and proceeding.`
            };
        }
        return { intent: "approve", updates: {} };
    }

    // If we found emails but no explicit approval word, treat as approve with updates
    // (user likely meant to add attendees and proceed)
    if (emails.length > 0) {
        return {
            intent: "approve_with_updates",
            updates: { attendees: emails },
            response: `I'll add ${emails.join(", ")} as attendee(s) and proceed.`
        };
    }

    // Couldn't determine intent
    return { intent: "clarify", updates: {}, response: null };
}

/**
 * Filter tools based on skip/only actions
 */
function filterToolsByIntent(tools, updates) {
    if (!tools || tools.length === 0) return tools;

    const skipActions = (updates.skipActions || []).map(s => s.toLowerCase());
    const onlyActions = (updates.onlyActions || []).map(s => s.toLowerCase());

    if (onlyActions.length > 0) {
        // Only run specified categories
        return tools.filter(t => {
            const action = (t.composio_action || t.name || '').toLowerCase();
            return onlyActions.some(cat => action.includes(cat));
        });
    }

    if (skipActions.length > 0) {
        // Skip specified categories
        return tools.filter(t => {
            const action = (t.composio_action || t.name || '').toLowerCase();
            return !skipActions.some(cat => action.includes(cat));
        });
    }

    return tools;
}

module.exports = {
    interpretConfirmationResponseWithLLM,
    interpretConfirmationResponseSimple,
    filterToolsByIntent,
};
