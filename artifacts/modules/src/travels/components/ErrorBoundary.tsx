import { Component, type ReactNode, type ErrorInfo } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-4">
          <AlertTriangle className="w-10 h-10 text-destructive/70" />
          <div>
            <p className="font-semibold text-foreground">
              Something went wrong
            </p>
            <p className="text-sm text-muted-foreground mt-1 max-w-sm">
              {this.state.message || "An unexpected error occurred."}
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              this.setState({ hasError: false, message: "" });
              window.location.reload();
            }}
          >
            Reload page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
