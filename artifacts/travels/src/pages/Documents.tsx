import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Mail, Trash2, Link2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import {
  useListUnmatchedDocuments,
  useAssignUnmatchedDocument,
  useDeleteUnmatchedDocument,
  useListTrips,
  getListUnmatchedDocumentsQueryKey,
  getGetUnmatchedDocumentsCountQueryKey,
  type TravelsTripDocument as TripDocument,
} from "@workspace/api-client-react";
import { usePageAssistantContext } from "@/lib/assistant-context";

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function DocumentCard({
  doc,
  trips,
  onAssigned,
  onDeleted,
}: {
  doc: TripDocument;
  trips: { id: number; name: string }[];
  onAssigned: () => void;
  onDeleted: () => void;
}) {
  const [selectedTripId, setSelectedTripId] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const assign = useAssignUnmatchedDocument({
    mutation: {
      onSuccess: () => {
        toast.success("Document assigned to trip");
        onAssigned();
      },
      onError: () => toast.error("Could not assign document. Please try again."),
    },
  });

  const remove = useDeleteUnmatchedDocument({
    mutation: {
      onSuccess: () => {
        toast.success("Document discarded");
        onDeleted();
      },
      onError: () => toast.error("Could not discard document. Please try again."),
    },
  });

  return (
    <div className="rounded-xl border border-card-border bg-card p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <FileText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-sm">
            {doc.title || doc.originalFilename || "Untitled document"}
          </p>
          {doc.sourceEmailFrom && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground truncate mt-0.5">
              <Mail className="h-3 w-3 flex-shrink-0" />
              {doc.sourceEmailFrom}
            </p>
          )}
          {doc.sourceEmailSubject && (
            <p className="truncate text-xs text-muted-foreground mt-0.5">
              {doc.sourceEmailSubject}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-0.5">
            Received {formatDate(doc.sourceReceivedAt || doc.createdAt)}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Select value={selectedTripId} onValueChange={setSelectedTripId}>
          <SelectTrigger className="h-9 flex-1">
            <SelectValue placeholder="Assign to a trip..." />
          </SelectTrigger>
          <SelectContent>
            {trips.map((trip) => (
              <SelectItem key={trip.id} value={String(trip.id)}>
                {trip.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          disabled={!selectedTripId || assign.isPending}
          onClick={() =>
            assign.mutate({
              docId: doc.id,
              data: { tripId: Number(selectedTripId) },
            })
          }
        >
          {assign.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Link2 className="h-4 w-4" />
          )}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={() => setConfirmDelete(true)}
          disabled={remove.isPending}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "
              {doc.title || doc.originalFilename || "this document"}". This
              can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => remove.mutate({ docId: doc.id })}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Documents() {
  const queryClient = useQueryClient();

  const { data: documents, isLoading } = useListUnmatchedDocuments();
  const { data: trips } = useListTrips();

  const tripOptions = useMemo(
    () => (trips ?? []).map((t) => ({ id: t.id, name: t.title })),
    [trips],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({
      queryKey: getListUnmatchedDocumentsQueryKey(),
    });
    queryClient.invalidateQueries({
      queryKey: getGetUnmatchedDocumentsCountQueryKey(),
    });
  };

  usePageAssistantContext(
    "documents-triage",
    `The user is viewing the Documents triage inbox: ${
      documents?.length ?? 0
    } document(s) forwarded by email could not be automatically matched to a trip and are waiting for manual assignment.`,
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Documents</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Booking confirmations forwarded by email that couldn't be
          automatically matched to a trip. Assign them below or discard.
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : !documents || documents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-card-border py-16 text-center text-muted-foreground">
          <FileText className="mx-auto h-8 w-8 mb-2 opacity-50" />
          <p className="text-sm">Nothing to triage right now.</p>
          <p className="text-xs mt-1">
            Forward a booking confirmation email to Elaine and it'll show up
            here if it can't be auto-matched.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((doc) => (
            <DocumentCard
              key={doc.id}
              doc={doc}
              trips={tripOptions}
              onAssigned={invalidate}
              onDeleted={invalidate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
