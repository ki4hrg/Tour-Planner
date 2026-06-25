import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Home() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Dashboard</CardTitle>
        <CardDescription>
          Upcoming trips, today&apos;s shortcut, and booking alerts will appear
          here.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        You&apos;re signed in. Sites, trips, and the booking dashboard arrive in
        the next milestones.
      </CardContent>
    </Card>
  );
}
