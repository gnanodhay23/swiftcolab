/**
 * FrappeService - Custom integration for Frappe/ERPNext
 *
 * This is a non-Composio integration that provides:
 * - OAuth and API Key authentication
 * - JSON Schema definitions for all Frappe actions
 * - Tool execution compatible with the orchestration engine
 * - Unified interface matching ComposioService patterns
 */

const fetch = require('node-fetch');

// Frappe Action Definitions with JSON Schemas
const FRAPPE_ACTIONS = {
  // ============= Customer Operations =============
  FRAPPE_LIST_CUSTOMERS: {
    name: 'FRAPPE_LIST_CUSTOMERS',
    description: 'List customers from ERPNext with optional filters',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of customers to return',
          default: 20
        },
        search: {
          type: 'string',
          description: 'Search term to filter customers by name'
        },
        customer_group: {
          type: 'string',
          description: 'Filter by customer group'
        },
        territory: {
          type: 'string',
          description: 'Filter by territory'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_CUSTOMER: {
    name: 'FRAPPE_CREATE_CUSTOMER',
    description: 'Create a new customer in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Name of the customer'
        },
        customer_type: {
          type: 'string',
          enum: ['Company', 'Individual'],
          description: 'Type of customer',
          default: 'Company'
        },
        customer_group: {
          type: 'string',
          description: 'Customer group classification',
          default: 'All Customer Groups'
        },
        territory: {
          type: 'string',
          description: 'Territory for the customer',
          default: 'All Territories'
        },
        email_id: {
          type: 'string',
          description: 'Primary email address'
        },
        mobile_no: {
          type: 'string',
          description: 'Mobile phone number'
        }
      },
      required: ['customer_name']
    }
  },

  FRAPPE_GET_CUSTOMER: {
    name: 'FRAPPE_GET_CUSTOMER',
    description: 'Get details of a specific customer',
    parameters: {
      type: 'object',
      properties: {
        customer_name: {
          type: 'string',
          description: 'Name/ID of the customer to retrieve'
        }
      },
      required: ['customer_name']
    }
  },

  // ============= Item/Product Operations =============
  FRAPPE_LIST_ITEMS: {
    name: 'FRAPPE_LIST_ITEMS',
    description: 'List items/products from ERPNext inventory',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of items to return',
          default: 20
        },
        search: {
          type: 'string',
          description: 'Search term to filter items by name'
        },
        item_group: {
          type: 'string',
          description: 'Filter by item group'
        },
        is_stock_item: {
          type: 'boolean',
          description: 'Filter for stock items only'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_ITEM: {
    name: 'FRAPPE_CREATE_ITEM',
    description: 'Create a new item/product in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        item_code: {
          type: 'string',
          description: 'Unique item code'
        },
        item_name: {
          type: 'string',
          description: 'Display name of the item'
        },
        item_group: {
          type: 'string',
          description: 'Item group classification',
          default: 'All Item Groups'
        },
        stock_uom: {
          type: 'string',
          description: 'Stock unit of measure',
          default: 'Nos'
        },
        is_stock_item: {
          type: 'boolean',
          description: 'Whether this is a stock item',
          default: true
        },
        standard_rate: {
          type: 'number',
          description: 'Standard selling rate'
        },
        description: {
          type: 'string',
          description: 'Item description'
        }
      },
      required: ['item_code', 'item_name']
    }
  },

  FRAPPE_GET_STOCK: {
    name: 'FRAPPE_GET_STOCK',
    description: 'Get stock levels for items',
    parameters: {
      type: 'object',
      properties: {
        item_code: {
          type: 'string',
          description: 'Filter by specific item code'
        },
        warehouse: {
          type: 'string',
          description: 'Filter by specific warehouse'
        }
      },
      required: []
    }
  },

  // ============= Sales Order Operations =============
  FRAPPE_LIST_SALES_ORDERS: {
    name: 'FRAPPE_LIST_SALES_ORDERS',
    description: 'List sales orders from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of orders to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Draft', 'To Deliver and Bill', 'To Bill', 'To Deliver', 'Completed', 'Cancelled'],
          description: 'Filter by order status'
        },
        customer: {
          type: 'string',
          description: 'Filter by customer name'
        },
        from_date: {
          type: 'string',
          format: 'date',
          description: 'Filter orders from this date'
        },
        to_date: {
          type: 'string',
          format: 'date',
          description: 'Filter orders until this date'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_SALES_ORDER: {
    name: 'FRAPPE_CREATE_SALES_ORDER',
    description: 'Create a new sales order in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        customer: {
          type: 'string',
          description: 'Customer name for the order'
        },
        delivery_date: {
          type: 'string',
          format: 'date',
          description: 'Expected delivery date'
        },
        items: {
          type: 'array',
          description: 'List of items in the order',
          items: {
            type: 'object',
            properties: {
              item_code: { type: 'string' },
              qty: { type: 'number' },
              rate: { type: 'number' }
            },
            required: ['item_code', 'qty']
          }
        },
        po_no: {
          type: 'string',
          description: 'Customer purchase order number'
        }
      },
      required: ['customer', 'items']
    }
  },

  // ============= Sales Invoice Operations =============
  FRAPPE_LIST_SALES_INVOICES: {
    name: 'FRAPPE_LIST_SALES_INVOICES',
    description: 'List sales invoices from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of invoices to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Draft', 'Return', 'Credit Note Issued', 'Submitted', 'Paid', 'Unpaid', 'Overdue', 'Cancelled'],
          description: 'Filter by invoice status'
        },
        customer: {
          type: 'string',
          description: 'Filter by customer name'
        },
        is_return: {
          type: 'boolean',
          description: 'Filter for return invoices only'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_SALES_INVOICE: {
    name: 'FRAPPE_CREATE_SALES_INVOICE',
    description: 'Create a new sales invoice in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        customer: {
          type: 'string',
          description: 'Customer name for the invoice'
        },
        items: {
          type: 'array',
          description: 'List of items to invoice',
          items: {
            type: 'object',
            properties: {
              item_code: { type: 'string' },
              qty: { type: 'number' },
              rate: { type: 'number' }
            },
            required: ['item_code', 'qty']
          }
        },
        due_date: {
          type: 'string',
          format: 'date',
          description: 'Payment due date'
        },
        posting_date: {
          type: 'string',
          format: 'date',
          description: 'Invoice posting date'
        }
      },
      required: ['customer', 'items']
    }
  },

  // ============= Purchase Order Operations =============
  FRAPPE_LIST_PURCHASE_ORDERS: {
    name: 'FRAPPE_LIST_PURCHASE_ORDERS',
    description: 'List purchase orders from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of orders to return',
          default: 20
        },
        status: {
          type: 'string',
          description: 'Filter by order status'
        },
        supplier: {
          type: 'string',
          description: 'Filter by supplier name'
        }
      },
      required: []
    }
  },

  // ============= Supplier Operations =============
  FRAPPE_LIST_SUPPLIERS: {
    name: 'FRAPPE_LIST_SUPPLIERS',
    description: 'List suppliers from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of suppliers to return',
          default: 20
        },
        search: {
          type: 'string',
          description: 'Search term to filter suppliers by name'
        },
        supplier_group: {
          type: 'string',
          description: 'Filter by supplier group'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_SUPPLIER: {
    name: 'FRAPPE_CREATE_SUPPLIER',
    description: 'Create a new supplier in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        supplier_name: {
          type: 'string',
          description: 'Name of the supplier'
        },
        supplier_group: {
          type: 'string',
          description: 'Supplier group classification',
          default: 'All Supplier Groups'
        },
        supplier_type: {
          type: 'string',
          enum: ['Company', 'Individual'],
          description: 'Type of supplier',
          default: 'Company'
        },
        email_id: {
          type: 'string',
          description: 'Primary email address'
        }
      },
      required: ['supplier_name']
    }
  },

  // ============= Employee Operations (HR) =============
  FRAPPE_LIST_EMPLOYEES: {
    name: 'FRAPPE_LIST_EMPLOYEES',
    description: 'List employees from ERPNext HR module',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of employees to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Active', 'Inactive', 'Left'],
          description: 'Filter by employment status'
        },
        department: {
          type: 'string',
          description: 'Filter by department'
        }
      },
      required: []
    }
  },

  // ============= Leave Application Operations =============
  FRAPPE_LIST_LEAVE_APPLICATIONS: {
    name: 'FRAPPE_LIST_LEAVE_APPLICATIONS',
    description: 'List leave applications from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of applications to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Open', 'Approved', 'Rejected', 'Cancelled'],
          description: 'Filter by application status'
        },
        employee: {
          type: 'string',
          description: 'Filter by employee name'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_LEAVE_APPLICATION: {
    name: 'FRAPPE_CREATE_LEAVE_APPLICATION',
    description: 'Create a leave application in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        employee: {
          type: 'string',
          description: 'Employee ID/name'
        },
        leave_type: {
          type: 'string',
          description: 'Type of leave (e.g., Casual Leave, Sick Leave)'
        },
        from_date: {
          type: 'string',
          format: 'date',
          description: 'Leave start date'
        },
        to_date: {
          type: 'string',
          format: 'date',
          description: 'Leave end date'
        },
        reason: {
          type: 'string',
          description: 'Reason for leave'
        }
      },
      required: ['employee', 'leave_type', 'from_date', 'to_date']
    }
  },

  // ============= Task/Project Operations =============
  FRAPPE_LIST_TASKS: {
    name: 'FRAPPE_LIST_TASKS',
    description: 'List tasks from ERPNext project module',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of tasks to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Open', 'Working', 'Pending Review', 'Overdue', 'Completed', 'Cancelled'],
          description: 'Filter by task status'
        },
        project: {
          type: 'string',
          description: 'Filter by project name'
        },
        assigned_to: {
          type: 'string',
          description: 'Filter by assignee'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_TASK: {
    name: 'FRAPPE_CREATE_TASK',
    description: 'Create a new task in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        subject: {
          type: 'string',
          description: 'Task subject/title'
        },
        project: {
          type: 'string',
          description: 'Project to associate the task with'
        },
        priority: {
          type: 'string',
          enum: ['Low', 'Medium', 'High', 'Urgent'],
          description: 'Task priority',
          default: 'Medium'
        },
        exp_start_date: {
          type: 'string',
          format: 'date',
          description: 'Expected start date'
        },
        exp_end_date: {
          type: 'string',
          format: 'date',
          description: 'Expected end date'
        },
        description: {
          type: 'string',
          description: 'Task description'
        },
        assigned_to: {
          type: 'string',
          description: 'User to assign the task to'
        }
      },
      required: ['subject']
    }
  },

  FRAPPE_UPDATE_TASK: {
    name: 'FRAPPE_UPDATE_TASK',
    description: 'Update an existing task in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        task_name: {
          type: 'string',
          description: 'Task ID/name to update'
        },
        status: {
          type: 'string',
          enum: ['Open', 'Working', 'Pending Review', 'Overdue', 'Completed', 'Cancelled'],
          description: 'New task status'
        },
        priority: {
          type: 'string',
          enum: ['Low', 'Medium', 'High', 'Urgent'],
          description: 'New task priority'
        },
        description: {
          type: 'string',
          description: 'Updated description'
        }
      },
      required: ['task_name']
    }
  },

  // ============= Project Operations =============
  FRAPPE_LIST_PROJECTS: {
    name: 'FRAPPE_LIST_PROJECTS',
    description: 'List projects from ERPNext',
    parameters: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Maximum number of projects to return',
          default: 20
        },
        status: {
          type: 'string',
          enum: ['Open', 'Completed', 'Cancelled'],
          description: 'Filter by project status'
        }
      },
      required: []
    }
  },

  FRAPPE_CREATE_PROJECT: {
    name: 'FRAPPE_CREATE_PROJECT',
    description: 'Create a new project in ERPNext',
    parameters: {
      type: 'object',
      properties: {
        project_name: {
          type: 'string',
          description: 'Name of the project'
        },
        expected_start_date: {
          type: 'string',
          format: 'date',
          description: 'Expected start date'
        },
        expected_end_date: {
          type: 'string',
          format: 'date',
          description: 'Expected end date'
        },
        priority: {
          type: 'string',
          enum: ['Low', 'Medium', 'High'],
          description: 'Project priority',
          default: 'Medium'
        },
        notes: {
          type: 'string',
          description: 'Project notes/description'
        }
      },
      required: ['project_name']
    }
  },

  // ============= Generic DocType Operations =============
  FRAPPE_GET_DOCUMENT: {
    name: 'FRAPPE_GET_DOCUMENT',
    description: 'Get any document from Frappe by doctype and name',
    parameters: {
      type: 'object',
      properties: {
        doctype: {
          type: 'string',
          description: 'The DocType (e.g., Customer, Sales Order, Task)'
        },
        name: {
          type: 'string',
          description: 'The document name/ID'
        }
      },
      required: ['doctype', 'name']
    }
  },

  FRAPPE_LIST_DOCUMENTS: {
    name: 'FRAPPE_LIST_DOCUMENTS',
    description: 'List documents of any DocType with filters',
    parameters: {
      type: 'object',
      properties: {
        doctype: {
          type: 'string',
          description: 'The DocType to list'
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
        limit: {
          type: 'integer',
          description: 'Maximum documents to return',
          default: 20
        },
        order_by: {
          type: 'string',
          description: 'Field to sort by (e.g., "creation desc")'
        }
      },
      required: ['doctype']
    }
  },

  FRAPPE_CREATE_DOCUMENT: {
    name: 'FRAPPE_CREATE_DOCUMENT',
    description: 'Create a document of any DocType',
    parameters: {
      type: 'object',
      properties: {
        doctype: {
          type: 'string',
          description: 'The DocType to create'
        },
        data: {
          type: 'object',
          description: 'Document data as key-value pairs'
        }
      },
      required: ['doctype', 'data']
    }
  },

  FRAPPE_UPDATE_DOCUMENT: {
    name: 'FRAPPE_UPDATE_DOCUMENT',
    description: 'Update a document of any DocType',
    parameters: {
      type: 'object',
      properties: {
        doctype: {
          type: 'string',
          description: 'The DocType to update'
        },
        name: {
          type: 'string',
          description: 'The document name/ID'
        },
        data: {
          type: 'object',
          description: 'Fields to update as key-value pairs'
        }
      },
      required: ['doctype', 'name', 'data']
    }
  },

  FRAPPE_DELETE_DOCUMENT: {
    name: 'FRAPPE_DELETE_DOCUMENT',
    description: 'Delete a document',
    parameters: {
      type: 'object',
      properties: {
        doctype: {
          type: 'string',
          description: 'The DocType'
        },
        name: {
          type: 'string',
          description: 'The document name/ID to delete'
        }
      },
      required: ['doctype', 'name']
    }
  },

  // ============= Method Calls =============
  FRAPPE_CALL_METHOD: {
    name: 'FRAPPE_CALL_METHOD',
    description: 'Call a custom Frappe whitelisted method',
    parameters: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Full method path (e.g., frappe.client.get_count)'
        },
        args: {
          type: 'object',
          description: 'Method arguments'
        }
      },
      required: ['method']
    }
  }
};

// Get all action names for easy reference
const FRAPPE_ACTION_NAMES = Object.keys(FRAPPE_ACTIONS);

class FrappeService {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || process.env.FRAPPE_URL;
    this.apiKey = config.apiKey || process.env.FRAPPE_API_KEY;
    this.apiSecret = config.apiSecret || process.env.FRAPPE_API_SECRET;
    this.email = config.email || process.env.FRAPPE_EMAIL;
    this.password = config.password || process.env.FRAPPE_PASSWORD;

    // Session management for cookie-based auth
    this.sessionCookies = null;
    this.sessionExpiry = null;
  }

  /**
   * Check if Frappe is configured
   */
  isConfigured() {
    return !!(this.baseUrl && (this.apiKey || this.email));
  }

  /**
   * Get authentication headers
   */
  getAuthHeaders() {
    if (this.apiKey && this.apiSecret) {
      return {
        'Authorization': `token ${this.apiKey}:${this.apiSecret}`,
      };
    }
    return null;
  }

  /**
   * Login and get session cookies
   */
  async getSession() {
    if (this.sessionCookies && this.sessionExpiry && Date.now() < this.sessionExpiry) {
      return this.sessionCookies;
    }

    if (!this.email || !this.password) {
      throw new Error('Frappe session auth requires email and password');
    }

    console.log('[FrappeService] Logging in via session...');

    const response = await fetch(`${this.baseUrl}/api/method/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        usr: this.email,
        pwd: this.password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Frappe login failed: ${response.status} - ${errorText}`);
    }

    const cookies = response.headers.raw()['set-cookie'];
    if (cookies && cookies.length > 0) {
      this.sessionCookies = cookies.map(c => c.split(';')[0]).join('; ');
      this.sessionExpiry = Date.now() + (5 * 60 * 60 * 1000); // 5 hours
      console.log('[FrappeService] Session established');
      return this.sessionCookies;
    }

    throw new Error('No session cookies received from Frappe');
  }

  /**
   * Make authenticated API call
   */
  async apiCall(method, endpoint, body = null) {
    const authHeaders = this.getAuthHeaders();

    let headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (!authHeaders) {
      const cookies = await this.getSession();
      headers['Cookie'] = cookies;
    } else {
      headers = { ...headers, ...authHeaders };
    }

    const options = {
      method,
      headers,
    };

    if (body && (method === 'POST' || method === 'PUT')) {
      options.body = JSON.stringify(body);
    }

    const url = `${this.baseUrl}${endpoint}`;
    console.log(`[FrappeService] ${method} ${url}`);

    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();

      // Handle session expiry
      if (response.status === 403 && !authHeaders) {
        this.sessionCookies = null;
        this.sessionExpiry = null;
        const newCookies = await this.getSession();
        headers['Cookie'] = newCookies;

        const retryResponse = await fetch(url, { ...options, headers });
        if (!retryResponse.ok) {
          const retryError = await retryResponse.text();
          throw new Error(`Frappe API error: ${retryResponse.status} - ${retryError}`);
        }
        return retryResponse.json();
      }

      throw new Error(`Frappe API error: ${response.status} - ${errorText}`);
    }

    return response.json();
  }

  /**
   * Get all available Frappe tools (for compatibility with ComposioService)
   */
  getTools() {
    return Object.values(FRAPPE_ACTIONS);
  }

  /**
   * Get a specific action schema
   */
  getActionSchema(actionName) {
    return FRAPPE_ACTIONS[actionName] || null;
  }

  /**
   * Execute a Frappe action (main entry point for orchestration)
   */
  async execute({ actionName, params, idempotencyKey = null }) {
    console.log(`[FrappeService] Executing action: ${actionName}`, params);

    if (!this.isConfigured()) {
      throw new Error('Frappe is not configured. Please set FRAPPE_URL and authentication credentials.');
    }

    const action = FRAPPE_ACTIONS[actionName];
    if (!action) {
      throw new Error(`Unknown Frappe action: ${actionName}`);
    }

    // Route to appropriate handler
    switch (actionName) {
      // Customers
      case 'FRAPPE_LIST_CUSTOMERS':
        return this.listCustomers(params);
      case 'FRAPPE_CREATE_CUSTOMER':
        return this.createCustomer(params);
      case 'FRAPPE_GET_CUSTOMER':
        return this.getCustomer(params);

      // Items
      case 'FRAPPE_LIST_ITEMS':
        return this.listItems(params);
      case 'FRAPPE_CREATE_ITEM':
        return this.createItem(params);
      case 'FRAPPE_GET_STOCK':
        return this.getStock(params);

      // Sales Orders
      case 'FRAPPE_LIST_SALES_ORDERS':
        return this.listSalesOrders(params);
      case 'FRAPPE_CREATE_SALES_ORDER':
        return this.createSalesOrder(params);

      // Sales Invoices
      case 'FRAPPE_LIST_SALES_INVOICES':
        return this.listSalesInvoices(params);
      case 'FRAPPE_CREATE_SALES_INVOICE':
        return this.createSalesInvoice(params);

      // Purchase Orders
      case 'FRAPPE_LIST_PURCHASE_ORDERS':
        return this.listPurchaseOrders(params);

      // Suppliers
      case 'FRAPPE_LIST_SUPPLIERS':
        return this.listSuppliers(params);
      case 'FRAPPE_CREATE_SUPPLIER':
        return this.createSupplier(params);

      // Employees
      case 'FRAPPE_LIST_EMPLOYEES':
        return this.listEmployees(params);

      // Leave Applications
      case 'FRAPPE_LIST_LEAVE_APPLICATIONS':
        return this.listLeaveApplications(params);
      case 'FRAPPE_CREATE_LEAVE_APPLICATION':
        return this.createLeaveApplication(params);

      // Tasks
      case 'FRAPPE_LIST_TASKS':
        return this.listTasks(params);
      case 'FRAPPE_CREATE_TASK':
        return this.createTask(params);
      case 'FRAPPE_UPDATE_TASK':
        return this.updateTask(params);

      // Projects
      case 'FRAPPE_LIST_PROJECTS':
        return this.listProjects(params);
      case 'FRAPPE_CREATE_PROJECT':
        return this.createProject(params);

      // Generic DocType Operations
      case 'FRAPPE_GET_DOCUMENT':
        return this.getDocument(params);
      case 'FRAPPE_LIST_DOCUMENTS':
        return this.listDocuments(params);
      case 'FRAPPE_CREATE_DOCUMENT':
        return this.createDocument(params);
      case 'FRAPPE_UPDATE_DOCUMENT':
        return this.updateDocument(params);
      case 'FRAPPE_DELETE_DOCUMENT':
        return this.deleteDocument(params);

      // Method Calls
      case 'FRAPPE_CALL_METHOD':
        return this.callMethod(params);

      default:
        throw new Error(`Action handler not implemented: ${actionName}`);
    }
  }

  // ============= Customer Implementations =============

  async listCustomers(params = {}) {
    const { limit = 20, search, customer_group, territory } = params;
    let filters = [];

    if (search) filters.push(`["customer_name","like","%${search}%"]`);
    if (customer_group) filters.push(`["customer_group","=","${customer_group}"]`);
    if (territory) filters.push(`["territory","=","${territory}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    // Added order_by=modified desc so newly created customers appear first
    const data = await this.apiCall('GET', `/api/resource/Customer?limit_page_length=${limit}${filterStr}&order_by=modified desc`);
    console.log(`[FrappeService] listCustomers: returned ${data.data?.length || 0} customers`);
    return { success: true, data: data.data, message: data.message };
  }

  async createCustomer(params) {
    const data = await this.apiCall('POST', '/api/resource/Customer', params);
    return { success: true, data: data.data, message: `Customer "${params.customer_name}" created successfully` };
  }

  async getCustomer(params) {
    const data = await this.apiCall('GET', `/api/resource/Customer/${encodeURIComponent(params.customer_name)}`);
    return { success: true, data: data.data };
  }

  // ============= Item Implementations =============

  async listItems(params = {}) {
    const { limit = 20, search, item_group, is_stock_item } = params;
    let filters = [];

    if (search) filters.push(`["item_name","like","%${search}%"]`);
    if (item_group) filters.push(`["item_group","=","${item_group}"]`);
    if (is_stock_item !== undefined) filters.push(`["is_stock_item","=",${is_stock_item ? 1 : 0}]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Item?limit_page_length=${limit}${filterStr}`);
    return { success: true, data: data.data };
  }

  async createItem(params) {
    const data = await this.apiCall('POST', '/api/resource/Item', params);
    return { success: true, data: data.data, message: `Item "${params.item_name}" created successfully` };
  }

  async getStock(params = {}) {
    const { item_code, warehouse } = params;
    let filters = [];

    if (item_code) filters.push(`["item_code","=","${item_code}"]`);
    if (warehouse) filters.push(`["warehouse","=","${warehouse}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Bin?limit_page_length=0${filterStr}&fields=["item_code","warehouse","actual_qty","projected_qty"]`);
    return { success: true, data: data.data };
  }

  // ============= Sales Order Implementations =============

  async listSalesOrders(params = {}) {
    const { limit = 20, status, customer, from_date, to_date } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (customer) filters.push(`["customer","=","${customer}"]`);
    if (from_date) filters.push(`["transaction_date",">=","${from_date}"]`);
    if (to_date) filters.push(`["transaction_date","<=","${to_date}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Sales Order?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  async createSalesOrder(params) {
    const data = await this.apiCall('POST', '/api/resource/Sales Order', params);
    return { success: true, data: data.data, message: `Sales Order created for ${params.customer}` };
  }

  // ============= Sales Invoice Implementations =============

  async listSalesInvoices(params = {}) {
    const { limit = 20, status, customer, is_return } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (customer) filters.push(`["customer","=","${customer}"]`);
    if (is_return !== undefined) filters.push(`["is_return","=",${is_return ? 1 : 0}]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Sales Invoice?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  async createSalesInvoice(params) {
    const data = await this.apiCall('POST', '/api/resource/Sales Invoice', params);
    return { success: true, data: data.data, message: `Sales Invoice created for ${params.customer}` };
  }

  // ============= Purchase Order Implementations =============

  async listPurchaseOrders(params = {}) {
    const { limit = 20, status, supplier } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (supplier) filters.push(`["supplier","=","${supplier}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Purchase Order?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  // ============= Supplier Implementations =============

  async listSuppliers(params = {}) {
    const { limit = 20, search, supplier_group } = params;
    let filters = [];

    if (search) filters.push(`["supplier_name","like","%${search}%"]`);
    if (supplier_group) filters.push(`["supplier_group","=","${supplier_group}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Supplier?limit_page_length=${limit}${filterStr}`);
    return { success: true, data: data.data };
  }

  async createSupplier(params) {
    const data = await this.apiCall('POST', '/api/resource/Supplier', params);
    return { success: true, data: data.data, message: `Supplier "${params.supplier_name}" created successfully` };
  }

  // ============= Employee Implementations =============

  async listEmployees(params = {}) {
    const { limit = 20, status, department } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (department) filters.push(`["department","=","${department}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Employee?limit_page_length=${limit}${filterStr}`);
    return { success: true, data: data.data };
  }

  // ============= Leave Application Implementations =============

  async listLeaveApplications(params = {}) {
    const { limit = 20, status, employee } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (employee) filters.push(`["employee","=","${employee}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Leave Application?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  async createLeaveApplication(params) {
    const data = await this.apiCall('POST', '/api/resource/Leave Application', params);
    return { success: true, data: data.data, message: `Leave application created for ${params.employee}` };
  }

  // ============= Task Implementations =============

  async listTasks(params = {}) {
    const { limit = 20, status, project, assigned_to } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);
    if (project) filters.push(`["project","=","${project}"]`);
    if (assigned_to) filters.push(`["_assign","like","%${assigned_to}%"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Task?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  async createTask(params) {
    const data = await this.apiCall('POST', '/api/resource/Task', params);
    return { success: true, data: data.data, message: `Task "${params.subject}" created successfully` };
  }

  async updateTask(params) {
    const { task_name, ...updateData } = params;
    const data = await this.apiCall('PUT', `/api/resource/Task/${encodeURIComponent(task_name)}`, updateData);
    return { success: true, data: data.data, message: `Task "${task_name}" updated successfully` };
  }

  // ============= Project Implementations =============

  async listProjects(params = {}) {
    const { limit = 20, status } = params;
    let filters = [];

    if (status) filters.push(`["status","=","${status}"]`);

    const filterStr = filters.length > 0 ? `&filters=[${filters.join(',')}]` : '';
    const data = await this.apiCall('GET', `/api/resource/Project?limit_page_length=${limit}${filterStr}&order_by=creation desc`);
    return { success: true, data: data.data };
  }

  async createProject(params) {
    const data = await this.apiCall('POST', '/api/resource/Project', params);
    return { success: true, data: data.data, message: `Project "${params.project_name}" created successfully` };
  }

  // ============= Generic DocType Implementations =============

  async getDocument(params) {
    const { doctype, name } = params;
    const data = await this.apiCall('GET', `/api/resource/${doctype}/${encodeURIComponent(name)}`);
    return { success: true, data: data.data };
  }

  async listDocuments(params) {
    const { doctype, filters, fields, limit = 20, order_by } = params;

    let endpoint = `/api/resource/${doctype}?limit_page_length=${limit}`;

    if (filters) {
      const filterArray = Object.entries(filters).map(([k, v]) => `["${k}","=","${v}"]`);
      endpoint += `&filters=[${filterArray.join(',')}]`;
    }
    if (fields) {
      endpoint += `&fields=${JSON.stringify(fields)}`;
    }
    if (order_by) {
      endpoint += `&order_by=${encodeURIComponent(order_by)}`;
    }

    const data = await this.apiCall('GET', endpoint);
    return { success: true, data: data.data };
  }

  async createDocument(params) {
    const { doctype, data: docData } = params;
    const result = await this.apiCall('POST', `/api/resource/${doctype}`, docData);
    return { success: true, data: result.data, message: `${doctype} created successfully` };
  }

  async updateDocument(params) {
    const { doctype, name, data: updateData } = params;
    const result = await this.apiCall('PUT', `/api/resource/${doctype}/${encodeURIComponent(name)}`, updateData);
    return { success: true, data: result.data, message: `${doctype} "${name}" updated successfully` };
  }

  async deleteDocument(params) {
    const { doctype, name } = params;
    await this.apiCall('DELETE', `/api/resource/${doctype}/${encodeURIComponent(name)}`);
    return { success: true, message: `${doctype} "${name}" deleted successfully` };
  }

  // ============= Method Call Implementation =============

  async callMethod(params) {
    const { method, args = {} } = params;
    const data = await this.apiCall('POST', `/api/method/${method}`, args);
    return { success: true, data: data.message || data.data };
  }

  /**
   * Test connection to Frappe
   */
  async testConnection() {
    try {
      const data = await this.apiCall('GET', '/api/method/frappe.auth.get_logged_user');
      return {
        success: true,
        user: data.message,
        url: this.baseUrl,
        authMethod: this.apiKey ? 'API Key' : 'Session'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        url: this.baseUrl
      };
    }
  }
}

module.exports = {
  FrappeService,
  FRAPPE_ACTIONS,
  FRAPPE_ACTION_NAMES,
};
