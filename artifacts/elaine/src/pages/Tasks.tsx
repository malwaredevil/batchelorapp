import { useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  RefreshCw,
  SearchCheck,
} from "lucide-react";
import { toast } from "sonner";
import {
  getListElaineTasksQueryKey,
  useCancelElaineTask,
  useListElaineTasks,
  type ElaineTask,
  type ElaineTaskState,
} from "@workspace/api-client-react";
import { ElaineName } from "@workspace/elaine-ui";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

const STATE_LABELS: Record<ElaineTaskState, string> = {
  queued: "Queued",
  running: "Running",
  waiting_for_user: "Waiting",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function TaskStatusIcon({ state }: { state: ElaineTaskState }) {
  if (state === "running") return <Loader2 className="h-4 w-4 animate-spin" />;
  if (state === "completed") return <CheckCircle2 className="h-4 w-4" />;
  if (state === "failed" || state === "blocked")
    return <AlertCircle className="h-4 w-4" />;
  if (state === "cancelled") return <Ban className="h-4 w-4" />;
  return <Clock3 className="h-4 w-4" />;
}

function citationLabel(citation: string): string {
  try {
    return new URL(citation).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function TaskCard({
  task,
  onChanged,
}: {
  task: ElaineTask;
  onChanged: () => void;
}) {
  const cancelTask = useCancelElaineTask();
  const cancellable = task.state === "queued" || task.state === "running";

  return (
    <article className="space-y-4 rounded-xl border border-card-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-foreground">{task.goal}</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Task #{task.id} · started{" "}
            {new Date(task.createdAt).toLocaleString()}
          </p>
        </div>
        <Badge variant="outline" className="gap-1.5">
          <TaskStatusIcon state={task.state} />
          {STATE_LABELS[task.state]}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{task.progressMessage ?? "Waiting to start"}</span>
          <span>{task.progressPercent}%</span>
        </div>
        <Progress value={task.progressPercent} />
      </div>

      {task.answer && (
        <div className="rounded-lg bg-muted/40 p-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            {task.answer}
          </p>
        </div>
      )}

      {task.errorMessage && (
        <p className="text-sm text-destructive">{task.errorMessage}</p>
      )}

      {task.citations.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Sources
          </p>
          <div className="flex flex-wrap gap-2">
            {task.citations.map((citation) => (
              <a
                key={citation}
                href={citation}
                target="_blank"
                rel="noreferrer"
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-primary hover:underline"
              >
                <span className="truncate">{citationLabel(citation)}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Attempt {Math.max(task.attemptCount, 1)} of {task.maxAttempts}
        </span>
        {cancellable && (
          <Button
            variant="outline"
            size="sm"
            disabled={cancelTask.isPending}
            onClick={() =>
              cancelTask.mutate(task.id, {
                onSuccess: () => {
                  toast.success("Task cancelled");
                  onChanged();
                },
                onError: () => toast.error("The task could not be cancelled"),
              })
            }
          >
            <Ban className="mr-1.5 h-3.5 w-3.5" />
            Cancel
          </Button>
        )}
      </div>
    </article>
  );
}

export default function Tasks() {
  const queryClient = useQueryClient();
  const tasksQuery = useListElaineTasks({
    query: {
      queryKey: getListElaineTasksQueryKey(),
      refetchInterval: (query) => {
        const tasks = query.state.data?.tasks ?? [];
        return tasks.some(
          (task) => task.state === "queued" || task.state === "running",
        )
          ? 3_000
          : false;
      },
    },
  });
  const tasks = tasksQuery.data?.tasks ?? [];
  const refresh = () => {
    void queryClient.invalidateQueries({
      queryKey: getListElaineTasksQueryKey(),
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
          <SearchCheck className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-serif font-semibold">
            <ElaineName /> Tasks
          </h1>
          <p className="text-sm text-muted-foreground">
            Durable research that can continue safely in the background
          </p>
        </div>
        <Button
          className="ml-auto"
          variant="outline"
          size="sm"
          onClick={() => void tasksQuery.refetch()}
          disabled={tasksQuery.isFetching}
        >
          <RefreshCw
            className={`mr-1.5 h-3.5 w-3.5 ${tasksQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {tasksQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <SearchCheck className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No background tasks yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask Elaine for multi-source research and confirm the task when she
            proposes it.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onChanged={refresh} />
          ))}
        </div>
      )}
    </div>
  );
}
