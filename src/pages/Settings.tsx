import { MainLayout } from "@/components/layout/MainLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { EbayOAuthManager } from "@/components/ebay/EbayOAuthManager";
import { 
  User, 
  Bell, 
  Shield, 
  CreditCard,
  Palette,
  Globe,
  HelpCircle
} from "lucide-react";
import { cn } from "@/lib/utils";

const settingsSections = [
  { id: "profile", label: "Profile", icon: User },
  { id: "notifications", label: "Notifications", icon: Bell },
  { id: "security", label: "Security", icon: Shield },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "integrations", label: "Integrations", icon: Globe },
  { id: "help", label: "Help & Support", icon: HelpCircle },
];

export default function Settings() {
  return (
    <MainLayout 
      title="Settings" 
      subtitle="Manage your account and preferences"
    >
      <div className="grid gap-8 lg:grid-cols-4">
        {/* Sidebar Navigation */}
        <div className="lg:col-span-1">
          <nav className="space-y-1">
            {settingsSections.map((section) => (
              <button
                key={section.id}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-medium transition-colors",
                  section.id === "profile"
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <section.icon className="h-5 w-5" />
                {section.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Settings Content */}
        <div className="lg:col-span-3 space-y-8">
          {/* Profile Section */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-xl font-semibold text-foreground">Profile Settings</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage your personal information and business details
            </p>

            <Separator className="my-6" />

            <div className="space-y-6">
              <div className="flex items-center gap-6">
                <div className="flex h-20 w-20 items-center justify-center rounded-full bg-gradient-gold text-2xl font-bold text-primary-foreground">
                  JD
                </div>
                <div>
                  <Button variant="outline" size="sm">Change Photo</Button>
                  <p className="mt-2 text-xs text-muted-foreground">
                    JPG, GIF or PNG. Max size 2MB.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" defaultValue="John" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" defaultValue="Doe" />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" defaultValue="john@estatesales.com" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="business">Business Name</Label>
                <Input id="business" defaultValue="Estate Treasures LLC" />
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <Button variant="gold">Save Changes</Button>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-xl font-semibold text-foreground">Notifications</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Choose what notifications you want to receive
            </p>

            <Separator className="my-6" />

            <div className="space-y-6">
              {[
                { id: "orders", label: "New Orders", description: "Get notified when you receive a new order" },
                { id: "messages", label: "Buyer Messages", description: "Receive alerts for new buyer inquiries" },
                { id: "listings", label: "Listing Updates", description: "Get updates on your listing performance" },
                { id: "sync", label: "Sync Status", description: "Be alerted when platform sync completes or fails" },
              ].map((notification) => (
                <div key={notification.id} className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-foreground">{notification.label}</p>
                    <p className="text-sm text-muted-foreground">{notification.description}</p>
                  </div>
                  <Switch defaultChecked />
                </div>
              ))}
            </div>
          </div>

          {/* eBay OAuth Section */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-xl font-semibold text-foreground">eBay Connection</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Set up and test your eBay OAuth 2.0 credentials
            </p>
            <Separator className="my-6" />
            <EbayOAuthManager />
          </div>

          {/* Other Platforms */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-serif text-xl font-semibold text-foreground">Other Platforms</h2>
            <Separator className="my-6" />
            <div className="space-y-4">
              {[
                { platform: "Facebook", status: "Connected" },
                { platform: "LiveAuctioneers", status: "Connected" },
                { platform: "Denver Auctions", status: "Connected" },
              ].map((api) => (
                <div key={api.platform} className="flex items-center justify-between rounded-lg bg-secondary/30 p-4">
                  <div>
                    <p className="font-medium text-foreground">{api.platform}</p>
                    <p className="text-sm text-success">{api.status}</p>
                  </div>
                  <Button variant="outline" size="sm">Configure</Button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}
