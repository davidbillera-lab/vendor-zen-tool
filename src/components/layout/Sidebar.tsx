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
  X,
  FolderOpen
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

const ALL_NAV_ITEMS = [
  { icon: LayoutDashboard, label: "Admin", path: "/", adminOnly: true },
  { icon: FolderOpen, label: "Projects", path: "/projects", adminOnly: false },
  { icon: ListPlus, label: "Create Listing", path: "/create-listing", adminOnly: false },
  { icon: Package, label: "Inventory", path: "/inventory", adminOnly: false },
  { icon: ShoppingCart, label: "Orders", path: "/orders", adminOnly: false },
  { icon: Link2, label: "Platforms", path: "/platforms", adminOnly: false },
  { icon: Settings, label: "Settings", path: "/settings", adminOnly: false },
];

const PLATFORM_COLORS: Record<string, string> = {
  ebay: "bg-platform-ebay",
  denver_auctions: "bg-platform-auction",
  liveauctioneers: "bg-platform-auction",
  facebook: "bg-platform-facebook",
  mercari: "bg-blue-500",
  poshmark: "bg-red-400",
  estate_services: "bg-platform-estate",
};

const PLATFORM_DISPLAY: Record<string, string> = {
  ebay: "eBay",
  denver_auctions: "Denver Auctions",
  liveauctioneers: "LiveAuctioneers",
  facebook: "Facebook",
  mercari: "Mercari",
  poshmark: "Poshmark",
  estate_services: "Estate Services",
};

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  isMobile: boolean;
}

export function Sidebar({ isOpen, onClose, isMobile }: SidebarProps) {
  if (isMobile) {
    return (
      <>
        {isOpen && (
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm"
            onClick={onClose}
          />
        )}
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
  const { isAdmin, userPlatforms } = useAuth();

  const navItems = ALL_NAV_ITEMS.filter(item => !item.adminOnly || isAdmin);

  const enabledPlatforms = userPlatforms.filter(p => p.enabled);

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
      </nav>

      {/* Platform Status — shows user's enabled platforms from DB, or defaults */}
      <div className="border-t border-sidebar-border p-4">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Active Platforms
        </p>
        <div className="space-y-2">
          {enabledPlatforms.length > 0 ? (
            enabledPlatforms.map((platform) => (
              <div
                key={platform.platform}
                className="flex items-center justify-between rounded-lg bg-sidebar-accent/50 px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <Store className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">
                    {PLATFORM_DISPLAY[platform.platform] || platform.platform}
                  </span>
                </div>
                <div className={cn("h-2 w-2 rounded-full", PLATFORM_COLORS[platform.platform] || "bg-green-500")} />
              </div>
            ))
          ) : (
            // Fallback for users who haven't configured platforms yet
            <p className="text-xs text-muted-foreground italic">
              Configure in Settings
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
