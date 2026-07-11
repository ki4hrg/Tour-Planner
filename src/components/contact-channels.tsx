import { Mail, MessageCircle, Phone } from "lucide-react";
import { cn } from "@/lib/utils";
import { isE164, phoneDigits } from "@/lib/dial-codes";

// One-tap reach-out links for a contact: Call (any phone), WhatsApp (only when
// the number is E.164 — wa.me needs a full international number), Email. Plain
// anchors, so this renders fine from Server Components. Renders nothing when
// the contact has no channels.
export function ContactChannels({
  phone,
  email,
  className,
}: {
  phone?: string | null;
  email?: string | null;
  className?: string;
}) {
  if (!phone && !email) return null;
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {phone ? (
        <ChannelLink href={`tel:${phone}`} label={`Call ${phone}`}>
          <Phone className="size-3.5" />
        </ChannelLink>
      ) : null}
      {isE164(phone) ? (
        <ChannelLink
          href={`https://wa.me/${phoneDigits(phone)}`}
          label={`WhatsApp ${phone}`}
          external
        >
          <MessageCircle className="size-3.5" />
        </ChannelLink>
      ) : null}
      {email ? (
        <ChannelLink href={`mailto:${email}`} label={`Email ${email}`}>
          <Mail className="size-3.5" />
        </ChannelLink>
      ) : null}
    </span>
  );
}

function ChannelLink({
  href,
  label,
  external,
  children,
}: {
  href: string;
  label: string;
  external?: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      aria-label={label}
      title={label}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
      className="inline-flex size-7 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
    </a>
  );
}
