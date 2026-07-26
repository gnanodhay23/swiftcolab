/**
 * Centralized API Service
 *
 * Handles all API calls with:
 * - Automatic token refresh
 * - Request/response interceptors
 * - Error handling
 * - Retry logic
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

class ApiService {
  constructor() {
    this.baseUrl = API_URL;
    this.accessToken = null;
    this.refreshPromise = null;
    this.onUnauthorized = null; // Callback for auth errors
  }

  setAccessToken(token) {
    this.accessToken = token;
  }

  setUnauthorizedCallback(callback) {
    this.onUnauthorized = callback;
  }

  getHeaders(customHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders,
    };

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    return headers;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const config = {
      ...options,
      headers: this.getHeaders(options.headers),
      credentials: 'include', // For cookies
    };

    try {
      const response = await fetch(url, config);

      // Handle 401 - try token refresh
      if (response.status === 401 && !options._isRetry) {
        const refreshed = await this.tryRefreshToken();
        if (refreshed) {
          // Retry the original request with new token
          return this.request(endpoint, { ...options, _isRetry: true });
        } else {
          // Refresh failed - trigger logout
          if (this.onUnauthorized) {
            this.onUnauthorized();
          }
          throw new ApiError('Session expired. Please log in again.', 401);
        }
      }

      // Parse response
      let data;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        data = await response.json();
      } else {
        data = await response.text();
      }

      // Handle error responses
      if (!response.ok) {
        const errorMessage = data?.error || data?.message || `Request failed with status ${response.status}`;
        throw new ApiError(errorMessage, response.status, data);
      }

      return data;
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      // Network or other errors
      throw new ApiError(error.message || 'Network error', 0, null);
    }
  }

  async tryRefreshToken() {
    // Prevent multiple simultaneous refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        const response = await fetch(`${this.baseUrl}/api/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (!response.ok) {
          return false;
        }

        const data = await response.json();
        this.accessToken = data.accessToken;
        localStorage.setItem('accessToken', data.accessToken);
        return true;
      } catch {
        return false;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  // Convenience methods
  async get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  async post(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async put(endpoint, data, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

// Create singleton instance
const api = new ApiService();

// Initialize from localStorage
const storedToken = localStorage.getItem('accessToken');
if (storedToken) {
  api.setAccessToken(storedToken);
}

// Export both the instance and class
export { api, ApiService, ApiError };
export default api;

// ============================================
// API Endpoint Functions
// ============================================

// Auth APIs
export const authApi = {
  login: (credentials) => api.post('/api/auth/login', credentials),
  register: (userData) => api.post('/api/auth/register', userData),
  logout: () => api.post('/api/auth/logout', {}),
  logoutAll: () => api.post('/api/auth/logout-all', {}),
  refreshToken: () => api.post('/api/auth/refresh', {}),
  getMe: () => api.get('/api/auth/me'),
  updateProfile: (data) => api.put('/api/auth/profile', data),
  changePassword: (data) => api.put('/api/auth/password', data),
  forgotPassword: (email) => api.post('/api/auth/forgot-password', { email }),
  resetPassword: (data) => api.post('/api/auth/reset-password', data),
};

// Workspace APIs
export const workspaceApi = {
  get: () => api.get('/api/workspace'),
  save: (workspace) => api.post('/api/workspace', workspace),
  reset: () => api.delete('/api/workspace'),
};

// AI Assistant APIs
export const assistantApi = {
  sendMessage: (data) => api.post('/api/assistant', data),
  executeBrainTask: (data) => api.post('/api/unified', data),
};

// Connection/OAuth APIs
export const connectionApi = {
  initiate: (data) => api.post('/api/connections/initiate', data),
  checkStatus: (connectionId) => api.get(`/api/connections/check/${connectionId}`),
  getFields: (toolkit) => api.get(`/api/connections/fields/${toolkit}`),
  list: () => api.get('/api/connections/list'),
  createAuthConfig: (data) => api.post('/api/auth-config/create', data),
  getAuthConfigFields: (toolkit) => api.get(`/api/auth-config/fields/${toolkit}`),
};

// Health Check
export const healthApi = {
  check: () => api.get('/api/health'),
  getApps: () => api.get('/api/apps/available'),
};
