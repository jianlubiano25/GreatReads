import React, { Component, ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in Reading Life:', error, errorInfo);
  }

  // Saves a downloadable copy of the reading data (so a reset can never be a one-way trip).
  private handleDownloadData = () => {
    try {
      const raw = localStorage.getItem('readlife.v2') || localStorage.getItem('readlife.v1') || '{}';
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `my-reading-life-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    } catch (e) {
      console.error('Could not export data', e);
    }
  };

  private handleReset = () => {
    if (!window.confirm('Reset the app? Your saved reading data on this device will be cleared. Tap Cancel and use "Download my data" first if you want a copy.')) return;
    try {
      // Keep a safety copy under a separate key, then clear the live data.
      const raw = localStorage.getItem('readlife.v2');
      if (raw) localStorage.setItem('readlife.v2.backup', raw);
      localStorage.removeItem('readlife.v2');
      sessionStorage.clear();
    } catch {}
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-dvh bg-[#f5f0e6] dark:bg-[#181410] text-[#201a15] dark:text-[#f0e6d6] flex flex-col items-center justify-center p-6 text-center">
          <div className="max-w-md w-full p-8 rounded-3xl bg-[#fbf7ee] dark:bg-[#231d17] border border-[#e3d7c3] dark:border-[#382f25] shadow-lg flex flex-col items-center gap-4">
            <span className="text-4xl">🌿</span>
            <h2 className="font-serif-display text-2xl text-[#201a15] dark:text-[#f0e6d6]">
              A moment to pause
            </h2>
            <p className="text-xs text-[#706256] dark:text-[#a89a8a] leading-relaxed">
              We encountered a display issue while loading your books. Your notes and highlights are still saved on this device.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 w-full mt-2">
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold bg-[#2e5934] text-white hover:bg-[#244729] shadow-sm transition-all"
              >
                Reload App
              </button>
              <button
                onClick={this.handleDownloadData}
                className="py-2.5 px-4 rounded-xl text-xs font-medium border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5"
              >
                Download my data
              </button>
              <button
                onClick={this.handleReset}
                className="py-2.5 px-4 rounded-xl text-xs font-medium border border-[#e3d7c3] dark:border-[#382f25] text-[#706256] dark:text-[#a89a8a] hover:bg-black/5"
              >
                Reset Storage &amp; Refresh
              </button>
            </div>
            {this.state.error && (
              <pre className="text-[10px] text-left text-red-600/80 bg-black/5 dark:bg-white/5 p-2 rounded max-h-24 overflow-auto w-full mt-2">
                {this.state.error.message}
              </pre>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
