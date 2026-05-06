import { useEffect, useState } from "react";
import { MainLayout } from "@/components/layout/MainLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Store, Gavel, Facebook, Truck, ShoppingBag, Package, CheckCircle, XCircle } from "lucide-react";

const PLATFORM_LABELS: Record<string, string> = {
  ebay: "eBay",
  denver_auctions: "Denver Auctions",
  liveauctioneers: "LiveAuctioneers",
  facebook: "Facebook",
  mercari: "Mercari",
  poshmark: "Poshmark",
  estate_services: "Estate Services",
};

const PLATFORM_ICONS: Record<string, React.ElementType> = {
  ebay: Store,
  denver_auctions: Gavel,
  liveauctioneers: Gavel,
  facebook: Facebook,
  mercari: ShoppingBag,
  poshmark: Package,
  estate_services: Truck,
};

interface UserRow {
  id: string;
  business_name: string | null;
  is_admin: boolean;
  created_at: string;
  platforms: Array<{ platform: string; enabled: boolean }>;
  has_ebay_creds: boolean;
}

export default function Index() {
  const { isAdmin, loading } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;

    const load = async () => {
      setFetching(true);

      const { data: profiles } = await supabase
        .from('user_profiles' as any)
        .select('id, business_name, is_admin, created_at');

      const { data: platforms } = await supabase
        .from('user_platforms' as any)
        .select('user_id, platform, enabled');

      const { data: creds } = await supabase
        .from('user_ebay_credentials' as any)
        .select('user_id');

      const credUserIds = new Set((creds as any[] || []).map((c: any) => c.user_id));

      const rows: UserRow[] = (profiles as any[] || []).map((p: any) => ({
        id: p.id,
        business_name: p.business_name,
        is_admin: p.is_admin,
        created_at: p.created_at,
        platforms: (platforms as any[] || []).filter((pl: any) => pl.user_id === p.id),
        has_ebay_creds: credUserIds.has(p.id),
      }));

      setUsers(rows);
      setFetching(false);
    };

    load();
  }, [isAdmin]);

  if (loading) return null;

  // Non-admins go straight to their workflow
  if (!isAdmin) return <Navigate to="/projects" replace />;

  return (
    <MainLayout title="Admin Dashboard" subtitle="All users and their platform configurations">
      <div className="space-y-4">
        {fetching ? (
          <p className="text-muted-foreground">Loading users…</p>
        ) : users.length === 0 ? (
          <p className="text-muted-foreground">No users found. Apply the SQL migration in the Supabase dashboard first.</p>
        ) : (
          users.map(u => (
            <div key={u.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-foreground">
                      {u.business_name || "No business name set"}
                    </p>
                    {u.is_admin && (
                      <span className="rounded-full bg-primary/20 px-2 py-0.5 text-xs font-medium text-primary">
                        Admin
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-sm font-mono text-muted-foreground">{u.id}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Joined {new Date(u.created_at).toLocaleDateString()}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 text-sm">
                  {u.has_ebay_creds ? (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <span className="text-green-600">eBay connected</span>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">eBay not set up</span>
                    </>
                  )}
                </div>
              </div>

              {u.platforms.filter((pl: any) => pl.enabled).length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {u.platforms
                    .filter((pl: any) => pl.enabled)
                    .map((pl: any) => {
                      const Icon = PLATFORM_ICONS[pl.platform] || Store;
                      return (
                        <div
                          key={pl.platform}
                          className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground"
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {PLATFORM_LABELS[pl.platform] || pl.platform}
                        </div>
                      );
                    })}
                </div>
              ) : (
                <p className="mt-3 text-sm italic text-muted-foreground">No platforms configured yet</p>
              )}
            </div>
          ))
        )}
      </div>
    </MainLayout>
  );
}
