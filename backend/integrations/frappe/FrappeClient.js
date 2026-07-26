/**
 * FrappeClient - Per-user API client for Frappe/ERPNext
 *
 * This client:
 * - Uses per-user credentials from FrappeConnectionManager
 * - Executes CRUD operations on any DocType
 * - Integrates with the orchestration layer (ExecutorV2)
 * - Provides consistent response formatting
 */

const fetch = require('node-fetch');
const crypto = require('crypto');
const { frappeConnectionManager } = require('./FrappeConnectionManager');
const { frappeSchemaService } = require('./FrappeSchemaService');

// Retry configuration for transient errors
const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

class FrappeClient {
  constructor(userId, connectionName = 'Default ERPNext') {
    this.userId = userId;
    this.connectionName = connectionName;
    this.credentials = null;
  }

  /**
   * Initialize the client by loading credentials
   */
  async init() {
    this.credentials = await frappeConnectionManager.getCredentials(
      this.userId,
      this.connectionName
    );

    if (!this.credentials) {
      throw new Error('No active Frappe connection found. Please connect your ERPNext instance.');
    }

    return this;
  }

  /**
   * Get auth headers
   */
  getHeaders() {
    return {
      'Authorization': `token ${this.credentials.apiKey}:${this.credentials.apiSecret}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
  }

  /**
   * Make an API request to ERPNext with AbortController timeout and retry logic
   */
  async request(method, endpoint, body = null, options = {}) {
    const url = `${this.credentials.baseUrl}${endpoint}`;
    const timeoutMs = options.timeout || 30000;
    const maxRetries = options.retries ?? MAX_RETRIES;

    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const startTime = Date.now();

      // Use AbortController for proper timeout handling (Node 18+ compatible)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const fetchOptions = {
        method,
        headers: this.getHeaders(),
        signal: controller.signal
      };

      if (body && (method === 'POST' || method === 'PUT')) {
        fetchOptions.body = JSON.stringify(body);
      }

      try {
        const response = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        const durationMs = Date.now() - startTime;

        // Check for retryable status codes
        if (RETRYABLE_STATUS_CODES.includes(response.status) && attempt < maxRetries) {
          const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 500;
          console.log(`[FrappeClient] Retrying request (${response.status}), attempt ${attempt + 1}/${maxRetries}, delay ${delay}ms`);
          await this._sleep(delay);
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          let errorMessage = `Frappe API error: ${response.status}`;

          try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.exc_type) {
              errorMessage = `${errorJson.exc_type}: ${errorJson._server_messages || errorJson.message || errorText}`;
            } else if (errorJson.message) {
              errorMessage = errorJson.message;
            }
          } catch {
            errorMessage = `${response.status}: ${errorText.substring(0, 200)}`;
          }

          // Update connection status on auth errors
          if (response.status === 401 || response.status === 403) {
            await frappeConnectionManager.updateConnectionStatus(
              this.credentials.connectionId,
              { success: false, error: 'Authentication failed' }
            );
          }

          throw new Error(errorMessage);
        }

        const data = await response.json();

        // Update successful request stats
        await frappeConnectionManager.updateConnectionStatus(
          this.credentials.connectionId,
          { success: true }
        );

        return {
          success: true,
          data: data.data || data.message || data,
          duration: durationMs
        };
      } catch (error) {
        clearTimeout(timeoutId);

        // Handle AbortController timeout
        if (error.name === 'AbortError') {
          lastError = new Error('Request timed out. Please try again.');
          if (attempt < maxRetries) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempt);
            console.log(`[FrappeClient] Request timed out, retrying (${attempt + 1}/${maxRetries}), delay ${delay}ms`);
            await this._sleep(delay);
            continue;
          }
        } else if (error.code === 'ETIMEDOUT' || error.type === 'request-timeout') {
          lastError = new Error('Request timed out. Please try again.');
          if (attempt < maxRetries) {
            await this._sleep(BASE_DELAY_MS * Math.pow(2, attempt));
            continue;
          }
        } else {
          throw error;
        }
      }
    }

    throw lastError || new Error('Request failed after retries');
  }

  /**
   * Sleep helper for retry delays
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute a Frappe action (main entry point for orchestration)
   * Compatible with ExecutorV2's expected interface
   * Supports idempotency for safe Temporal retries
   */
  async execute({ actionName, params, idempotencyKey = null }) {
    const startTime = Date.now();

    // Initialize if not already done
    if (!this.credentials) {
      await this.init();
    }

    // Check idempotency for mutating operations to prevent duplicates
    if (idempotencyKey && this._isMutatingAction(actionName)) {
      const previousResult = await this._checkIdempotency(idempotencyKey, actionName, params);
      if (previousResult) {
        console.log(`[FrappeClient] Idempotency hit for ${actionName}, returning cached result`);
        return previousResult;
      }
    }

    console.log(`[FrappeClient] Executing: ${actionName}`, params);

    try {
      // Parse action name to determine operation
      // Format: FRAPPE_OPERATION_DOCTYPE or FRAPPE_GENERIC_OPERATION
      const result = await this.routeAction(actionName, params);

      // Log execution (also serves as idempotency record)
      await frappeConnectionManager.logExecution(
        this.credentials.connectionId,
        this.userId,
        {
          actionName,
          doctype: result.doctype || params.doctype,
          documentName: result.name || result.data?.name,
          requestParams: params,
          responseData: result.data,
          status: 'success',
          durationMs: Date.now() - startTime,
          idempotencyKey: idempotencyKey || null
        }
      );

      return {
        success: true,
        data: result.data,
        message: result.message,
        service: 'FRAPPE',
        action: actionName,
        doctype: result.doctype,
        duration: Date.now() - startTime
      };
    } catch (error) {
      // Log error
      await frappeConnectionManager.logExecution(
        this.credentials.connectionId,
        this.userId,
        {
          actionName,
          doctype: params.doctype,
          requestParams: params,
          status: 'error',
          errorMessage: error.message,
          durationMs: Date.now() - startTime,
          idempotencyKey: idempotencyKey || null
        }
      );

      return {
        success: false,
        error: error.message,
        service: 'FRAPPE',
        action: actionName,
        duration: Date.now() - startTime
      };
    }
  }

  /**
   * Check if an action is mutating (create/update/delete/submit)
   */
  _isMutatingAction(actionName) {
    const mutatingPatterns = ['CREATE', 'UPDATE', 'DELETE', 'SUBMIT', 'CANCEL'];
    return mutatingPatterns.some(p => actionName.toUpperCase().includes(p));
  }

  /**
   * Check for previous execution with same idempotency key
   * Returns cached result if found, null otherwise
   */
  async _checkIdempotency(idempotencyKey, actionName, params) {
    try {
      // Use a hash of key + action + params for uniqueness
      const hash = crypto.createHash('sha256')
        .update(`${idempotencyKey}:${actionName}:${JSON.stringify(params)}`)
        .digest('hex');

      // Check recent execution logs (within last hour) for matching idempotency
      const logs = await frappeConnectionManager.getExecutionLogs(this.userId, {
        limit: 50,
        connectionId: this.credentials.connectionId
      });

      // Look for a successful execution with matching action in recent logs
      // Since execution_log doesn't have idempotency_key column, we match by action+params within timeframe
      for (const log of logs) {
        if (log.action_name === actionName && log.status === 'success') {
          const logParamsStr = JSON.stringify(log.request_params || {});
          const paramsStr = JSON.stringify(params || {});
          if (logParamsStr === paramsStr) {
            // Found a recent identical successful execution
            const ageMs = Date.now() - new Date(log.executed_at).getTime();
            if (ageMs < 60 * 60 * 1000) { // Within 1 hour
              return {
                success: true,
                data: log.response_data,
                message: 'Retrieved from idempotency cache',
                service: 'FRAPPE',
                action: actionName,
                cached: true
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn('[FrappeClient] Idempotency check failed:', err.message);
    }
    return null;
  }

  /**
   * Route action to appropriate handler
   */
  async routeAction(actionName, params) {
    // Handle generic operations
    if (actionName === 'FRAPPE_LIST_DOCUMENTS') {
      return this.listDocuments(params);
    }
    if (actionName === 'FRAPPE_GET_DOCUMENT') {
      return this.getDocument(params);
    }
    if (actionName === 'FRAPPE_CREATE_DOCUMENT') {
      return this.createDocument(params);
    }
    if (actionName === 'FRAPPE_UPDATE_DOCUMENT') {
      return this.updateDocument(params);
    }
    if (actionName === 'FRAPPE_DELETE_DOCUMENT') {
      return this.deleteDocument(params);
    }
    if (actionName === 'FRAPPE_CALL_METHOD') {
      return this.callMethod(params);
    }

    // Parse DocType-specific actions
    // Format: FRAPPE_OPERATION_DOCTYPENAME
    const match = actionName.match(/^FRAPPE_(LIST|GET|CREATE|UPDATE|DELETE)_(.+)$/);
    if (match) {
      const operation = match[1].toLowerCase();
      const docTypeSafe = match[2];

      // Convert back to proper DocType name (SALES_ORDER -> Sales Order)
      const docType = this.safeToDoctypeName(docTypeSafe);

      switch (operation) {
        case 'list':
          return this.listDocuments({ ...params, doctype: docType });
        case 'get':
          // Map doctype-specific fields to 'name' if 'name' is not provided
          const getName = this._resolveNameField(docType, params);
          return this.getDocument({ ...params, doctype: docType, name: getName || params.name });
        case 'create':
          return this.createDocument({ doctype: docType, data: params });
        case 'update':
          const updateName = this._resolveNameField(docType, params);
          return this.updateDocument({ ...params, doctype: docType, name: updateName || params.name });
        case 'delete':
          const deleteName = this._resolveNameField(docType, params);
          return this.deleteDocument({ ...params, doctype: docType, name: deleteName || params.name });
      }
    }

    throw new Error(`Unknown Frappe action: ${actionName}`);
  }

  /**
   * Convert safe name back to DocType name
   * SALES_ORDER -> Sales Order
   * CUSTOMER -> Customer
   * CUSTOMERS -> Customer (plural action names map to singular DocTypes)
   */
  safeToDoctypeName(safeName) {
    // Common mappings - includes both singular and plural forms
    // CRITICAL: Action names like FRAPPE_LIST_CUSTOMERS use plural, but Frappe DocTypes are singular
    const mappings = {
      // Plural to singular mappings (action names often use plural)
      'CUSTOMERS': 'Customer',
      'ITEMS': 'Item',
      'SUPPLIERS': 'Supplier',
      'EMPLOYEES': 'Employee',
      'TASKS': 'Task',
      'PROJECTS': 'Project',
      'SALES_ORDERS': 'Sales Order',
      'SALES_INVOICES': 'Sales Invoice',
      'PURCHASE_ORDERS': 'Purchase Order',
      'PURCHASE_INVOICES': 'Purchase Invoice',
      'LEAVE_APPLICATIONS': 'Leave Application',
      // Singular mappings (keep existing)
      'CUSTOMER': 'Customer',
      'ITEM': 'Item',
      'SUPPLIER': 'Supplier',
      'EMPLOYEE': 'Employee',
      'TASK': 'Task',
      'PROJECT': 'Project',
      'SALES_ORDER': 'Sales Order',
      'SALES_INVOICE': 'Sales Invoice',
      'PURCHASE_ORDER': 'Purchase Order',
      'PURCHASE_INVOICE': 'Purchase Invoice',
      'DELIVERY_NOTE': 'Delivery Note',
      'PURCHASE_RECEIPT': 'Purchase Receipt',
      'STOCK_ENTRY': 'Stock Entry',
      'MATERIAL_REQUEST': 'Material Request',
      'LEAVE_APPLICATION': 'Leave Application',
      'SALARY_SLIP': 'Salary Slip',
      'JOURNAL_ENTRY': 'Journal Entry',
      'PAYMENT_ENTRY': 'Payment Entry',
      'WORK_ORDER': 'Work Order',
      'WARRANTY_CLAIM': 'Warranty Claim'
    };

    if (mappings[safeName]) {
      return mappings[safeName];
    }

    // Handle common plural patterns: remove trailing 'S' if it's a plural form
    // e.g., INVOICES -> Invoice, ORDERS -> Order
    if (safeName.endsWith('S') && safeName.length > 1) {
      const singular = safeName.slice(0, -1);
      if (mappings[singular]) {
        return mappings[singular];
      }
    }

    // Default: capitalize each word
    return safeName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Resolve the 'name' field from doctype-specific params
   * Maps customer → name for Customer, item_code → name for Item, etc.
   */
  _resolveNameField(doctype, params) {
    if (params.name) return params.name;

    // Map doctype to its primary identifier field
    const fieldMappings = {
      'Customer': ['customer', 'customer_name'],
      'Item': ['item_code', 'item_name'],
      'Supplier': ['supplier', 'supplier_name'],
      'Employee': ['employee', 'employee_name'],
      'Sales Invoice': ['invoice_name', 'invoice'],
      'Purchase Invoice': ['invoice_name', 'invoice'],
      'Sales Order': ['order_name', 'order'],
      'Purchase Order': ['order_name', 'order'],
      'Project': ['project', 'project_name'],
    };

    const candidates = fieldMappings[doctype] || [];
    for (const field of candidates) {
      if (params[field]) {
        return params[field];
      }
    }

    return null;
  }

  // ============= CRUD Operations =============

  /**
   * List documents
   */
  async listDocuments(params) {
    const { doctype, filters, fields, limit = 20, order_by, limit_start = 0 } = params;

    if (!doctype) {
      throw new Error('doctype is required');
    }

    let endpoint = `/api/resource/${encodeURIComponent(doctype)}?limit_page_length=${limit}&limit_start=${limit_start}`;

    if (filters) {
      const filterArray = Object.entries(filters).map(([k, v]) => `["${k}","=","${v}"]`);
      endpoint += `&filters=[${filterArray.join(',')}]`;
    }

    if (fields && Array.isArray(fields)) {
      endpoint += `&fields=${JSON.stringify(fields)}`;
    }

    if (order_by) {
      endpoint += `&order_by=${encodeURIComponent(order_by)}`;
    } else {
      endpoint += `&order_by=modified desc`;
    }

    const result = await this.request('GET', endpoint);

    // Debug logging for customer list troubleshooting
    console.log(`[FrappeClient] listDocuments(${doctype}): endpoint = ${endpoint}`);
    console.log(`[FrappeClient] listDocuments(${doctype}): returned ${result.data?.length || 0} items`);
    if (result.data && Array.isArray(result.data)) {
      console.log(`[FrappeClient] listDocuments(${doctype}): items =`, result.data.map(d => d.name || d.customer_name || d.id).join(', '));
    }

    return {
      success: true,
      data: result.data,
      doctype,
      count: result.data?.length || 0,
      message: `Found ${result.data?.length || 0} ${doctype} documents`
    };
  }

  /**
   * Get a single document
   */
  async getDocument(params) {
    const { doctype, name } = params;

    if (!doctype || !name) {
      throw new Error('doctype and name are required');
    }

    const endpoint = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const result = await this.request('GET', endpoint);

    return {
      success: true,
      data: result.data,
      doctype,
      name,
      message: `Retrieved ${doctype}: ${name}`
    };
  }

  /**
   * Create a document
   * @param {Object} params - { doctype, data, submit_after_create }
   */
  async createDocument(params) {
    const { doctype, data, submit_after_create } = params;

    if (!doctype) {
      throw new Error('doctype is required');
    }

    // Preprocess data for child tables (items, taxes, etc.)
    const processedData = this._preprocessForChildTables(doctype, data || params);

    const endpoint = `/api/resource/${encodeURIComponent(doctype)}`;
    const result = await this.request('POST', endpoint, processedData);

    const createdName = result.data?.name || result.data?.id;

    // Check if DocType is submittable using schema service (dynamic) with hardcoded fallback
    let isSubmittable = false;
    try {
      const schema = await frappeSchemaService.getDocTypeSchema(this.userId, doctype, this.connectionName);
      isSubmittable = schema?.metadata?.is_submittable === true;
    } catch (schemaErr) {
      // Fallback to hardcoded list if schema fetch fails
      const submittableFallback = [
        'Sales Invoice', 'Purchase Invoice', 'Sales Order', 'Purchase Order',
        'Delivery Note', 'Purchase Receipt', 'Stock Entry', 'Journal Entry',
        'Payment Entry', 'Material Request'
      ];
      isSubmittable = submittableFallback.includes(doctype);
      console.warn(`[FrappeClient] Schema lookup failed, using fallback:`, schemaErr.message);
    }

    // Auto-submit if requested or if it's a submittable doctype and user didn't explicitly say draft
    const shouldSubmit = submit_after_create === true ||
      (isSubmittable && submit_after_create !== false);

    if (shouldSubmit && createdName) {
      try {
        await this.submitDocument({ doctype, name: createdName });
        // Add small delay to allow ERPNext database to commit
        await this._sleep(500);
        return {
          success: true,
          data: result.data,
          doctype,
          name: createdName,
          status: 'Submitted',
          message: `Created and submitted ${doctype}: ${createdName}`
        };
      } catch (submitErr) {
        console.warn(`[FrappeClient] Created ${createdName} but submit failed:`, submitErr.message);
        return {
          success: true,
          data: result.data,
          doctype,
          name: createdName,
          status: 'Draft',
          message: `Created ${doctype}: ${createdName} (submit failed: ${submitErr.message})`
        };
      }
    }

    // Add small delay to allow ERPNext database to commit before subsequent list operations
    // This prevents race conditions where LIST runs before CREATE is fully committed
    await this._sleep(500);

    return {
      success: true,
      data: result.data,
      doctype,
      name: createdName,
      status: 'Draft',
      message: `Created ${doctype}: ${createdName}`
    };
  }

  /**
   * Submit a document (change docstatus from 0 to 1)
   */
  async submitDocument(params) {
    const { doctype, name } = params;

    if (!doctype || !name) {
      throw new Error('doctype and name are required for submit');
    }

    // Use Frappe's document submit method
    const endpoint = `/api/method/frappe.client.submit`;
    const result = await this.request('POST', endpoint, {
      doc: { doctype, name }
    });

    return {
      success: true,
      data: result,
      doctype,
      name,
      status: 'Submitted',
      message: `Submitted ${doctype}: ${name}`
    };
  }

  /**
   * Preprocess params for Frappe child tables
   * Converts string items to proper child table objects
   */
  _preprocessForChildTables(doctype, data) {
    const processed = { ...data };

    // Handle items array (Sales Invoice, Sales Order, Purchase Order, etc.)
    if (processed.items && Array.isArray(processed.items)) {
      processed.items = processed.items.map(item => {
        // If already an object, just ensure required fields
        if (typeof item === 'object' && item !== null) {
          return {
            item_code: item.item_code || item.item_name || item.name,
            qty: item.qty || item.quantity || 1,
            rate: item.rate || item.price || 0,
            ...item
          };
        }
        // If string, convert to minimal child table object
        if (typeof item === 'string') {
          return {
            item_code: item,
            qty: 1
            // rate will be fetched from Item master by ERPNext
          };
        }
        return item;
      });
    }

    // Handle taxes (child table)
    if (processed.taxes && Array.isArray(processed.taxes)) {
      processed.taxes = processed.taxes.map(tax => {
        if (typeof tax === 'string') {
          return { charge_type: 'On Net Total', account_head: tax };
        }
        return tax;
      });
    }

    // Remove fields that should be auto-determined by ERPNext
    // These can cause validation errors if they don't match the actual ERPNext configuration
    const autoFields = [
      'doctype',       // Already passed separately
      'Start',         // Calendar fields
      'End',
      'debit_to',      // Auto-determined from customer/company
      'credit_to',     // Auto-determined from supplier/company
      'posting_time',  // Auto-set by ERPNext
      'naming_series', // Auto-set by ERPNext based on settings
      'conversion_rate', // Auto-calculated from currency
      'base_grand_total', // Calculated field
      'base_net_total',   // Calculated field
      'grand_total',      // Calculated field
      'net_total',        // Calculated field
      'total_taxes_and_charges', // Calculated field
      'base_total_taxes_and_charges', // Calculated field
      'selling_price_list', // Use ERPNext default
      'buying_price_list',  // Use ERPNext default
      'price_list_currency', // Auto-set from price list
    ];

    for (const field of autoFields) {
      delete processed[field];
    }

    // If company is 'Company' (default placeholder), remove it to let ERPNext use actual default
    if (processed.company === 'Company') {
      delete processed.company;
    }

    // If currency is default placeholder, remove to use company default
    if (!processed.currency || processed.currency === 'USD') {
      delete processed.currency;
    }

    return processed;
  }

  /**
   * Update a document
   */
  async updateDocument(params) {
    const { doctype, name, data, ...updateFields } = params;

    if (!doctype || !name) {
      throw new Error('doctype and name are required');
    }

    const endpoint = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    const updateData = data || updateFields;

    const result = await this.request('PUT', endpoint, updateData);

    return {
      success: true,
      data: result.data,
      doctype,
      name,
      message: `Updated ${doctype}: ${name}`
    };
  }

  /**
   * Delete a document
   */
  async deleteDocument(params) {
    const { doctype, name } = params;

    if (!doctype || !name) {
      throw new Error('doctype and name are required');
    }

    const endpoint = `/api/resource/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`;
    await this.request('DELETE', endpoint);

    return {
      success: true,
      doctype,
      name,
      message: `Deleted ${doctype}: ${name}`
    };
  }

  /**
   * Call a Frappe method
   */
  async callMethod(params) {
    const { method, args = {} } = params;

    if (!method) {
      throw new Error('method is required');
    }

    const endpoint = `/api/method/${method}`;
    const result = await this.request('POST', endpoint, args);

    return {
      success: true,
      data: result.data,
      method,
      message: `Called method: ${method}`
    };
  }

  // ============= Convenience Methods =============

  /**
   * Search documents
   */
  async searchDocuments(doctype, searchTerm, { fields = ['name'], limit = 20 } = {}) {
    const filters = {};
    // Search in name field by default
    // Frappe uses 'like' operator with %
    const endpoint = `/api/resource/${encodeURIComponent(doctype)}?limit_page_length=${limit}&filters=[["name","like","%${searchTerm}%"]]`;

    const result = await this.request('GET', endpoint);
    return result.data;
  }

  /**
   * Get document count
   */
  async getCount(doctype, filters = {}) {
    const result = await this.callMethod({
      method: 'frappe.client.get_count',
      args: { doctype, filters }
    });
    return result.data;
  }

  /**
   * Check if document exists
   */
  async exists(doctype, name) {
    try {
      await this.getDocument({ doctype, name });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get linked documents
   */
  async getLinkedDocuments(doctype, name, linkDoctype) {
    return this.listDocuments({
      doctype: linkDoctype,
      filters: { [doctype.toLowerCase().replace(' ', '_')]: name }
    });
  }
}

/**
 * Factory function to create initialized FrappeClient
 */
async function createFrappeClient(userId, connectionName = 'Default ERPNext') {
  const client = new FrappeClient(userId, connectionName);
  await client.init();
  return client;
}

/**
 * Execute a Frappe action for a user (convenience function)
 * This is the main entry point for ExecutorV2
 */
async function executeFrappeAction(userId, actionName, params, connectionName = 'Default ERPNext') {
  const client = new FrappeClient(userId, connectionName);
  await client.init();
  return client.execute({ actionName, params });
}

module.exports = {
  FrappeClient,
  createFrappeClient,
  executeFrappeAction
};
