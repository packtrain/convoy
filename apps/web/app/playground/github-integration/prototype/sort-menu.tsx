import { ArrowDownWideNarrow, ArrowUpNarrowWide } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function SortMenu({
  field,
  order,
  onField,
  onOrder,
}: {
  field: string;
  order: string;
  onField: (value: string) => void;
  onOrder: (value: string) => void;
}) {
  const Icon = order === "newest" ? ArrowDownWideNarrow : ArrowUpNarrowWide;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="settings"
          aria-label="Sort pull requests"
          title={`Sort by ${field === "createdAt" ? "created on" : "last updated"}`}
        >
          <Icon />
          {order === "newest" ? "Newest" : "Oldest"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={field} onValueChange={onField}>
          <DropdownMenuRadioItem value="createdAt">Created on</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updatedAt">Last updated</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Order</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={order} onValueChange={onOrder}>
          <DropdownMenuRadioItem value="oldest">
            <ArrowUpNarrowWide />
            Oldest
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="newest">
            <ArrowDownWideNarrow />
            Newest
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
