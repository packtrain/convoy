import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface SettingsCatalogCategory {
  name: string;
  count: number;
}

interface SettingsCatalogCategoryNavProps {
  ariaLabel: string;
  categories: SettingsCatalogCategory[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
}

export function SettingsCatalogCategoryNav({
  ariaLabel,
  categories,
  selectedCategory,
  onSelectCategory,
}: SettingsCatalogCategoryNavProps) {
  return (
    <nav aria-label={ariaLabel} className="min-w-0">
      <div className="flex gap-1 overflow-x-auto pb-1 md:block md:space-y-1 md:overflow-visible md:pb-0">
        {categories.map((category) => {
          const isSelected = category.name === selectedCategory;

          return (
            <Button
              key={category.name}
              type="button"
              variant="ghost"
              size="sm"
              aria-current={isSelected ? "page" : undefined}
              className={cn(
                "h-8 w-auto flex-none justify-between gap-2 rounded-md px-2 md:w-full",
                isSelected && "bg-muted text-foreground"
              )}
              onClick={() => onSelectCategory(category.name)}
            >
              <span className="truncate">{category.name}</span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
                {category.count}
              </span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
