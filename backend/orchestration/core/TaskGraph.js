/**
 * TaskGraph - Dependency resolution and cycle detection for multi-task workflows
 *
 * Features:
 * - Topological sort for task ordering
 * - Cycle detection with detailed path reporting
 * - Dependency validation
 * - Template variable dependency tracking
 */

class TaskGraph {
  constructor() {
    this.nodes = new Map(); // taskId -> task
    this.edges = new Map(); // taskId -> Set of dependent taskIds
    this.reverseEdges = new Map(); // taskId -> Set of taskIds it depends on
  }

  /**
   * Add a task to the graph
   * @param {Object} task - Task with id, action, dependsOn, params
   */
  addTask(task) {
    if (!task.id) {
      throw new Error('Task must have an id');
    }

    this.nodes.set(task.id, task);

    if (!this.edges.has(task.id)) {
      this.edges.set(task.id, new Set());
    }

    if (!this.reverseEdges.has(task.id)) {
      this.reverseEdges.set(task.id, new Set());
    }

    // Add dependencies
    const deps = task.dependsOn || [];
    for (const depId of deps) {
      this.addDependency(task.id, depId);
    }

    // Extract implicit dependencies from template variables (e.g., {{t1.summary}})
    this._extractTemplateDependencies(task);

    return this;
  }

  /**
   * Add a dependency edge
   * @param {string} taskId - Task that has the dependency
   * @param {string} dependsOnId - Task that must run first
   */
  addDependency(taskId, dependsOnId) {
    if (!this.reverseEdges.has(taskId)) {
      this.reverseEdges.set(taskId, new Set());
    }
    this.reverseEdges.get(taskId).add(dependsOnId);

    if (!this.edges.has(dependsOnId)) {
      this.edges.set(dependsOnId, new Set());
    }
    this.edges.get(dependsOnId).add(taskId);

    return this;
  }

  /**
   * Extract dependencies from template variables in params
   */
  _extractTemplateDependencies(task) {
    if (!task.params) return;

    const templateRegex = /\{\{(\w+)\./g;

    for (const value of Object.values(task.params)) {
      if (typeof value === 'string') {
        let match;
        while ((match = templateRegex.exec(value)) !== null) {
          const refTaskId = match[1];
          if (refTaskId !== task.id) {
            this.addDependency(task.id, refTaskId);
          }
        }
      }
    }
  }

  /**
   * Detect cycles in the graph using DFS
   * @returns {Object} { hasCycle: boolean, path: array (if cycle found) }
   */
  detectCycles() {
    const visited = new Set();
    const recursionStack = new Set();
    const path = [];

    for (const taskId of this.nodes.keys()) {
      if (!visited.has(taskId)) {
        const result = this._dfsDetectCycle(taskId, visited, recursionStack, path);
        if (result.hasCycle) {
          return result;
        }
      }
    }

    return { hasCycle: false, path: [] };
  }

  /**
   * DFS helper for cycle detection
   */
  _dfsDetectCycle(taskId, visited, recursionStack, path) {
    visited.add(taskId);
    recursionStack.add(taskId);
    path.push(taskId);

    const dependents = this.edges.get(taskId) || new Set();

    for (const depId of dependents) {
      if (!visited.has(depId)) {
        const result = this._dfsDetectCycle(depId, visited, recursionStack, path);
        if (result.hasCycle) {
          return result;
        }
      } else if (recursionStack.has(depId)) {
        // Found a cycle
        const cycleStart = path.indexOf(depId);
        const cyclePath = [...path.slice(cycleStart), depId];
        return {
          hasCycle: true,
          path: cyclePath,
          message: `Cycle detected: ${cyclePath.join(' -> ')}`,
        };
      }
    }

    path.pop();
    recursionStack.delete(taskId);

    return { hasCycle: false };
  }

  /**
   * Topological sort - returns tasks in execution order
   * @returns {Array} Ordered tasks
   * @throws Error if cycle is detected
   */
  topologicalSort() {
    // First check for cycles
    const cycleCheck = this.detectCycles();
    if (cycleCheck.hasCycle) {
      const error = new Error(`Cannot order tasks: ${cycleCheck.message}`);
      error.code = 'CYCLE_DETECTED';
      error.path = cycleCheck.path;
      throw error;
    }

    const result = [];
    const visited = new Set();
    const temp = new Set();

    const visit = (taskId) => {
      if (visited.has(taskId)) return;
      if (temp.has(taskId)) {
        // This shouldn't happen if cycleCheck passed, but safety first
        throw new Error(`Unexpected cycle at ${taskId}`);
      }

      temp.add(taskId);

      // Visit all dependencies first
      const deps = this.reverseEdges.get(taskId) || new Set();
      for (const depId of deps) {
        visit(depId);
      }

      temp.delete(taskId);
      visited.add(taskId);
      result.push(taskId);
    };

    for (const taskId of this.nodes.keys()) {
      visit(taskId);
    }

    // Convert IDs to tasks
    return result.map(id => this.nodes.get(id));
  }

  /**
   * Get tasks that can run in parallel (no dependencies on each other)
   * @returns {Array<Array>} Groups of tasks that can run in parallel
   */
  getParallelGroups() {
    const sorted = this.topologicalSort();
    const groups = [];
    const taskLevels = new Map();

    for (const task of sorted) {
      const deps = this.reverseEdges.get(task.id) || new Set();

      if (deps.size === 0) {
        taskLevels.set(task.id, 0);
      } else {
        let maxDepLevel = -1;
        for (const depId of deps) {
          const depLevel = taskLevels.get(depId) ?? -1;
          maxDepLevel = Math.max(maxDepLevel, depLevel);
        }
        taskLevels.set(task.id, maxDepLevel + 1);
      }
    }

    // Group by level
    const levelGroups = new Map();
    for (const task of sorted) {
      const level = taskLevels.get(task.id);
      if (!levelGroups.has(level)) {
        levelGroups.set(level, []);
      }
      levelGroups.get(level).push(task);
    }

    // Convert to array ordered by level
    const maxLevel = Math.max(...levelGroups.keys());
    for (let i = 0; i <= maxLevel; i++) {
      if (levelGroups.has(i)) {
        groups.push(levelGroups.get(i));
      }
    }

    return groups;
  }

  /**
   * Validate that all dependencies exist
   * @returns {Object} { valid: boolean, missingDeps: array }
   */
  validateDependencies() {
    const missingDeps = [];

    for (const [taskId, deps] of this.reverseEdges) {
      for (const depId of deps) {
        if (!this.nodes.has(depId)) {
          missingDeps.push({
            taskId,
            missingDepId: depId,
          });
        }
      }
    }

    return {
      valid: missingDeps.length === 0,
      missingDeps,
    };
  }

  /**
   * Get task by ID
   */
  getTask(taskId) {
    return this.nodes.get(taskId);
  }

  /**
   * Get all tasks
   */
  getAllTasks() {
    return Array.from(this.nodes.values());
  }

  /**
   * Get dependencies for a task
   */
  getDependencies(taskId) {
    return Array.from(this.reverseEdges.get(taskId) || []);
  }

  /**
   * Get dependents of a task (tasks that depend on it)
   */
  getDependents(taskId) {
    return Array.from(this.edges.get(taskId) || []);
  }

  /**
   * Check if task is ready to execute (all deps completed)
   * @param {string} taskId
   * @param {Set} completedTaskIds
   */
  isReady(taskId, completedTaskIds) {
    const deps = this.reverseEdges.get(taskId) || new Set();
    for (const depId of deps) {
      if (!completedTaskIds.has(depId)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get tasks that are ready to execute
   * @param {Set} completedTaskIds
   * @param {Set} inProgressTaskIds
   */
  getReadyTasks(completedTaskIds, inProgressTaskIds = new Set()) {
    const ready = [];

    for (const taskId of this.nodes.keys()) {
      if (completedTaskIds.has(taskId)) continue;
      if (inProgressTaskIds.has(taskId)) continue;
      if (this.isReady(taskId, completedTaskIds)) {
        ready.push(this.nodes.get(taskId));
      }
    }

    return ready;
  }

  /**
   * Create from array of tasks
   */
  static fromTasks(tasks) {
    const graph = new TaskGraph();
    for (const task of tasks) {
      graph.addTask(task);
    }
    return graph;
  }

  /**
   * Get graph statistics
   */
  getStats() {
    let totalEdges = 0;
    for (const deps of this.reverseEdges.values()) {
      totalEdges += deps.size;
    }

    return {
      nodeCount: this.nodes.size,
      edgeCount: totalEdges,
      maxDepth: this._calculateMaxDepth(),
    };
  }

  /**
   * Calculate maximum depth of the graph
   */
  _calculateMaxDepth() {
    const depths = new Map();

    const getDepth = (taskId) => {
      if (depths.has(taskId)) return depths.get(taskId);

      const deps = this.reverseEdges.get(taskId) || new Set();
      if (deps.size === 0) {
        depths.set(taskId, 0);
        return 0;
      }

      let maxDepth = 0;
      for (const depId of deps) {
        maxDepth = Math.max(maxDepth, getDepth(depId) + 1);
      }

      depths.set(taskId, maxDepth);
      return maxDepth;
    };

    let maxDepth = 0;
    for (const taskId of this.nodes.keys()) {
      maxDepth = Math.max(maxDepth, getDepth(taskId));
    }

    return maxDepth;
  }
}

module.exports = { TaskGraph };
