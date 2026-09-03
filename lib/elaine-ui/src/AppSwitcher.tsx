import type { ComponentType } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@workspace/web-core/utils";
import { crossAppUrl } from "@workspace/web-core/cross-app";
import {
  useGetCollectionStats,
  useGetStats,
  useGetTravelsStats,
  useGetOrnamentStats,
  useListMagnets,
} from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@workspace/ui";
import { ElaineAvatar } from "./ElaineAvatar";
import { AppTileLogo } from "./AppTileLogo";

export type AppId =
  // scaffold:anchor:app-ids — scaffold-collection-module inserts app ids below; do not remove
  // scaffold:begin:magnets
  | "magnets"
  // scaffold:end:magnets
  | "hub"
  | "pottery"
  | "quilting"
  | "travels"
  | "ornaments"
  | "elaine"
  | "gmail"
  | "office"
  | "modules";

/**
 * Fallback logo used by scaffolded collection modules until they get a
 * bespoke logo — a neutral rounded tile with the module's initial.
 */
export function GenericModuleLogo({
  initial,
  className,
}: {
  initial: string;
  className?: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      className={className}
      aria-hidden="true"
    >
      <rect width="100" height="100" rx="22" fill="#4A5568" />
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
        {initial}
      </text>
    </svg>
  );
}
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
  return <AppTileLogo app="pottery" className={className} />;
}

function QuiltingLogo({ className }: { className?: string }) {
  return <AppTileLogo app="quilting" className={className} />;
}

function TravelsLogo({ className }: { className?: string }) {
  return <AppTileLogo app="travels" className={className} />;
}

function OrnamentsLogo({ className }: { className?: string }) {
  return <AppTileLogo app="ornaments" className={className} />;
}

function ElaineLogo({ className }: { className?: string }) {
  return <ElaineAvatar className={className} size={32} />;
}

function OfficeLogo({ className }: { className?: string }) {
  return <AppTileLogo app="office" className={className} />;
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
  const { data: magnetsList } = useListMagnets({});

  const potteryCount = potteryStats?.totalItems;
  const fabricCount = quiltingStats?.totalFabrics;
  const tripCount = travelsStats?.totalTrips;
  const ornamentsCount = ornamentsStats?.totalItems;
  const magnetsCount = magnetsList?.total;

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
      href: "/modules/pottery/",
      Logo: PotteryLogo,
    },
    {
      id: "quilting",
      name: "Ashley's Quilting",
      subtitle:
        fabricCount != null ? `${fabricCount} fabrics` : "Quilting Studio",
      href: "/modules/quilting/",
      Logo: QuiltingLogo,
    },
    {
      id: "travels",
      name: "Batchelor Travels",
      subtitle: tripCount != null ? `${tripCount} trips` : "Travel Journal",
      href: "/modules/travels/",
      Logo: TravelsLogo,
    },
    {
      id: "ornaments",
      name: "Batchelor Ornaments",
      subtitle:
        ornamentsCount != null
          ? `${ornamentsCount} ornaments`
          : "Ornament Collection",
      href: "/modules/ornaments/",
      Logo: OrnamentsLogo,
    },
    {
      id: "office",
      name: "Office",
      subtitle: "Gmail, calendars & notes",
      href: "/modules/office/",
      Logo: OfficeLogo,
    },
    {
      id: "elaine",
      name: "Elaine",
      subtitle: "Your AI assistant",
      href: "/elaine/",
      Logo: ElaineLogo,
    },
    // scaffold:anchor:app-entries — scaffold-collection-module inserts app entries below; do not remove
    // scaffold:begin:magnets
    {
      id: "magnets",
      name: "Batchelor Magnets",
      subtitle:
        magnetsCount != null ? `${magnetsCount} magnets` : "Magnet Collection",
      href: "/modules/magnets/",
      Logo: ({ className }) => (
        <GenericModuleLogo initial="M" className={className} />
      ),
    },
    // scaffold:end:magnets
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
    <DropdownMenu modal={false}>
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
                      window.location.href = crossAppUrl(app.href);
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
