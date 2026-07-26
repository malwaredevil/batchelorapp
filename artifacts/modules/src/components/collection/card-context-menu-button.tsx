import { MoreVertical } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CardContextMenuButtonProps {
  children: React.ReactNode;
}

export function CardContextMenuButton({
  children,
}: CardContextMenuButtonProps) {
  return (
    <div className="absolute right-2 top-2 z-10 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-full bg-background/85 text-foreground shadow-sm backdrop-blur"
            aria-label="Options"
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        {children}
      </DropdownMenu>
    </div>
  );
}
