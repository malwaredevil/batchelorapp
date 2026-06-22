import {
  Cloud,
  Newspaper,
  Rss,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode } from "react";

const base = import.meta.env.BASE_URL;

export type AppStat = { value: string; label: string };

export type AppEntry = {
  id: string;
  name: string;
  href: string;
  image: string;
  updated: string;
  stats: AppStat[];
  description: string;
};

/* Modular config: apps render from this array, so a new app is one entry here. */
export const APPS: AppEntry[] = [
  {
    id: "pottery",
    name: "Pottery",
    href: `${base}pottery`,
    image: `${base}images/pottery-collection.png`,
    updated: "Updated 2h ago",
    stats: [
      { value: "163", label: "Pieces" },
      { value: "12", label: "Categories" },
    ],
    description:
      "Your complete catalogue of handmade ceramics. AI semantic search and photo comparison.",
  },
  {
    id: "quilting",
    name: "Quilting",
    href: `${base}quilting`,
    image: `${base}images/quilting-collection.png`,
    updated: "Updated 1d ago",
    stats: [
      { value: "48", label: "Fabrics" },
      { value: "9", label: "Patterns" },
      { value: "5", label: "Quilts" },
    ],
    description:
      "Manage your fabric stash, organize patterns, plan layouts, and track finished projects.",
  },
];

export type WidgetEntry = {
  id: string;
  title: string;
  icon: LucideIcon;
  body: ReactNode;
};

/* Modular config: dashboard widgets render from this array. */
export const WIDGETS: WidgetEntry[] = [
  {
    id: "weather",
    title: "Studio Weather",
    icon: Cloud,
    body: (
      <div className="flex items-end justify-between">
        <div>
          <div className="text-3xl font-bold text-foreground">18°</div>
          <div className="text-sm text-muted-foreground">Cloudy · Bristol</div>
        </div>
        <Cloud className="w-10 h-10 text-muted-foreground/60" />
      </div>
    ),
  },
  {
    id: "news",
    title: "Maker News",
    icon: Newspaper,
    body: (
      <ul className="space-y-2 text-sm">
        <li className="text-foreground leading-snug">Glaze chemistry: reduction firing basics</li>
        <li className="text-muted-foreground leading-snug">5 quilt-binding techniques compared</li>
      </ul>
    ),
  },
  {
    id: "rss",
    title: "RSS · Craft Feeds",
    icon: Rss,
    body: (
      <ul className="space-y-2 text-sm">
        <li className="flex items-center gap-2 text-foreground leading-snug">
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
          Studio Pottery Weekly — new issue
        </li>
        <li className="flex items-center gap-2 text-muted-foreground leading-snug">
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
          Modern Quilting Blog — 3 posts
        </li>
      </ul>
    ),
  },
];
