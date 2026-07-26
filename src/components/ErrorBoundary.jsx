import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

/**
 * Error Boundary Component
 *
 * Catches JavaScript errors anywhere in the child component tree,
 * logs those errors, and displays a fallback UI.
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      eventId: null,
    };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console
    console.error('Error Boundary caught an error:', error, errorInfo);

    this.setState({ errorInfo });

    // You can also log the error to an error reporting service here
    // Example: logErrorToService(error, errorInfo);

    // Generate a unique event ID for support reference
    const eventId = `ERR-${Date.now().toString(36).toUpperCase()}`;
    this.setState({ eventId });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = '/';
  };

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      // Fallback UI
      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-gray-800/50 backdrop-blur-sm border border-gray-700 rounded-2xl p-8 text-center">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-400" />
              </div>
            </div>

            {/* Error Message */}
            <h1 className="text-2xl font-bold text-white mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-400 mb-6">
              We're sorry, but something unexpected happened. Please try refreshing the page or contact support if the problem persists.
            </p>

            {/* Error Details (Development Only) */}
            {import.meta.env.DEV && this.state.error && (
              <div className="mb-6 p-4 bg-gray-900/50 rounded-lg text-left overflow-auto max-h-40">
                <p className="text-red-400 text-sm font-mono">
                  {this.state.error.toString()}
                </p>
                {this.state.errorInfo && (
                  <pre className="text-gray-500 text-xs mt-2 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            {/* Event ID for Support */}
            {this.state.eventId && (
              <p className="text-gray-500 text-sm mb-6">
                Reference ID: <code className="text-gray-400">{this.state.eventId}</code>
              </p>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={this.handleReload}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Refresh Page
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center justify-center gap-2 px-6 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
              >
                <Home className="w-4 h-4" />
                Go Home
              </button>
            </div>

            {/* Try Again (for recoverable errors) */}
            {this.props.onReset && (
              <button
                onClick={() => {
                  this.handleReset();
                  this.props.onReset?.();
                }}
                className="mt-4 text-blue-400 hover:text-blue-300 text-sm underline"
              >
                Try again without refreshing
              </button>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Async Error Boundary Hook
 * For catching errors in async operations
 */
export function useAsyncError() {
  const [, setError] = React.useState();
  return React.useCallback(
    (error) => {
      setError(() => {
        throw error;
      });
    },
    []
  );
}

/**
 * withErrorBoundary HOC
 * Wrap any component with error boundary
 */
export function withErrorBoundary(Component, fallbackProps = {}) {
  return function WrappedComponent(props) {
    return (
      <ErrorBoundary {...fallbackProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
}

export default ErrorBoundary;
