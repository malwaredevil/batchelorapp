import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Loader2, ArrowLeft, Mail } from "lucide-react";
import { useForgotPassword } from "@workspace/api-client-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const forgotSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export default function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);
  const forgotPassword = useForgotPassword();

  const form = useForm<z.infer<typeof forgotSchema>>({
    resolver: zodResolver(forgotSchema),
    defaultValues: { email: "" },
  });

  async function onSubmit(data: z.infer<typeof forgotSchema>) {
    try {
      await forgotPassword.mutateAsync({ data });
      setSubmitted(true);
      toast.success("Reset link sent!");
    } catch (err: any) {
      toast.error(err.message || "Failed to send reset link");
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-4">
            <Mail className="h-6 w-6" />
          </div>
          <h1 className="text-3xl font-serif font-bold text-foreground">
            Reset Password
          </h1>
          <p className="mt-2 text-muted-foreground">
            We'll send you a link to reset your password.
          </p>
        </div>

        <div className="rounded-2xl border border-card-border bg-card p-6 shadow-xl shadow-black/5">
          {submitted ? (
            <div className="text-center">
              <p className="mb-6 text-sm text-card-foreground">
                Check your email for a reset link. If you don't see it, be sure
                to check your spam folder.
              </p>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setSubmitted(false)}
              >
                Try another email
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit(onSubmit)}
                className="space-y-4"
              >
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="you@example.com"
                          type="email"
                          {...field}
                          className="bg-background"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full"
                  disabled={forgotPassword.isPending}
                >
                  {forgotPassword.isPending && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  Send Reset Link
                </Button>
              </form>
            </Form>
          )}
        </div>

        <div className="mt-6 text-center">
          <Button
            variant="link"
            asChild
            className="text-muted-foreground hover:text-foreground"
          >
            <a href="/login" className="flex items-center gap-2">
              <ArrowLeft className="h-4 w-4" />
              Back to Sign In
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
