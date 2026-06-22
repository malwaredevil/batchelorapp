import { useState } from "react";
import { useChangePassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound } from "lucide-react";

export default function Account() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const changePassword = useChangePassword({
    mutation: {
      onSuccess: () => {
        toast.success("Password changed successfully.");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      },
      onError: (err: unknown) => {
        const msg =
          (err as { data?: { error?: string } })?.data?.error ??
          "Could not change password. Please try again.";
        toast.error(msg);
      },
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }
    changePassword.mutate({ data: { currentPassword, newPassword } });
  }

  return (
    <div className="mx-auto max-w-lg space-y-8 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your sign-in password.
        </p>
      </div>

      <form
        onSubmit={handleSubmit}
        className="space-y-5 rounded-xl border border-card-border bg-card p-6 shadow-sm"
      >
        <div className="flex items-center gap-2 text-sm font-semibold">
          <KeyRound className="h-4 w-4 text-primary" />
          Change Password
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="current-password"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Current Password
          </Label>
          <Input
            id="current-password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
            className="h-11 bg-muted/60"
          />
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="new-password"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            New Password
          </Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={8}
            className="h-11 bg-muted/60"
          />
        </div>

        <div className="space-y-2">
          <Label
            htmlFor="confirm-password"
            className="text-xs font-semibold uppercase tracking-wider text-muted-foreground"
          >
            Confirm New Password
          </Label>
          <Input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
            className="h-11 bg-muted/60"
          />
        </div>

        <Button
          type="submit"
          className="h-11 w-full font-semibold"
          disabled={changePassword.isPending}
        >
          {changePassword.isPending && (
            <Loader2 className="h-4 w-4 animate-spin" />
          )}
          Update Password
        </Button>
      </form>
    </div>
  );
}
