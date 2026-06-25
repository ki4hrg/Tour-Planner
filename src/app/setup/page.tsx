import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { needsSetup } from "@/lib/setup";
import { SetupForm } from "./setup-form";

// Depends on live DB state (user count) — never prerender at build time.
export const dynamic = "force-dynamic";

// First-run onboarding. Public, but locks itself once any user exists.
export default async function SetupPage() {
  if (!(await needsSetup())) {
    redirect("/login");
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Welcome to Tour Planner</CardTitle>
          <CardDescription>
            Create the first administrator account to get started.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm />
        </CardContent>
      </Card>
    </main>
  );
}
