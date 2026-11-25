import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#0B0D11] text-[#F3F5F8] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#12151C] border border-[#262D3B] rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-5 h-5 shrink-0" />
              <h2 className="text-base font-semibold font-display">Workspace Interrupted</h2>
            </div>
            <p className="text-sm text-[#9BA5B7] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false, message: '' })}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-amber-500 text-neutral-950 hover:bg-amber-400 transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Resume Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
