import type { ComponentType } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import {
  useGetCollectionStats,
  useGetStats,
  useGetTravelsStats,
  useGetOrnamentStats,
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { ElaineAvatar } from "./ElaineAvatar";

export type AppId =
  | "hub"
  | "pottery"
  | "quilting"
  | "travels"
  | "ornaments"
  | "elaine"
  | "gmail";

function HubLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
      <text
        x="50"
        y="50"
        dominantBaseline="central"
        textAnchor="middle"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
        fontWeight="700"
        fontSize="58"
        fill="#F0E8D8"
      >
        B
      </text>
    </svg>
  );
}

function PotteryLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
      <ellipse
        cx="50"
        cy="41"
        rx="30"
        ry="8"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
      />
      <path
        d="M20 41 Q20 72 50 74 Q80 72 80 41"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
        strokeLinecap="round"
      />
      <line
        x1="38"
        y1="74"
        x2="62"
        y2="74"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function QuiltingLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
      <g transform="rotate(30, 74, 50)">
        <rect x="71.5" y="16" width="5" height="68" rx="2.5" fill="#D8D8D8" />
        <ellipse
          cx="74"
          cy="22"
          rx="2"
          ry="3.5"
          fill="none"
          stroke="#1B3A5C"
          strokeWidth="1.5"
        />
        <polygon points="74,84 70,76 78,76" fill="#A8A8A8" />
      </g>
      <path
        d="M80 28 Q70 20 52 28"
        stroke="#F0E8D8"
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
      <rect x="22" y="22" width="48" height="12" rx="5" fill="#3D2010" />
      <rect x="30" y="34" width="32" height="32" fill="#C17A3E" />
      <line
        x1="30"
        y1="41"
        x2="62"
        y2="41"
        stroke="#F0E8D8"
        strokeWidth="2.2"
        opacity="0.75"
      />
      <line
        x1="30"
        y1="49"
        x2="62"
        y2="49"
        stroke="#F0E8D8"
        strokeWidth="2.2"
        opacity="0.75"
      />
      <line
        x1="30"
        y1="57"
        x2="62"
        y2="57"
        stroke="#F0E8D8"
        strokeWidth="2.2"
        opacity="0.75"
      />
      <rect x="22" y="66" width="48" height="12" rx="5" fill="#3D2010" />
    </svg>
  );
}

function TravelsLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B4E6B" />
      <polygon
        points="18,50 82,22 56,78"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
        strokeLinejoin="round"
      />
      <line
        x1="18"
        y1="50"
        x2="56"
        y2="78"
        stroke="#F0E8D8"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}

function OrnamentsLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#7C3F2E" />
      <rect x="44" y="16" width="12" height="10" rx="3" fill="#F0E8D8" />
      <circle
        cx="50"
        cy="58"
        r="26"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
      />
      <path
        d="M32 46 L68 46"
        stroke="#F0E8D8"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ElaineLogo({ className }: { className?: string }) {
  return <ElaineAvatar className={className} size={32} />;
}

function GmailLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#1B3A5C" />
      {/* Envelope body */}
      <rect
        x="18"
        y="30"
        width="64"
        height="42"
        rx="5"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
      />
      {/* Envelope flap V */}
      <polyline
        points="18,30 50,56 82,30"
        stroke="#F0E8D8"
        strokeWidth="3.5"
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

interface AppEntry {
  id: AppId;
  name: string;
  subtitle: string;
  href: string;
  Logo: ComponentType<{ className?: string }>;
}

function useApps(): AppEntry[] {
  const { data: potteryStats } = useGetCollectionStats();
  const { data: quiltingStats } = useGetStats();
  const { data: ornamentsStats } = useGetOrnamentStats();
  const { data: travelsStats } = useGetTravelsStats();

  const potteryCount = potteryStats?.totalItems;
  const fabricCount = quiltingStats?.totalFabrics;
  const tripCount = travelsStats?.totalTrips;
  const ornamentsCount = ornamentsStats?.totalItems;

  return [
    {
      id: "hub",
      name: "Batchelor Hub",
      subtitle: "Home — all your collections",
      href: "/",
      Logo: HubLogo,
    },
    {
      id: "pottery",
      name: "Batchelor Pottery",
      subtitle:
        potteryCount != null ? `${potteryCount} pieces` : "Pottery Studio",
      href: "/pottery/",
      Logo: PotteryLogo,
    },
    {
      id: "quilting",
      name: "Ashley's Quilting",
      subtitle:
        fabricCount != null ? `${fabricCount} fabrics` : "Quilting Studio",
      href: "/quilting/",
      Logo: QuiltingLogo,
    },
    {
      id: "travels",
      name: "Batchelor Travels",
      subtitle: tripCount != null ? `${tripCount} trips` : "Travel Journal",
      href: "/travels/",
      Logo: TravelsLogo,
    },
    {
      id: "ornaments",
      name: "Batchelor Ornaments",
      subtitle:
        ornamentsCount != null ? `${ornamentsCount} ornaments` : "Ornament Collection",
      href: "/ornaments/",
      Logo: OrnamentsLogo,
    },
    {
      id: "elaine",
      name: "Elaine",
      subtitle: "Your AI assistant",
      href: "/elaine/",
      Logo: ElaineLogo,
    },
    {
      id: "gmail",
      name: "Gmail",
      subtitle: "Your inbox",
      href: "/gmail",
      Logo: GmailLogo,
    },
  ];
}

/**
 * Shared app-switcher pill + dropdown used consistently across every
 * artifact (Hub, Pottery, Quilting, Travels, Elaine). Lists all apps with a
 * checkmark next to whichever one is currently active; every other entry
 * navigates via a full page load (`window.location.href`) since each app is
 * a separate SPA bundle — client-side router navigation cannot cross that
 * boundary.
 */
export function AppSwitcher({
  currentAppId,
  className,
}: {
  currentAppId: AppId;
  className?: string;
}) {
  const apps = useApps();
  const current = apps.find((a) => a.id === currentAppId) ?? apps[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            "flex items-center gap-2.5 rounded-xl border border-card-border px-3 py-2 hover:bg-muted transition-colors outline-none",
            className,
          )}
          data-testid="app-switcher"
        >
          <current.Logo className="h-7 w-7 shrink-0" />
          <div className="text-left leading-tight hidden sm:block">
            <p className="text-sm font-bold leading-none">{current.name}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {current.subtitle}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64 p-1">
        {apps.map((app) => {
          const isCurrent = app.id === currentAppId;
          return (
            <DropdownMenuItem
              key={app.id}
              className={cn(
                "flex items-center gap-3 px-2 py-2.5",
                !isCurrent && "cursor-pointer",
              )}
              onSelect={
                isCurrent
                  ? () => {}
                  : () => {
                      window.location.href = app.href;
                    }
              }
            >
              <app.Logo className="h-8 w-8 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold leading-none">{app.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {app.subtitle}
                </p>
              </div>
              {isCurrent && <Check className="h-4 w-4 text-primary shrink-0" />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
