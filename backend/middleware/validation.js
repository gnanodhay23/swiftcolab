/**
 * Request Validation Middleware
 *
 * Provides input validation and sanitization for API endpoints.
 * Uses a simple schema-based approach without external dependencies.
 */

/**
 * Validation error class
 */
class ValidationError extends Error {
  constructor(message, field, details = []) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.details = details;
    this.status = 400;
  }
}

/**
 * Simple validator functions
 */
const validators = {
  required: (value, field) => {
    if (value === undefined || value === null || value === '') {
      return `${field} is required`;
    }
    return null;
  },

  string: (value, field) => {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `${field} must be a string`;
    }
    return null;
  },

  email: (value, field) => {
    if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return `${field} must be a valid email address`;
    }
    return null;
  },

  minLength: (min) => (value, field) => {
    if (value && value.length < min) {
      return `${field} must be at least ${min} characters`;
    }
    return null;
  },

  maxLength: (max) => (value, field) => {
    if (value && value.length > max) {
      return `${field} must be no more than ${max} characters`;
    }
    return null;
  },

  array: (value, field) => {
    if (value !== undefined && !Array.isArray(value)) {
      return `${field} must be an array`;
    }
    return null;
  },

  object: (value, field) => {
    if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      return `${field} must be an object`;
    }
    return null;
  },

  boolean: (value, field) => {
    if (value !== undefined && typeof value !== 'boolean') {
      return `${field} must be a boolean`;
    }
    return null;
  },

  number: (value, field) => {
    if (value !== undefined && typeof value !== 'number') {
      return `${field} must be a number`;
    }
    return null;
  },

  uuid: (value, field) => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (value && !uuidRegex.test(value)) {
      return `${field} must be a valid UUID`;
    }
    return null;
  },

  oneOf: (options) => (value, field) => {
    if (value && !options.includes(value)) {
      return `${field} must be one of: ${options.join(', ')}`;
    }
    return null;
  },

  pattern: (regex, message) => (value, field) => {
    if (value && !regex.test(value)) {
      return message || `${field} has an invalid format`;
    }
    return null;
  },
};

/**
 * Create a validation schema
 * @param {Object} schema - Object mapping field names to arrays of validators
 * @returns {Function} Express middleware
 */
function createValidator(schema) {
  return (req, res, next) => {
    const errors = [];
    const sanitized = {};

    for (const [field, rules] of Object.entries(schema)) {
      const value = req.body[field];

      // Run all validators for this field
      for (const rule of rules) {
        const error = typeof rule === 'function'
          ? rule(value, field)
          : validators[rule]?.(value, field);

        if (error) {
          errors.push({ field, message: error });
          break; // Stop at first error for this field
        }
      }

      // Add sanitized value
      if (value !== undefined) {
        // Basic sanitization for strings
        if (typeof value === 'string') {
          sanitized[field] = value.trim();
        } else {
          sanitized[field] = value;
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed',
        details: errors,
      });
    }

    // Attach sanitized body
    req.validatedBody = sanitized;
    next();
  };
}

/**
 * Pre-built validation schemas for common endpoints
 */
const schemas = {
  // Auth endpoints
  register: {
    email: ['required', 'string', 'email', validators.maxLength(255)],
    password: ['required', 'string', validators.minLength(8), validators.maxLength(128)],
    name: ['string', validators.maxLength(255)],
  },

  login: {
    email: ['required', 'string', 'email'],
    password: ['required', 'string'],
  },

  updateProfile: {
    name: ['string', validators.maxLength(255)],
    avatar_url: ['string', validators.maxLength(2048)],
  },

  changePassword: {
    currentPassword: ['required', 'string'],
    newPassword: ['required', 'string', validators.minLength(8), validators.maxLength(128)],
  },

  // Workspace
  saveWorkspace: {
    aiOsApps: ['array'],
    workOsApps: ['array'],
  },

  // Assistant
  assistant: {
    message: ['string', validators.maxLength(10000)],
    selectedApps: ['array'],
    conversationHistory: ['array'],
    followupContext: ['object'],
    answers: ['array'],
  },

  // Connections
  initiateConnection: {
    toolkit: ['required', 'string'],
    integrationId: ['string'],
    params: ['object'],
  },

  // Frappe
  frappeQuery: {
    doctype: ['required', 'string', validators.maxLength(255)],
    filters: ['object'],
    fields: ['array'],
    limit: ['number'],
    offset: ['number'],
  },
};

/**
 * Middleware to validate specific schemas
 */
const validate = {
  register: createValidator(schemas.register),
  login: createValidator(schemas.login),
  updateProfile: createValidator(schemas.updateProfile),
  changePassword: createValidator(schemas.changePassword),
  saveWorkspace: createValidator(schemas.saveWorkspace),
  assistant: createValidator(schemas.assistant),
  initiateConnection: createValidator(schemas.initiateConnection),
  frappeQuery: createValidator(schemas.frappeQuery),
};

/**
 * Sanitize HTML/script tags from string inputs (XSS prevention)
 */
function sanitizeInput(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Deep sanitize an object
 */
function sanitizeObject(obj) {
  if (typeof obj !== 'object' || obj === null) {
    return sanitizeInput(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    sanitized[sanitizeInput(key)] = sanitizeObject(value);
  }
  return sanitized;
}

/**
 * Global sanitization middleware
 */
function sanitizeBody(req, res, next) {
  if (req.body && typeof req.body === 'object') {
    // Don't sanitize certain fields that may contain HTML (like rich text)
    const skipFields = ['body', 'content', 'description', 'html'];

    for (const [key, value] of Object.entries(req.body)) {
      if (!skipFields.includes(key)) {
        req.body[key] = sanitizeObject(value);
      }
    }
  }
  next();
}

module.exports = {
  ValidationError,
  validators,
  createValidator,
  schemas,
  validate,
  sanitizeInput,
  sanitizeObject,
  sanitizeBody,
};
