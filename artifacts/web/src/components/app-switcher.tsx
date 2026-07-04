import { Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGetCollectionStats,
  useGetStats,
  useGetTravelsStats,
} from "@workspace/api-client-react";

function BLogo({ className }: { className?: string }) {
  return (
    <div
      className={`rounded-lg bg-primary flex items-center justify-center text-primary-foreground font-bold ${className}`}
    >
      B
    </div>
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
      <rect width="100" height="100" rx="22" fill="#2D5A27" />
      <rect
        x="14"
        y="14"
        width="30"
        height="30"
        rx="4"
        fill="#F0E8D8"
        fillOpacity="0.9"
      />
      <rect
        x="56"
        y="14"
        width="30"
        height="30"
        rx="4"
        fill="#F0E8D8"
        fillOpacity="0.55"
      />
      <rect
        x="14"
        y="56"
        width="30"
        height="30"
        rx="4"
        fill="#F0E8D8"
        fillOpacity="0.55"
      />
      <rect
        x="56"
        y="56"
        width="30"
        height="30"
        rx="4"
        fill="#F0E8D8"
        fillOpacity="0.9"
      />
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

export function AppSwitcher() {
  const { data: potteryStats } = useGetCollectionStats();
  const { data: quiltingStats } = useGetStats();
  const { data: travelsStats } = useGetTravelsStats();

  const potteryCount = potteryStats?.totalItems;
  const fabricCount = quiltingStats?.totalFabrics;
  const tripCount = travelsStats?.totalTrips;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 rounded-xl border border-border px-3 py-2 hover:bg-muted transition-colors outline-none"
          data-testid="hub-app-switcher"
        >
          <BLogo className="h-7 w-7 shrink-0 text-base" />
          <div className="text-left leading-tight hidden sm:block">
            <p className="text-sm font-bold leading-none text-primary">
              Batchelor Hub
            </p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Your collections
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64 p-1">
        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5"
          onSelect={() => {}}
        >
          <BLogo className="h-8 w-8 shrink-0 text-lg" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">Batchelor Hub</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              One account, every collection.
            </p>
          </div>
          <Check className="h-4 w-4 text-primary shrink-0" />
        </DropdownMenuItem>

        <div className="my-1 h-px bg-border" />

        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5 cursor-pointer"
          onSelect={() => {
            window.location.href = "/pottery/";
          }}
        >
          <PotteryLogo className="h-8 w-8 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">
              Batchelor Pottery
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {potteryCount != null
                ? `${potteryCount} pieces`
                : "Pottery Studio"}
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5 cursor-pointer"
          onSelect={() => {
            window.location.href = "/quilting/";
          }}
        >
          <QuiltingLogo className="h-8 w-8 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">
              Ashley&apos;s Quilting
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {fabricCount != null
                ? `${fabricCount} fabrics`
                : "Quilting Studio"}
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5 cursor-pointer"
          onSelect={() => {
            window.location.href = "/travels/";
          }}
        >
          <TravelsLogo className="h-8 w-8 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">
              Batchelor Travels
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {tripCount != null ? `${tripCount} trips` : "Travel Journal"}
            </p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
