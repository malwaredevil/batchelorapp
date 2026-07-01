import { Home, Check, ChevronDown } from "lucide-react";
import { AppLogo } from "@/components/app-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  useGetTravelsStats,
  useGetCollectionStats,
  useGetStats,
} from "@workspace/api-client-react";

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
      <rect x="14" y="14" width="30" height="30" rx="4" fill="#F0E8D8" fillOpacity="0.9" />
      <rect x="56" y="14" width="30" height="30" rx="4" fill="#F0E8D8" fillOpacity="0.55" />
      <rect x="14" y="56" width="30" height="30" rx="4" fill="#F0E8D8" fillOpacity="0.55" />
      <rect x="56" y="56" width="30" height="30" rx="4" fill="#F0E8D8" fillOpacity="0.9" />
    </svg>
  );
}

export function AppSwitcher() {
  const { data: travelsStats } = useGetTravelsStats();
  const { data: potteryStats } = useGetCollectionStats();
  const { data: quiltingStats } = useGetStats();

  const tripCount = travelsStats?.totalTrips;
  const potteryCount = potteryStats?.totalItems;
  const fabricCount = quiltingStats?.totalFabrics;

  const pillSubtitle =
    tripCount != null ? `${tripCount} trips` : "Travel Journal";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 rounded-xl border border-card-border px-3 py-2 hover:bg-muted transition-colors outline-none"
          data-testid="app-switcher"
        >
          <AppLogo className="h-7 w-7 shrink-0" />
          <div className="text-left leading-tight hidden sm:block">
            <p className="text-sm font-bold leading-none">Batchelor Travels</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {pillSubtitle}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 text-muted-foreground ml-1" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="start" className="w-64 p-1">
        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5 cursor-pointer"
          onSelect={() => {
            window.location.href = "/";
          }}
        >
          <div className="h-8 w-8 rounded-lg bg-foreground text-background flex items-center justify-center shrink-0">
            <Home className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">Batchelor Hub</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Home — all your collections
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

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
              {potteryCount != null ? `${potteryCount} pieces` : "Pottery Studio"}
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
              Ashley's Quilting
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {fabricCount != null ? `${fabricCount} fabrics` : "Quilting Studio"}
            </p>
          </div>
        </DropdownMenuItem>

        <DropdownMenuItem
          className="flex items-center gap-3 px-2 py-2.5"
          onSelect={() => {}}
        >
          <AppLogo className="h-8 w-8 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold leading-none">
              Batchelor Travels
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {tripCount != null ? `${tripCount} trips` : "Travel Journal"}
            </p>
          </div>
          <Check className="h-4 w-4 text-primary shrink-0" />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
