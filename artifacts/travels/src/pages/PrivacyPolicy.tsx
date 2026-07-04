import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-10 space-y-8">
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <div className="space-y-2">
          <h1 className="font-serif text-3xl text-foreground">Privacy Policy</h1>
          <p className="text-sm text-muted-foreground">Last updated July 4, 2026</p>
        </div>

        <div className="space-y-6 text-sm leading-relaxed text-foreground/90">
          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">Who we are</h2>
            <p>
              Travels is a private, household-only travel planning application. It is not a
              public service — access is limited to invited household members, and no data is
              sold, shared with advertisers, or used for purposes outside the features described
              below.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">What we collect</h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>
                <span className="font-medium text-foreground">Account information:</span> your
                email address, display name, and a securely hashed password (or your Google
                account identity, if you sign in with Google).
              </li>
              <li>
                <span className="font-medium text-foreground">Travel data you enter:</span> trips,
                destinations, reminders, notes, itineraries, and any documents or photos you
                upload (tickets, confirmations, boarding passes, etc.).
              </li>
              <li>
                <span className="font-medium text-foreground">Calendar data (optional):</span> if
                you connect Google Calendar, we read your calendar events to suggest trips and
                display a combined household travel calendar.
              </li>
              <li>
                <span className="font-medium text-foreground">Gmail data (optional, opt-in):</span>{" "}
                if you explicitly connect your Gmail account, we search for travel-related emails
                (flight, train, and hotel confirmations) using narrow, keyword-scoped queries. We
                only read the specific emails our search returns — we do not download or store
                your full inbox. Extracted details (dates, confirmation numbers, provider names)
                are used solely to suggest trip associations and pre-fill trip documents. You
                review every suggestion before anything is saved as a trip document, and you can
                disconnect Gmail access at any time.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">
              How Gmail data is used and protected
            </h2>
            <ul className="list-disc pl-5 space-y-1.5">
              <li>Gmail access requires your explicit, separate consent (a distinct OAuth grant from Calendar).</li>
              <li>
                We use the read-only Gmail scope and only ever read messages — we never send,
                delete, or modify anything in your mailbox.
              </li>
              <li>
                Emails you dismiss or ignore are permanently recorded as "not travel-related" and
                are never re-surfaced by future scans.
              </li>
              <li>
                Emails and attachments you choose to link become trip documents visible only to
                your household's Travels account, stored the same way as manually uploaded
                documents.
              </li>
              <li>
                We never associate the same booking across household members more than once — if
                one person's inbox surfaces a confirmation another member already linked, it is
                automatically treated as a duplicate.
              </li>
              <li>You can disconnect Gmail at any time from Settings, which stops all future scanning immediately.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">How we use AI</h2>
            <p>
              We use third-party AI providers to extract structured details (dates, provider
              names, confirmation numbers) from documents, photos, and travel-related emails you
              choose to import. Only the content necessary for extraction is sent to these
              providers — never your full mailbox or unrelated account data.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">Data sharing within your household</h2>
            <p>
              Travels is designed for shared use within one household. Some data (such as the
              shared travel calendar and trips) is visible to all household members by design.
              Your individual Gmail connection, Gmail scan results, and personal timezone setting
              are private to your account and are never visible to other household members.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">Data retention & deletion</h2>
            <p>
              You can disconnect Google Calendar or Gmail, delete trip documents, or ask us to
              delete your account and associated data at any time. Disconnecting Gmail stops
              future scanning but keeps a record of prior decisions so previously reviewed emails
              are never re-suggested if you reconnect later.
            </p>
          </section>

          <section className="space-y-2">
            <h2 className="font-semibold text-foreground text-base">Contact</h2>
            <p>
              This is a private household application. If you have questions about your data,
              contact the household member who administers the account.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
