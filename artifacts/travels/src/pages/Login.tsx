import { useState } from "react";
import { useLocation } from "wouter";
import { useLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { MapPin } from "lucide-react";
import { toast } from "sonner";
import { queryClient } from "@/lib/query-client";

export default function Login() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    login.mutate(
      { data: { email, password } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries();
          setLocation("/");
        },
        onError: (err: any) => {
          toast.error("Login failed", {
            description: err.message || "Please check your credentials and try again."
          });
        }
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <div className="w-16 h-16 rounded-2xl bg-primary text-primary-foreground flex items-center justify-center mb-2 shadow-sm">
            <span className="font-serif text-4xl italic">T</span>
          </div>
          <h1 className="font-serif text-3xl text-foreground">Travels</h1>
          <p className="text-muted-foreground">Your family's travel memory & planning hub.</p>
        </div>

        <Card className="border-border/50 shadow-md">
          <form onSubmit={handleSubmit}>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>Sign in to your journal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input 
                  id="email" 
                  type="email" 
                  required 
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com" 
                  className="bg-card"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input 
                  id="password" 
                  type="password" 
                  required 
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="bg-card"
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button 
                type="submit" 
                className="w-full" 
                disabled={login.isPending}
              >
                {login.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          By signing in you agree to our{" "}
          <a href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </a>
          .
        </p>
      </div>
    </div>
  );
}
