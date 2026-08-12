import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center">
          <div>
            <h2 className="text-lg font-semibold">Terjadi Kesalahan</h2>
            <p className="mt-1 text-sm text-muted-foreground">Mohon maaf, terjadi kesalahan yang tidak terduga.</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Muat Ulang
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
