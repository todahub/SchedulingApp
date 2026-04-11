import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type OrganizerPageProps = {
  params: Promise<{
    eventId: string;
  }>;
};

export default async function OrganizerPage({ params }: OrganizerPageProps) {
  const { eventId } = await params;
  redirect(`/events/${eventId}/results`);
}
