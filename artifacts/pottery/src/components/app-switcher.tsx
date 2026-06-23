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
  useGetStats,
  useGetCollectionStats,
} from "@workspace/api-client-react";

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

export function AppSwitcher() {
  const { data: quiltingStats } = useGetStats();
  const { data: potteryStats } = useGetCollectionStats();

  const potteryCount = potteryStats?.totalItems;
  const fabricCount = quiltingStats?.totalFabrics;

  const pillSubtitle =
    potteryCount != null ? `${potteryCount} pieces` : "Pottery Studio";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex items-center gap-2.5 rounded-xl border border-card-border px-3 py-2 hover:bg-muted transition-colors outline-none"
          data-testid="app-switcher"
        >
          <AppLogo className="h-7 w-7 shrink-0" />
          <div className="text-left leading-tight">
            <p className="text-sm font-bold leading-none">Batchelor Pottery</p>
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
          className="flex items-center gap-3 px-2 py-2.5"
          onSelect={() => {}}
        >
          <AppLogo className="h-8 w-8 shrink-0" />
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
          <Check className="h-4 w-4 text-primary shrink-0" />
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
              {fabricCount != null
                ? `${fabricCount} fabrics`
                : "Quilting Studio"}
            </p>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
