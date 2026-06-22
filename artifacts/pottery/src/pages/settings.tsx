import { Link } from "wouter";
import { Tag, Wrench, KeyRound, ChevronRight } from "lucide-react";

const SETTINGS_ITEMS = [
  {
    href: "/categories",
    label: "Categories",
    description: "Manage piece categories and colours",
    icon: Tag,
  },
  {
    href: "/maintenance",
    label: "Maintenance",
    description: "Bulk re-analyse pieces in the collection",
    icon: Wrench,
  },
  {
    href: "/account",
    label: "Account",
    description: "Change your sign-in password",
    icon: KeyRound,
  },
];

export default function Settings() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight">Settings</h1>

      <ul className="mt-6 divide-y divide-card-border rounded-xl border border-card-border bg-card shadow-sm">
        {SETTINGS_ITEMS.map((item) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-muted/40"
            >
              <item.icon className="h-5 w-5 shrink-0 text-muted-foreground" />
              <div className="flex-1">
                <p className="font-medium">{item.label}</p>
                <p className="text-sm text-muted-foreground">
                  {item.description}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
