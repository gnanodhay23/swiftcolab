/**
 * Minimal smoke tests for ExecutorV2
 *
 * Run:
 *   node backend/tests/executorV2.test.js
 */

const assert = require("assert");
const { ExecutorV2 } = require("../orchestration/executorV2");

class MockComposioService {
  constructor({ delayMs = 25 } = {}) {
    this.delayMs = delayMs;
    this.entityId = "default";
    this.calls = [];
    this.inFlight = 0;
    this.maxInFlight = 0;
  }

  setEntityId(entityId) {
    this.entityId = entityId;
  }

  async executeAction(actionName, params, entityId) {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    this.calls.push({ actionName, params, entityId });

    // Simulate network latency
    await new Promise((r) => setTimeout(r, this.delayMs));

    this.inFlight -= 1;

    // Provide deterministic payloads for injection tests
    if (actionName === "JIRA_SEARCH_ISSUES") {
      return {
        success: true,
        data: {
          issues: [
            { key: "ABC-1", fields: { summary: "Fix login bug" } },
            { key: "ABC-2", fields: { summary: "Update docs" } },
          ],
        },
        error: null,
      };
    }

    return { success: true, data: { ok: true, actionName }, error: null };
  }
}

async function run() {
  // ---------------------------------------------------------------------------
  // 1) Concurrency: 60 parallel tool steps should respect maxConcurrency
  // ---------------------------------------------------------------------------
  {
    const composio = new MockComposioService({ delayMs: 30 });
    const exec = new ExecutorV2({
      composio,
      query: null,
      callGemini: null,
      options: { maxConcurrency: 7, useTemporalPrimary: false },
    });

    const parallelGroup = "g_all";
    const plan = {
      id: "plan_concurrency",
      steps: Array.from({ length: 60 }).map((_, i) => ({
        id: `s${i + 1}`,
        type: "tool",
        action: "TEST_NOOP",
        params: { n: i + 1 },
        dependsOn: [],
        parallelGroup,
        retryConfig: { maxRetries: 0, backoffMs: 1 },
      })),
    };

    const res = await exec.execute({ plan, userId: "u1", entityId: "user_u1", conversationId: "c1" });

    assert.strictEqual(res.success, true, "concurrency plan should succeed");
    assert.strictEqual(res.results.length, 60, "should return 60 step results");
    assert.strictEqual(composio.calls.length, 60, "should execute all 60 tool calls (no unintended dedupe)");
    assert(composio.maxInFlight <= 7, `max in-flight (${composio.maxInFlight}) should not exceed 7`);
  }

  // ---------------------------------------------------------------------------
  // 2) Sentinel injection: _inject_from_previous should be replaced
  // ---------------------------------------------------------------------------
  {
    const composio = new MockComposioService({ delayMs: 5 });
    const exec = new ExecutorV2({
      composio,
      query: null,
      callGemini: null,
      options: { maxConcurrency: 3, useTemporalPrimary: false },
    });

    const plan = {
      id: "plan_injection",
      steps: [
        {
          id: "a1",
          type: "tool",
          action: "JIRA_SEARCH_ISSUES",
          params: { jql: "project = ABC" },
          dependsOn: [],
          parallelGroup: "g0",
          retryConfig: { maxRetries: 0, backoffMs: 1 },
        },
        {
          id: "a2",
          type: "tool",
          action: "SLACK_SEND_MESSAGE",
          params: { channel: "general", text: "_inject_from_previous" },
          dependsOn: ["a1"],
          parallelGroup: null,
          retryConfig: { maxRetries: 0, backoffMs: 1 },
        },
      ],
    };

    const res = await exec.execute({ plan, userId: "u1", entityId: "user_u1", conversationId: "c1" });
    assert.strictEqual(res.success, true, "injection plan should succeed");

    const slackCall = composio.calls.find((c) => c.actionName === "SLACK_SEND_MESSAGE");
    assert(slackCall, "should call SLACK_SEND_MESSAGE");
    assert.notStrictEqual(slackCall.params.text, "_inject_from_previous", "sentinel should be replaced");
    assert(/ABC-1/.test(slackCall.params.text), "injected text should include issue key");
  }

  console.log("OK - ExecutorV2 smoke tests passed");
}

run().catch((err) => {
  console.error("FAILED - ExecutorV2 smoke tests:", err);
  process.exitCode = 1;
});
