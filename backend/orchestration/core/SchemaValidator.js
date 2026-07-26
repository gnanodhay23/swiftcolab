/**
 * SchemaValidator - Fully Dynamic JSON Schema Validation
 *
 * NO HARDCODED VALIDATION RULES - all validation comes from Composio schemas dynamically.
 *
 * Features:
 * - Ajv validation with all formats
 * - Type coercion for flexible input handling
 * - Dynamic schema fetching via SchemaFetcher
 * - Detailed error messages generated from schema descriptions
 * - Schema caching via SchemaFetcher
 *
 * Methods:
 * - validateTask(task) - Validate a task against its dynamically fetched schema
 * - getMissingRequiredFields(actionName, providedParams) - Get missing required fields
 * - validate(data, schema) - Validate data against a provided schema
 */

const Ajv = require('ajv');
const addFormats = require('ajv-formats');

class SchemaValidator {
  /**
   * @param {SchemaFetcher} schemaFetcher - Optional SchemaFetcher instance for dynamic schema lookup
   */
  constructor(schemaFetcher = null) {
    this.schemaFetcher = schemaFetcher;

    // Initialize Ajv with optimal settings for API validation
    this.ajv = new Ajv({
      allErrors: true, // Report all errors, not just first
      strict: false, // Allow additional properties by default
      coerceTypes: true, // Coerce types automatically
      useDefaults: true, // Apply default values
      removeAdditional: false, // Keep extra properties
      verbose: true, // Include schema and parent data in errors
    });

    addFormats(this.ajv);

    // Add standard formats only (no app-specific formats)
    this._addStandardFormats();

    // Validator cache for compiled schemas
    this.validatorCache = new Map();
  }

  /**
   * Set the SchemaFetcher instance (for dependency injection)
   * @param {SchemaFetcher} schemaFetcher
   */
  setSchemaFetcher(schemaFetcher) {
    this.schemaFetcher = schemaFetcher;
  }

  /**
   * Add standard formats (no app-specific formats)
   */
  _addStandardFormats() {
    // ISO datetime without milliseconds
    this.ajv.addFormat('composio-datetime', {
      type: 'string',
      validate: (str) => {
        // Accept ISO 8601 with or without milliseconds
        return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(Z|[+-]\d{2}:\d{2})$/.test(str) ||
               /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/.test(str);
      },
    });
  }

  // ===========================================================================
  // PRIMARY VALIDATION METHODS (Dynamic)
  // ===========================================================================

  /**
   * Validate a task against its dynamically fetched schema
   * @param {Object} task - Task object with { action, params }
   * @param {string} entityId - Optional entity ID for user-specific schemas
   * @returns {Promise<Object>} { isValid, missingRequired, typeMismatches, coerced }
   */
  async validateTask(task, entityId = null) {
    if (!task || !task.action) {
      return {
        isValid: false,
        missingRequired: [],
        typeMismatches: [{ field: 'action', message: 'Task action is required' }],
        coerced: task?.params || {},
      };
    }

    // Fetch schema dynamically
    const schema = await this._fetchSchema(task.action, entityId);

    if (!schema) {
      // No schema found - can't validate, assume valid
      console.warn(`[SchemaValidator] No schema found for ${task.action}, skipping validation`);
      return {
        isValid: true,
        missingRequired: [],
        typeMismatches: [],
        coerced: task.params || {},
      };
    }

    // Convert schema to JSON Schema format for Ajv
    const jsonSchema = this._toJsonSchema(schema);
    const params = task.params || {};

    // Validate with Ajv
    const result = this.validate(params, jsonSchema);

    // Categorize errors
    const missingRequired = [];
    const typeMismatches = [];

    for (const error of result.errors) {
      if (error.type === 'required') {
        missingRequired.push({
          field: error.field,
          message: error.message,
          description: error.schema?.description || '',
          type: error.schema?.type || 'string',
          enum: error.schema?.enum || null,
        });
      } else {
        typeMismatches.push({
          field: error.field,
          message: error.message,
          type: error.type,
          value: error.value,
          expected: error.schema?.type,
        });
      }
    }

    return {
      isValid: result.valid,
      missingRequired,
      typeMismatches,
      coerced: result.coerced,
    };
  }

  /**
   * Get missing required fields for an action
   * @param {string} actionName - Action name (e.g., 'GMAIL_SEND_EMAIL')
   * @param {Object} providedParams - Parameters already provided
   * @param {string} entityId - Optional entity ID
   * @returns {Promise<Array>} Array of missing field objects with full schema info
   */
  async getMissingRequiredFields(actionName, providedParams = {}, entityId = null) {
    // Use SchemaFetcher if available
    if (this.schemaFetcher) {
      const result = await this.schemaFetcher.validateRequiredFields(actionName, providedParams, entityId);
      return result.details || [];
    }

    // Fallback: fetch schema and check manually
    const schema = await this._fetchSchema(actionName, entityId);

    if (!schema) {
      return [];
    }

    const required = this._getRequiredFieldNames(schema);
    const missingFields = [];

    for (const fieldName of required) {
      const value = providedParams[fieldName];
      const isMissing = value === undefined || value === null || value === '';

      if (isMissing) {
        const fieldSchema = this._getFieldSchema(schema, fieldName);
        missingFields.push({
          field: fieldName,
          type: fieldSchema?.type || 'string',
          description: fieldSchema?.description || '',
          enum: fieldSchema?.enum || null,
          format: fieldSchema?.format || null,
        });
      }
    }

    return missingFields;
  }

  /**
   * Check if all required fields are provided
   * @param {string} actionName - Action name
   * @param {Object} providedParams - Parameters provided
   * @param {string} entityId - Optional entity ID
   * @returns {Promise<boolean>}
   */
  async hasAllRequiredFields(actionName, providedParams = {}, entityId = null) {
    const missing = await this.getMissingRequiredFields(actionName, providedParams, entityId);
    return missing.length === 0;
  }

  // ===========================================================================
  // CORE VALIDATION (Schema-based)
  // ===========================================================================

  /**
   * Validate data against a schema (Ajv validation)
   * @param {Object} data - Data to validate
   * @param {Object} schema - JSON Schema
   * @returns {Object} { valid: boolean, errors: array, coerced: object }
   */
  validate(data, schema) {
    const cacheKey = JSON.stringify(schema);

    // Get or create validator
    let validate = this.validatorCache.get(cacheKey);
    if (!validate) {
      try {
        validate = this.ajv.compile(schema);
        this.validatorCache.set(cacheKey, validate);
      } catch (error) {
        console.error('[SchemaValidator] Schema compilation error:', error.message);
        return {
          valid: true, // Can't validate, assume valid
          errors: [],
          coerced: data || {},
        };
      }
    }

    // Clone data to avoid mutating original
    const dataCopy = JSON.parse(JSON.stringify(data || {}));

    const valid = validate(dataCopy);

    return {
      valid,
      errors: valid ? [] : this._formatErrors(validate.errors, schema),
      coerced: dataCopy, // Contains coerced values and defaults
    };
  }

  /**
   * Validate and get missing required fields (synchronous, schema provided)
   * @param {Object} data - Data to validate
   * @param {Object} schema - JSON Schema
   * @returns {Object} { valid: boolean, missingFields: array, invalidFields: array, coerced: object }
   */
  validateAndGetMissing(data, schema) {
    const result = this.validate(data, schema);

    const missingFields = [];
    const invalidFields = [];

    for (const error of result.errors) {
      if (error.type === 'required') {
        missingFields.push({
          field: error.field,
          message: error.message,
          schema: error.schema,
        });
      } else {
        invalidFields.push({
          field: error.field,
          message: error.message,
          type: error.type,
          value: error.value,
        });
      }
    }

    return {
      valid: result.valid,
      missingFields,
      invalidFields,
      coerced: result.coerced,
    };
  }

  // ===========================================================================
  // SCHEMA HELPERS
  // ===========================================================================

  /**
   * Fetch schema dynamically using SchemaFetcher
   * @private
   */
  async _fetchSchema(actionName, entityId = null) {
    if (!this.schemaFetcher) {
      console.warn('[SchemaValidator] No SchemaFetcher configured, cannot fetch schema dynamically');
      return null;
    }

    try {
      const schema = await this.schemaFetcher.getSchema(actionName, entityId);
      return schema;
    } catch (error) {
      console.error(`[SchemaValidator] Error fetching schema for ${actionName}:`, error.message);
      return null;
    }
  }

  /**
   * Convert Composio schema format to JSON Schema for Ajv
   * @private
   */
  _toJsonSchema(schema) {
    // If schema already has 'properties' format (legacy), use it directly
    if (schema.properties) {
      return {
        type: 'object',
        properties: schema.properties,
        required: schema.required || [],
        additionalProperties: true,
      };
    }

    // Convert parameters array format to JSON Schema
    const properties = {};
    const required = [];

    const parameters = schema.parameters || [];

    for (const param of parameters) {
      const fieldSchema = {
        type: param.type || 'string',
      };

      if (param.description) {
        fieldSchema.description = param.description;
      }

      if (param.enum && Array.isArray(param.enum)) {
        fieldSchema.enum = param.enum;
      }

      if (param.format) {
        fieldSchema.format = param.format;
      }

      if (param.default !== undefined) {
        fieldSchema.default = param.default;
      }

      if (param.minLength !== undefined) {
        fieldSchema.minLength = param.minLength;
      }

      if (param.maxLength !== undefined) {
        fieldSchema.maxLength = param.maxLength;
      }

      if (param.minimum !== undefined) {
        fieldSchema.minimum = param.minimum;
      }

      if (param.maximum !== undefined) {
        fieldSchema.maximum = param.maximum;
      }

      if (param.pattern) {
        fieldSchema.pattern = param.pattern;
      }

      // Handle array items
      if (param.type === 'array' && param.items) {
        fieldSchema.items = param.items;
      }

      properties[param.name] = fieldSchema;

      if (param.required === true) {
        required.push(param.name);
      }
    }

    return {
      type: 'object',
      properties,
      required,
      additionalProperties: true,
    };
  }

  /**
   * Get required field names from schema
   * @private
   */
  _getRequiredFieldNames(schema) {
    if (schema.required && Array.isArray(schema.required)) {
      return schema.required;
    }

    // Extract from parameters array
    if (schema.parameters && Array.isArray(schema.parameters)) {
      return schema.parameters
        .filter(p => p.required === true)
        .map(p => p.name);
    }

    return [];
  }

  /**
   * Get field schema from Composio schema format
   * @private
   */
  _getFieldSchema(schema, fieldName) {
    // Check properties format
    if (schema.properties && schema.properties[fieldName]) {
      return schema.properties[fieldName];
    }

    // Check parameters array format
    if (schema.parameters && Array.isArray(schema.parameters)) {
      const param = schema.parameters.find(p => p.name === fieldName);
      if (param) {
        return {
          type: param.type || 'string',
          description: param.description || '',
          enum: param.enum || null,
          format: param.format || null,
          default: param.default,
        };
      }
    }

    return null;
  }

  // ===========================================================================
  // ERROR FORMATTING
  // ===========================================================================

  /**
   * Format Ajv errors into user-friendly format
   * @private
   */
  _formatErrors(errors, schema) {
    if (!errors) return [];

    return errors.map(error => {
      const field = error.instancePath.replace(/^\//, '') || error.params?.missingProperty;
      const fieldSchema = schema.properties?.[field];

      return {
        field,
        type: error.keyword,
        message: this._getErrorMessage(error, field, fieldSchema),
        value: error.data,
        schema: fieldSchema,
      };
    });
  }

  /**
   * Generate user-friendly error message dynamically
   * Uses schema description instead of hardcoded friendly names
   * @private
   */
  _getErrorMessage(error, field, fieldSchema) {
    // Generate friendly name from schema description or field name
    const friendlyName = this._getFriendlyFieldName(field, fieldSchema);

    switch (error.keyword) {
      case 'required':
        return `${friendlyName} is required`;

      case 'type':
        const expectedType = error.params.type;
        return `${friendlyName} should be a ${expectedType}`;

      case 'format':
        const format = error.params.format;
        return this._getFormatErrorMessage(friendlyName, format);

      case 'minLength':
        return `${friendlyName} must be at least ${error.params.limit} characters`;

      case 'maxLength':
        return `${friendlyName} cannot exceed ${error.params.limit} characters`;

      case 'minimum':
        return `${friendlyName} must be at least ${error.params.limit}`;

      case 'maximum':
        return `${friendlyName} cannot exceed ${error.params.limit}`;

      case 'enum':
        const allowed = error.params.allowedValues.join(', ');
        return `${friendlyName} must be one of: ${allowed}`;

      case 'pattern':
        return `${friendlyName} has an invalid format`;

      default:
        return error.message || `${friendlyName} is invalid`;
    }
  }

  /**
   * Get format-specific error message
   * @private
   */
  _getFormatErrorMessage(fieldName, format) {
    switch (format) {
      case 'email':
        return `${fieldName} must be a valid email address`;
      case 'uri':
      case 'url':
        return `${fieldName} must be a valid URL`;
      case 'date-time':
      case 'composio-datetime':
        return `${fieldName} must be a valid date/time`;
      case 'date':
        return `${fieldName} must be a valid date`;
      default:
        return `${fieldName} has an invalid format`;
    }
  }

  /**
   * Convert field name to user-friendly format
   * DYNAMIC - uses schema description, no hardcoded mappings
   * @private
   */
  _getFriendlyFieldName(field, fieldSchema) {
    if (!field) return 'Field';

    // Use schema description if available (first few words)
    if (fieldSchema?.description) {
      const desc = fieldSchema.description;
      // Extract a short phrase from description
      const shortDesc = this._extractShortDescription(desc);
      if (shortDesc) {
        return shortDesc;
      }
    }

    // Fallback: humanize the field name
    return this._humanizeFieldName(field);
  }

  /**
   * Extract a short, friendly description from schema description
   * @private
   */
  _extractShortDescription(description) {
    if (!description || description.length < 3) {
      return null;
    }

    // Remove common prefixes
    let desc = description
      .replace(/^the\s+/i, '')
      .replace(/^a\s+/i, '')
      .replace(/^an\s+/i, '');

    // Take first meaningful phrase (up to 4 words or first comma/period)
    const words = desc.split(/[\s,.]/).filter(w => w.length > 0);
    const shortWords = words.slice(0, 4);

    if (shortWords.length === 0) {
      return null;
    }

    let result = shortWords.join(' ');

    // Capitalize first letter
    result = result.charAt(0).toUpperCase() + result.slice(1);

    return result;
  }

  /**
   * Humanize a field name (snake_case -> Title Case)
   * @private
   */
  _humanizeFieldName(field) {
    return field
      .replace(/_/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/^\w/, c => c.toUpperCase());
  }

  // ===========================================================================
  // TYPE COERCION
  // ===========================================================================

  /**
   * Coerce value to expected type
   */
  coerceValue(value, expectedType) {
    if (value === null || value === undefined) {
      return value;
    }

    switch (expectedType) {
      case 'string':
        return String(value);

      case 'number':
      case 'integer':
        const num = Number(value);
        return isNaN(num) ? value : (expectedType === 'integer' ? Math.floor(num) : num);

      case 'boolean':
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
          const lower = value.toLowerCase();
          if (['true', 'yes', '1', 'on'].includes(lower)) return true;
          if (['false', 'no', '0', 'off'].includes(lower)) return false;
        }
        return Boolean(value);

      case 'array':
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          // Try to parse comma-separated values
          return value.split(/[,;]\s*/).map(s => s.trim()).filter(Boolean);
        }
        return [value];

      default:
        return value;
    }
  }

  // ===========================================================================
  // SCHEMA UTILITIES
  // ===========================================================================

  /**
   * Create a JSON Schema object
   */
  createActionSchema(action, properties, required = []) {
    return {
      type: 'object',
      properties,
      required,
      additionalProperties: true,
    };
  }

  /**
   * Merge multiple schemas
   */
  mergeSchemas(schemas) {
    const merged = {
      type: 'object',
      properties: {},
      required: [],
    };

    for (const schema of schemas) {
      if (schema.properties) {
        Object.assign(merged.properties, schema.properties);
      }
      if (schema.required) {
        merged.required = [...new Set([...merged.required, ...schema.required])];
      }
    }

    return merged;
  }

  /**
   * Clear validator cache
   */
  clearCache() {
    this.validatorCache.clear();
  }
}

module.exports = { SchemaValidator };
