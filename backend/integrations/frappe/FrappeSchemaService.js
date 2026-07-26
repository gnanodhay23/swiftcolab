/**
 * FrappeSchemaService - Dynamic DocType schema fetching and conversion
 *
 * This service:
 * - Fetches DocType definitions from the user's ERPNext instance
 * - Converts Frappe field definitions to JSON Schema format
 * - Caches schemas in the database for performance
 * - Generates tool definitions for the orchestration layer
 */

const fetch = require('node-fetch');
const { query } = require('../../db');
const { frappeConnectionManager } = require('./FrappeConnectionManager');

// Common DocTypes that are useful for orchestration
const PRIORITY_DOCTYPES = [
  // CRM & Sales
  'Customer', 'Lead', 'Opportunity', 'Quotation', 'Sales Order', 'Sales Invoice',
  // Purchasing
  'Supplier', 'Purchase Order', 'Purchase Invoice', 'Purchase Receipt',
  // Inventory
  'Item', 'Stock Entry', 'Delivery Note', 'Material Request',
  // HR
  'Employee', 'Leave Application', 'Attendance', 'Salary Slip',
  // Projects
  'Project', 'Task', 'Timesheet',
  // Accounting
  'Journal Entry', 'Payment Entry',
  // Manufacturing
  'BOM', 'Work Order',
  // Assets
  'Asset',
  // Support
  'Issue', 'Warranty Claim'
];

// Frappe field type to JSON Schema type mapping
const FIELD_TYPE_MAP = {
  'Data': { type: 'string' },
  'Small Text': { type: 'string' },
  'Text': { type: 'string' },
  'Text Editor': { type: 'string' },
  'Long Text': { type: 'string' },
  'Code': { type: 'string' },
  'HTML': { type: 'string' },
  'HTML Editor': { type: 'string' },
  'Markdown Editor': { type: 'string' },
  'Password': { type: 'string' },
  'Read Only': { type: 'string' },
  'Int': { type: 'integer' },
  'Float': { type: 'number' },
  'Currency': { type: 'number' },
  'Percent': { type: 'number' },
  'Check': { type: 'boolean' },
  'Date': { type: 'string', format: 'date' },
  'Datetime': { type: 'string', format: 'date-time' },
  'Time': { type: 'string', format: 'time' },
  'Duration': { type: 'string' },
  'Link': { type: 'string' }, // Reference to another DocType
  'Dynamic Link': { type: 'string' },
  'Select': { type: 'string' }, // Will add enum
  'Table': { type: 'array' }, // Child table
  'Table MultiSelect': { type: 'array' },
  'Attach': { type: 'string', format: 'uri' },
  'Attach Image': { type: 'string', format: 'uri' },
  'Signature': { type: 'string' },
  'Color': { type: 'string' },
  'Barcode': { type: 'string' },
  'Geolocation': { type: 'string' },
  'JSON': { type: 'object' },
  'Phone': { type: 'string' },
  'Autocomplete': { type: 'string' },
  'Rating': { type: 'number', minimum: 0, maximum: 5 },
};

// Fields to exclude from schema (internal Frappe fields)
const EXCLUDED_FIELDS = [
  'doctype', 'name', 'owner', 'creation', 'modified', 'modified_by',
  'idx', 'docstatus', '_user_tags', '_comments', '_assign', '_liked_by',
  'amended_from', '_seen'
];

class FrappeSchemaService {
  constructor() {
    this.schemaCache = new Map(); // connectionId:doctype -> { schema, expiresAt }
    this.CACHE_TTL = 60 * 60 * 1000; // 1 hour in memory
  }

  /**
   * Get available DocTypes from user's ERPNext
   */
  async listDocTypes(userId, connectionName = 'Default ERPNext', options = {}) {
    const credentials = await frappeConnectionManager.getCredentials(userId, connectionName);
    if (!credentials) {
      throw new Error('No active Frappe connection found');
    }

    const { priorityOnly = false, module = null, limit = 200 } = options;

    let url = `${credentials.baseUrl}/api/resource/DocType?fields=["name","module","modified"]&limit_page_length=${limit}&order_by=modified desc`;

    // Add module filter if specified
    if (module) {
      url += `&filters=[["module","=","${module}"]]`;
    }

    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${credentials.apiKey}:${credentials.apiSecret}`,
        'Accept': 'application/json'
      },
      timeout: 15000
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch DocTypes: ${response.status}`);
    }

    const data = await response.json();
    let docTypes = data.data || [];

    // If priorityOnly, filter to common business DocTypes
    if (priorityOnly) {
      const prioritySet = new Set(PRIORITY_DOCTYPES);
      docTypes = docTypes.filter(dt => prioritySet.has(dt.name));
    }

    return docTypes;
  }

  /**
   * Fetch and convert a DocType definition to JSON Schema
   */
  async getDocTypeSchema(userId, docTypeName, connectionName = 'Default ERPNext') {
    const credentials = await frappeConnectionManager.getCredentials(userId, connectionName);
    if (!credentials) {
      throw new Error('No active Frappe connection found');
    }

    // Check memory cache first
    const cacheKey = `${credentials.connectionId}:${docTypeName}`;
    const cached = this.schemaCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.schema;
    }

    // Check database cache
    const dbCached = await this.getSchemaFromDB(credentials.connectionId, docTypeName);
    if (dbCached) {
      // Update memory cache
      this.schemaCache.set(cacheKey, {
        schema: dbCached,
        expiresAt: Date.now() + this.CACHE_TTL
      });
      return dbCached;
    }

    // Fetch from ERPNext
    const schema = await this.fetchAndConvertSchema(credentials, docTypeName);

    // Save to database cache
    await this.saveSchemaToDb(credentials.connectionId, docTypeName, schema);

    // Update memory cache
    this.schemaCache.set(cacheKey, {
      schema,
      expiresAt: Date.now() + this.CACHE_TTL
    });

    return schema;
  }

  /**
   * Fetch DocType from ERPNext and convert to JSON Schema
   */
  async fetchAndConvertSchema(credentials, docTypeName) {
    const url = `${credentials.baseUrl}/api/resource/DocType/${encodeURIComponent(docTypeName)}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `token ${credentials.apiKey}:${credentials.apiSecret}`,
        'Accept': 'application/json'
      },
      timeout: 10000
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`DocType '${docTypeName}' not found`);
      }
      if (response.status === 403) {
        throw new Error(`No permission to access DocType '${docTypeName}'`);
      }
      throw new Error(`Failed to fetch DocType: ${response.status}`);
    }

    const data = await response.json();
    const docType = data.data;

    // Convert to JSON Schema
    return this.convertToJsonSchema(docType);
  }

  /**
   * Convert Frappe DocType definition to JSON Schema
   */
  convertToJsonSchema(docType) {
    const properties = {};
    const required = [];
    const fieldDefinitions = [];

    const fields = docType.fields || [];

    for (const field of fields) {
      // Skip internal fields and section breaks
      if (EXCLUDED_FIELDS.includes(field.fieldname)) continue;
      if (['Section Break', 'Column Break', 'Tab Break', 'Fold'].includes(field.fieldtype)) continue;

      const fieldSchema = this.convertFieldToSchema(field);
      if (fieldSchema) {
        properties[field.fieldname] = fieldSchema;

        // Track required fields
        if (field.reqd) {
          required.push(field.fieldname);
        }

        // Store field definition for reference
        fieldDefinitions.push({
          fieldname: field.fieldname,
          fieldtype: field.fieldtype,
          label: field.label,
          required: !!field.reqd,
          options: field.options,
          default: field.default,
          description: field.description,
          hidden: !!field.hidden,
          read_only: !!field.read_only
        });
      }
    }

    return {
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'object',
      title: docType.name,
      description: docType.description || `${docType.name} document`,
      properties,
      required,
      metadata: {
        doctype: docType.name,
        module: docType.module,
        is_submittable: !!docType.is_submittable,
        is_child_table: !!docType.istable,
        is_single: !!docType.issingle,
        track_changes: !!docType.track_changes,
        fields: fieldDefinitions
      }
    };
  }

  /**
   * Convert a single Frappe field to JSON Schema property
   */
  convertFieldToSchema(field) {
    const fieldType = field.fieldtype;
    const baseSchema = FIELD_TYPE_MAP[fieldType];

    if (!baseSchema) {
      // Unknown field type, treat as string
      return {
        type: 'string',
        title: field.label || field.fieldname,
        description: field.description
      };
    }

    const schema = { ...baseSchema };

    // Add common properties
    schema.title = field.label || field.fieldname;
    if (field.description) {
      schema.description = field.description;
    }

    // Add default value
    if (field.default !== undefined && field.default !== null && field.default !== '') {
      schema.default = field.default;
    }

    // Handle Select fields (enum)
    if (fieldType === 'Select' && field.options) {
      const options = field.options.split('\n').filter(o => o.trim());
      if (options.length > 0) {
        schema.enum = options;
      }
    }

    // Handle Link fields
    if (fieldType === 'Link' && field.options) {
      schema.description = `${schema.description || ''} (Link to ${field.options})`.trim();
      schema['x-linked-doctype'] = field.options;
    }

    // Handle Table fields
    if (fieldType === 'Table' && field.options) {
      schema.items = { type: 'object' };
      schema['x-child-doctype'] = field.options;
    }

    return schema;
  }

  /**
   * Get schema from database cache
   */
  async getSchemaFromDB(connectionId, docTypeName) {
    const result = await query(
      `SELECT schema, fields, required_fields, cached_at
       FROM frappe_doctype_schemas
       WHERE connection_id = $1 AND doctype_name = $2
       AND cached_at > NOW() - INTERVAL '24 hours'`,
      [connectionId, docTypeName]
    );

    if (result.rows.length > 0) {
      return result.rows[0].schema;
    }
    return null;
  }

  /**
   * Save schema to database cache
   */
  async saveSchemaToDb(connectionId, docTypeName, schema) {
    try {
      await query(
        `INSERT INTO frappe_doctype_schemas
         (connection_id, doctype_name, module, schema, fields, required_fields,
          is_submittable, is_child_table, is_single, track_changes, cached_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (connection_id, doctype_name)
         DO UPDATE SET
           schema = EXCLUDED.schema,
           fields = EXCLUDED.fields,
           required_fields = EXCLUDED.required_fields,
           is_submittable = EXCLUDED.is_submittable,
           is_child_table = EXCLUDED.is_child_table,
           is_single = EXCLUDED.is_single,
           track_changes = EXCLUDED.track_changes,
           cached_at = NOW()`,
        [
          connectionId,
          docTypeName,
          schema.metadata?.module,
          JSON.stringify(schema),
          JSON.stringify(schema.metadata?.fields || []),
          JSON.stringify(schema.required || []),
          schema.metadata?.is_submittable || false,
          schema.metadata?.is_child_table || false,
          schema.metadata?.is_single || false,
          schema.metadata?.track_changes || false
        ]
      );
    } catch (e) {
      console.error('[FrappeSchemaService] Failed to cache schema:', e.message);
    }
  }

  /**
   * Sync schemas for priority DocTypes
   */
  async syncPrioritySchemas(userId, connectionName = 'Default ERPNext') {
    const credentials = await frappeConnectionManager.getCredentials(userId, connectionName);
    if (!credentials) {
      throw new Error('No active Frappe connection found');
    }

    console.log('[FrappeSchemaService] Syncing priority DocType schemas...');

    const results = { success: [], failed: [] };

    for (const docTypeName of PRIORITY_DOCTYPES) {
      try {
        await this.getDocTypeSchema(userId, docTypeName, connectionName);
        results.success.push(docTypeName);
      } catch (e) {
        // DocType might not exist in this ERPNext instance
        results.failed.push({ doctype: docTypeName, error: e.message });
      }
    }

    // Update connection's schema cache timestamp
    await query(
      `UPDATE frappe_connections
       SET schema_cached_at = NOW()
       WHERE id = $1`,
      [credentials.connectionId]
    );

    console.log(`[FrappeSchemaService] Synced ${results.success.length} schemas, ${results.failed.length} failed`);
    return results;
  }

  /**
   * Generate tool actions for a DocType
   * Returns action definitions compatible with the orchestration layer
   */
  generateToolActions(docTypeName, schema) {
    const safeName = docTypeName.toUpperCase().replace(/\s+/g, '_');

    return {
      [`FRAPPE_LIST_${safeName}`]: {
        name: `FRAPPE_LIST_${safeName}`,
        description: `List ${docTypeName} documents from ERPNext`,
        doctype: docTypeName,
        operation: 'list',
        parameters: {
          type: 'object',
          properties: {
            limit: {
              type: 'integer',
              description: 'Maximum number of documents to return',
              default: 20
            },
            filters: {
              type: 'object',
              description: 'Filter conditions as key-value pairs'
            },
            fields: {
              type: 'array',
              items: { type: 'string' },
              description: 'Fields to include in response'
            },
            order_by: {
              type: 'string',
              description: 'Sort order (e.g., "creation desc")',
              default: 'modified desc'
            }
          },
          required: []
        }
      },

      [`FRAPPE_GET_${safeName}`]: {
        name: `FRAPPE_GET_${safeName}`,
        description: `Get a specific ${docTypeName} document by name`,
        doctype: docTypeName,
        operation: 'get',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: `The name/ID of the ${docTypeName} to retrieve`
            }
          },
          required: ['name']
        }
      },

      [`FRAPPE_CREATE_${safeName}`]: {
        name: `FRAPPE_CREATE_${safeName}`,
        description: `Create a new ${docTypeName} document`,
        doctype: docTypeName,
        operation: 'create',
        parameters: schema // Use full schema
      },

      [`FRAPPE_UPDATE_${safeName}`]: {
        name: `FRAPPE_UPDATE_${safeName}`,
        description: `Update an existing ${docTypeName} document`,
        doctype: docTypeName,
        operation: 'update',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: `The name/ID of the ${docTypeName} to update`
            },
            ...schema.properties
          },
          required: ['name']
        }
      },

      [`FRAPPE_DELETE_${safeName}`]: {
        name: `FRAPPE_DELETE_${safeName}`,
        description: `Delete a ${docTypeName} document`,
        doctype: docTypeName,
        operation: 'delete',
        parameters: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: `The name/ID of the ${docTypeName} to delete`
            }
          },
          required: ['name']
        }
      }
    };
  }

  /**
   * Get all available Frappe tools for a user
   * This returns tool definitions for the ToolRouter
   */
  async getAvailableTools(userId, connectionName = 'Default ERPNext') {
    const hasConnection = await frappeConnectionManager.hasActiveConnection(userId, connectionName);
    if (!hasConnection) {
      return [];
    }

    // Get cached schemas from database
    const credentials = await frappeConnectionManager.getCredentials(userId, connectionName);
    const result = await query(
      `SELECT doctype_name, schema FROM frappe_doctype_schemas
       WHERE connection_id = $1`,
      [credentials.connectionId]
    );

    const tools = [];

    for (const row of result.rows) {
      const schema = row.schema;
      const actions = this.generateToolActions(row.doctype_name, schema);

      for (const action of Object.values(actions)) {
        tools.push({
          name: action.name,
          description: action.description,
          parameters: action.parameters,
          toolkit: 'FRAPPE',
          doctype: action.doctype,
          operation: action.operation
        });
      }
    }

    // Add generic operations if no specific schemas cached
    if (tools.length === 0) {
      tools.push(
        {
          name: 'FRAPPE_LIST_DOCUMENTS',
          description: 'List documents of any DocType with filters',
          toolkit: 'FRAPPE',
          operation: 'list',
          parameters: {
            type: 'object',
            properties: {
              doctype: { type: 'string', description: 'The DocType to list' },
              filters: { type: 'object', description: 'Filter conditions' },
              fields: { type: 'array', items: { type: 'string' } },
              limit: { type: 'integer', default: 20 }
            },
            required: ['doctype']
          }
        },
        {
          name: 'FRAPPE_GET_DOCUMENT',
          description: 'Get a document by DocType and name',
          toolkit: 'FRAPPE',
          operation: 'get',
          parameters: {
            type: 'object',
            properties: {
              doctype: { type: 'string' },
              name: { type: 'string' }
            },
            required: ['doctype', 'name']
          }
        },
        {
          name: 'FRAPPE_CREATE_DOCUMENT',
          description: 'Create a document of any DocType',
          toolkit: 'FRAPPE',
          operation: 'create',
          parameters: {
            type: 'object',
            properties: {
              doctype: { type: 'string' },
              data: { type: 'object' }
            },
            required: ['doctype', 'data']
          }
        }
      );
    }

    return tools;
  }

  /**
   * Clear cached schemas for a connection
   */
  async clearSchemaCache(connectionId) {
    // Clear memory cache
    for (const key of this.schemaCache.keys()) {
      if (key.startsWith(connectionId)) {
        this.schemaCache.delete(key);
      }
    }

    // Clear database cache
    await query(
      `DELETE FROM frappe_doctype_schemas WHERE connection_id = $1`,
      [connectionId]
    );
  }
}

// Singleton instance
const frappeSchemaService = new FrappeSchemaService();

module.exports = {
  FrappeSchemaService,
  frappeSchemaService,
  PRIORITY_DOCTYPES,
  FIELD_TYPE_MAP
};
