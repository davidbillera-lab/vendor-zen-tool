import { useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { 
  Upload, 
  Store, 
  Facebook, 
  Gavel,
  Image as ImageIcon,
  DollarSign,
  Tag,
  FileText,
  Sparkles
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

const platforms = [
  { id: "ebay", name: "eBay", icon: Store, color: "border-platform-ebay bg-platform-ebay/10" },
  { id: "facebook", name: "Facebook Marketplace", icon: Facebook, color: "border-platform-facebook bg-platform-facebook/10" },
  { id: "liveauctioneers", name: "LiveAuctioneers", icon: Gavel, color: "border-platform-auction bg-platform-auction/10" },
  { id: "denver", name: "Denver Online Auctions", icon: Gavel, color: "border-platform-auction bg-platform-auction/10" },
];

export default function CreateListing() {
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(["ebay"]);
  const [formData, setFormData] = useState({
    title: "",
    description: "",
    price: "",
    category: "",
    condition: "",
  });

  const togglePlatform = (platformId: string) => {
    setSelectedPlatforms(prev =>
      prev.includes(platformId)
        ? prev.filter(p => p !== platformId)
        : [...prev, platformId]
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Listing Created!",
      description: `Your item has been listed on ${selectedPlatforms.length} platform(s).`,
    });
  };

  return (
    <MainLayout 
      title="Create Listing" 
      subtitle="List your item across multiple platforms"
    >
      <form onSubmit={handleSubmit} className="mx-auto max-w-4xl space-y-8">
        {/* Platform Selection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
            <Tag className="h-5 w-5 text-primary" />
            Select Platforms
          </h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Choose where you want to list this item
          </p>
          
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {platforms.map((platform) => (
              <button
                key={platform.id}
                type="button"
                onClick={() => togglePlatform(platform.id)}
                className={cn(
                  "flex items-center gap-3 rounded-lg border-2 p-4 transition-all duration-200",
                  selectedPlatforms.includes(platform.id)
                    ? platform.color + " border-opacity-100"
                    : "border-border bg-secondary/30 hover:border-muted-foreground/30"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  selectedPlatforms.includes(platform.id) ? "bg-background/50" : "bg-background"
                )}>
                  <platform.icon className="h-5 w-5 text-foreground" />
                </div>
                <div className="text-left">
                  <p className="font-medium text-foreground">{platform.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedPlatforms.includes(platform.id) ? "Selected" : "Click to select"}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Photos Section */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
            <ImageIcon className="h-5 w-5 text-primary" />
            Photos
          </h2>
          
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-secondary/30 transition-colors hover:border-primary/50 hover:bg-secondary/50">
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Main Photo</span>
              </div>
            </div>
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="relative aspect-square cursor-pointer overflow-hidden rounded-lg border-2 border-dashed border-border bg-secondary/30 transition-colors hover:border-muted-foreground/50"
              >
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <Upload className="mb-2 h-6 w-6 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Add Photo</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Item Details */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 flex items-center gap-2 font-serif text-lg font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            Item Details
          </h2>

          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g., Antique Victorian Brass Floor Lamp - Circa 1890"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="description">Description</Label>
                <Button type="button" variant="ghost" size="sm" className="text-primary">
                  <Sparkles className="mr-1 h-4 w-4" />
                  AI Generate
                </Button>
              </div>
              <Textarea
                id="description"
                placeholder="Describe your item in detail including condition, measurements, history, etc."
                rows={6}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="price">Price</Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="price"
                    type="number"
                    placeholder="0.00"
                    className="pl-10"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Input
                  id="category"
                  placeholder="e.g., Lighting, Furniture"
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="condition">Condition</Label>
                <Input
                  id="condition"
                  placeholder="e.g., Excellent, Good, Fair"
                  value={formData.condition}
                  onChange={(e) => setFormData({ ...formData, condition: e.target.value })}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Platform-Specific Options */}
        {selectedPlatforms.length > 0 && (
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="mb-4 font-serif text-lg font-semibold text-foreground">
              Platform-Specific Options
            </h2>
            
            <div className="space-y-4">
              {selectedPlatforms.includes("ebay") && (
                <div className="flex items-center space-x-2">
                  <Checkbox id="ebay-auction" />
                  <Label htmlFor="ebay-auction" className="text-sm">
                    List as auction on eBay (vs. Buy It Now)
                  </Label>
                </div>
              )}
              {selectedPlatforms.includes("facebook") && (
                <div className="flex items-center space-x-2">
                  <Checkbox id="fb-groups" />
                  <Label htmlFor="fb-groups" className="text-sm">
                    Post to Facebook Marketplace groups
                  </Label>
                </div>
              )}
              {(selectedPlatforms.includes("liveauctioneers") || selectedPlatforms.includes("denver")) && (
                <div className="flex items-center space-x-2">
                  <Checkbox id="reserve-price" />
                  <Label htmlFor="reserve-price" className="text-sm">
                    Set a reserve price for auction platforms
                  </Label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center justify-end gap-4">
          <Button type="button" variant="outline">
            Save as Draft
          </Button>
          <Button type="submit" variant="gold" disabled={selectedPlatforms.length === 0}>
            Create Listing ({selectedPlatforms.length} platform{selectedPlatforms.length !== 1 ? "s" : ""})
          </Button>
        </div>
      </form>
    </MainLayout>
  );
}
