import { NavLink } from "@/components/NavLink";
import {
  LayoutDashboard,
  Package,
  ListPlus,
  ShoppingCart,
  Link2,
  Settings,
  Gavel,
  Store,
  Truck,
  X,
  FolderOpen,
  Upload,
  Layers,
  Bot
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const navItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: FolderOpen, label: "Projects", path: "/projects" },
  { icon: ListPlus, label: "Create Listing", path: "/create-listing" },
  { icon: Package, label: "Inventory", path: "/inventory" },
  { icon: ShoppingCart, label: "Orders", path: "/orders" },
  { icon: Link2, label: "Platforms", path: "/platforms" },
  { icon: Gavel, label: "Denver Batches", path: "/denver-batches" },
  { icon: Upload, label: "EstateSales", path: "/estatesales-upload" },
  { icon: Layers, label: "Bulk Intake", path: "/bulk-intake" },
  { icon: Settings, label: "Settings", path: "/settings" },
];

const platformStatus = [
  { name: "eBay", icon: Store, status: "connected", color: "bg-platform-ebay" },
  { name: "Facebook", icon: Store, status: "connected", color: "bg-platform-facebook" },
  { name: "Auctions", icon: Gavel, status: "connected", color: "bg-platform-auction" },
  { name: "Estate", icon: Truck, status: "active", color: "bg-platform-estate" },
];

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
}

export function Sidebar({ isOpen, onClose, isMobile }: SidebarProps) {
  // On mobile, show as overlay when open
  // On desktop, always show fixed sidebar
  
  if (isMobile) {
    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          <div 
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
            onClick={onClose}
          />
        )}
        
        {/* Sidebar Drawer */}
        <aside 
          className={cn(
            "fixed left-0 top-0 z-50 h-screen w-72 bg-sidebar border-r border-sidebar-border transform transition-transform duration-300 ease-in-out",
            isOpen ? "translate-x-0" : "-translate-x-full"
          )}
        >
          <SidebarContent onNavigate={onClose} showClose onClose={onClose} />
        </aside>
      </>
    );
  }

  // Desktop: Fixed sidebar
  return (
    <aside className="fixed left-0 top-0 z-40 h-screen w-64 bg-sidebar border-r border-sidebar-border">
      <SidebarContent />
    </aside>
  );
}

interface SidebarContentProps {
  onNavigate?: () => void;
  showClose?: boolean;
  onClose?: () => void;
}

function SidebarContent({ onNavigate, showClose, onClose }: SidebarContentProps) {
  return (
    <div className="flex h-full flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-gold">
            <Gavel className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="font-serif text-lg font-semibold text-foreground">ResaleHub</h1>
            <p className="text-xs text-muted-foreground">Multi-Platform Manager</p>
          </div>
        </div>
        {showClose && (
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-foreground"
            )}
            activeClassName="bg-sidebar-accent text-foreground border-l-2 border-primary"
          >
            <item.icon className="h-5 w-5" />
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={() => {
            window.dispatchEvent(new CustomEvent("vzt:open-chat"));
            onNavigate?.();
          }}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground transition-all duration-200 hover:bg-sidebar-accent hover:text-foreground"
        >
          <Bot className="h-5 w-5" />
          Ask Claude
        </button>
      </nav>

      {/* Platform Status */}
      <div className="border-t border-sidebar-border p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Platform Status
        </p>
        <div className="space-y-2">
          {platformStatus.map((platform) => (
            <div
              key={platform.name}
              className="flex items-center justify-between rounded-lg bg-sidebar-accent/50 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <platform.icon className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground">{platform.name}</span>
              </div>
              <div className={cn("h-2 w-2 rounded-full", platform.color)} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
