import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Search, 
  Filter, 
  Grid3X3, 
  List, 
  Plus,
  MoreVertical,
  Store,
  Facebook,
  Gavel
} from "lucide-react";
import { cn } from "@/lib/utils";

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  platforms: string[];
  status: "listed" | "draft" | "sold";
  image: string;
}

const mockInventory: InventoryItem[] = [
  { id: "1", name: "Antique Brass Floor Lamp", category: "Lighting", price: 185, quantity: 1, platforms: ["eBay", "Facebook"], status: "listed", image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&h=200&fit=crop" },
  { id: "2", name: "Vintage Crystal Decanter Set", category: "Glassware", price: 95, quantity: 1, platforms: ["eBay"], status: "listed", image: "https://images.unsplash.com/photo-1578662996442-48f60103fc96?w=200&h=200&fit=crop" },
  { id: "3", name: "Mid-Century Modern Chair", category: "Furniture", price: 320, quantity: 2, platforms: ["LiveAuctioneers"], status: "listed", image: "https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=200&h=200&fit=crop" },
  { id: "4", name: "Sterling Silver Tea Service", category: "Silver", price: 450, quantity: 1, platforms: ["eBay", "LiveAuctioneers"], status: "draft", image: "https://images.unsplash.com/photo-1530103862676-de8c9debad1d?w=200&h=200&fit=crop" },
  { id: "5", name: "Victorian Jewelry Box", category: "Decorative", price: 125, quantity: 1, platforms: ["Facebook"], status: "listed", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=200&h=200&fit=crop" },
  { id: "6", name: "Art Deco Vanity Mirror", category: "Mirrors", price: 275, quantity: 1, platforms: ["eBay"], status: "sold", image: "https://images.unsplash.com/photo-1618220179428-22790b461013?w=200&h=200&fit=crop" },
];

const platformIcons: Record<string, typeof Store> = {
  "eBay": Store,
  "Facebook": Facebook,
  "LiveAuctioneers": Gavel,
};

const statusStyles = {
  listed: "bg-success/20 text-success border-success/30",
  draft: "bg-warning/20 text-warning border-warning/30",
  sold: "bg-muted text-muted-foreground border-border",
};

export default function Inventory() {
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredItems = mockInventory.filter(item =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <MainLayout 
      title="Inventory" 
      subtitle="Manage your items across all platforms"
    >
      <div className="space-y-6">
        {/* Toolbar */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search inventory..."
              className="pl-10"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm">
              <Filter className="mr-2 h-4 w-4" />
              Filters
            </Button>
            
            <div className="flex rounded-lg border border-border p-1">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <Grid3X3 className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="gold">
              <Plus className="mr-2 h-4 w-4" />
              Add Item
            </Button>
          </div>
        </div>

        {/* Inventory Grid */}
        <div className={cn(
          "grid gap-4",
          viewMode === "grid" ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "grid-cols-1"
        )}>
          {filteredItems.map((item, index) => (
            <div
              key={item.id}
              className={cn(
                "group relative overflow-hidden rounded-xl border border-border bg-card transition-all duration-300 hover:border-primary/30 hover:shadow-card animate-fade-in",
                viewMode === "list" && "flex"
              )}
              style={{ animationDelay: `${index * 50}ms` }}
            >
              {/* Image */}
              <div className={cn(
                "relative overflow-hidden bg-secondary",
                viewMode === "grid" ? "aspect-square" : "h-24 w-24 flex-shrink-0"
              )}>
                <img
                  src={item.image}
                  alt={item.name}
                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                />
                <Badge 
                  variant="outline" 
                  className={cn(
                    "absolute right-2 top-2 capitalize",
                    statusStyles[item.status]
                  )}
                >
                  {item.status}
                </Badge>
              </div>

              {/* Content */}
              <div className="flex flex-1 flex-col p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h3 className="truncate font-medium text-foreground">{item.name}</h3>
                    <p className="text-sm text-muted-foreground">{item.category}</p>
                  </div>
                  <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0 opacity-0 group-hover:opacity-100">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </div>

                <div className="mt-3 flex items-center justify-between">
                  <span className="text-lg font-bold text-foreground">${item.price}</span>
                  <div className="flex items-center gap-1">
                    {item.platforms.map((platform) => {
                      const Icon = platformIcons[platform] || Store;
                      return (
                        <div
                          key={platform}
                          className="flex h-6 w-6 items-center justify-center rounded bg-secondary"
                          title={platform}
                        >
                          <Icon className="h-3 w-3 text-muted-foreground" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </MainLayout>
  );
}
