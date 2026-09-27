import { redirect } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { needsSetup } from "@/lib/setup";
import { LoginForm } from "./login-form";

// Checks live DB state (whether any user exists) — never prerender.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // No users yet → send to first-run setup instead of an unusable login.
  if (await needsSetup()) {
    redirect("/setup");
  }

  const { callbackUrl } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Tour Planner</CardTitle>
        </CardHeader>
        <CardContent>
          <LoginForm callbackUrl={callbackUrl ?? "/"} />
        </CardContent>
      </Card>
    </main>
  );
}
