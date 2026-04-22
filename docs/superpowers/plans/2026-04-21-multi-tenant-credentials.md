# Multi-Tenant Credentials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store per-user Mercari, Poshmark, and DOA credentials in Supabase so each paying user authenticates with their own marketplace accounts instead of David's.

**Architecture:** Two Supabase migrations add the credential tables and a `user_id` column to `crosspost_jobs`. Three React components handle credential input in Settings. The Playwright agents fetch credentials from Supabase at runtime using the `user_id` embedded in each job row, falling back to `.env` values so David's existing setup keeps working.

**Tech Stack:** Supabase (PostgreSQL + RLS), React + TypeScript, shadcn/ui, Node.js Playwright agents (`@supabase/supabase-js`)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `supabase/migrations/20260421000001_user_platform_credentials.sql` | 3 credential tables + RLS |
| Create | `supabase/migrations/20260421000002_crosspost_jobs_user_id.sql` | Add `user_id` to `crosspost_jobs` |
| Create | `src/components/credentials/MercariCredentialsCard.tsx` | Settings UI — Mercari |
| Create | `src/components/credentials/PoshmarkCredentialsCard.tsx` | Settings UI — Poshmark |
| Create | `src/components/credentials/DoaCredentialsCard.tsx` | Settings UI — DOA |
| Modify | `src/pages/Settings.tsx` | Add 3 credential card sections |
| Modify | `src/lib/crosspost/api.ts` | Include `user_id` in job inserts + credential guard |
| Modify | `doa-listing-agent/mercari-agent/agent.js` | Fetch creds from DB by user_id |
| Modify | `doa-listing-agent/poshmark-agent/agent.js` | Fetch creds from DB by user_id |
| Modify | `doa-listing-agent/doaAgent.js` | Accept userId option, fetch creds from DB |

---

## Task 1: Migration — Credential Tables

**Files:**
- Create: `supabase/migrations/20260421000001_user_platform_credentials.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- user_mercari_credentials
create table if not exists public.user_mercari_credentials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  mercari_email    text not null,
  mercari_password text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_mercari_credentials enable row level security;

create policy "Users manage own Mercari credentials"
  on public.user_mercari_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_poshmark_credentials
create table if not exists public.user_poshmark_credentials (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null unique references auth.users(id) on delete cascade,
  poshmark_email    text not null,
  poshmark_password text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.user_poshmark_credentials enable row level security;

create policy "Users manage own Poshmark credentials"
  on public.user_poshmark_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_doa_credentials
create table if not exists public.user_doa_credentials (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null unique references auth.users(id) on delete cascade,
  doa_email       text not null,
  doa_password    text not null,
  doa_first_lot_url text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table public.user_doa_credentials enable row level security;

create policy "Users manage own DOA credentials"
  on public.user_doa_credentials for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

- [ ] **Step 2: Apply migration**

```bash
cd C:/Users/david/OneDrive/Desktop/doa-listing-agent/.claude/worktrees/festive-jennings-9f2373
npx supabase db push
```

Expected: migration applies without error. If Supabase CLI isn't linked, apply via the Supabase dashboard SQL editor instead.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000001_user_platform_credentials.sql
git commit -m "feat(db): add user_mercari, user_poshmark, user_doa credential tables"
```

---

## Task 2: Migration — Add user_id to crosspost_jobs

The Mercari and Poshmark agents need to know which user's credentials to look up when they pick up a job. Currently `crosspost_jobs` has no `user_id`.

**Files:**
- Create: `supabase/migrations/20260421000002_crosspost_jobs_user_id.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add user_id to crosspost_jobs so agents can fetch the right credentials
alter table public.crosspost_jobs
  add column if not exists user_id uuid references auth.users(id);

-- Index to speed up the agent query (platform + status + user_id)
create index if not exists crosspost_jobs_user_id_idx
  on public.crosspost_jobs (user_id);
```

- [ ] **Step 2: Apply migration**

```bash
npx supabase db push
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260421000002_crosspost_jobs_user_id.sql
git commit -m "feat(db): add user_id to crosspost_jobs for per-user agent credentials"
```

---

## Task 3: MercariCredentialsCard Component

**Files:**
- Create: `src/components/credentials/MercariCredentialsCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ShoppingBag, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function MercariCredentialsCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_mercari_credentials" as any)
      .select("mercari_email")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmail((data as any).mercari_email);
          setIsConnected(true);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!email || !password) {
      toast.error("Enter both email and password");
      return;
    }
    setIsSaving(true);
    const { error } = await supabase
      .from("user_mercari_credentials" as any)
      .upsert(
        {
          user_id: user.id,
          mercari_email: email.trim(),
          mercari_password: password.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    setIsSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setIsConnected(true);
      setPassword("");
      toast.success("Mercari credentials saved");
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_mercari_credentials" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to disconnect: " + error.message);
    } else {
      setEmail("");
      setPassword("");
      setIsConnected(false);
      toast.success("Mercari account disconnected");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Mercari Account</h3>
          <p className="text-sm text-muted-foreground">
            Listings post to your Mercari account.
          </p>
        </div>
        {isConnected && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3 mr-1" /> Connected
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="mercari_email">Email</Label>
          <Input
            id="mercari_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="mercari_password">Password</Label>
          <Input
            id="mercari_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isConnected ? "••••••••  (leave blank to keep)" : "Your Mercari password"}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {isConnected && (
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="gold" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isConnected ? "Update Credentials" : "Save Credentials"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the file was created and TypeScript is happy**

```bash
cd C:/Users/david/OneDrive/Desktop/doa-listing-agent/.claude/worktrees/festive-jennings-9f2373
npx tsc --noEmit 2>&1 | grep -i "MercariCredentialsCard\|credentials/" | head -20
```

Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/credentials/MercariCredentialsCard.tsx
git commit -m "feat(ui): add MercariCredentialsCard component for Settings"
```

---

## Task 4: PoshmarkCredentialsCard Component

**Files:**
- Create: `src/components/credentials/PoshmarkCredentialsCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Package, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function PoshmarkCredentialsCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_poshmark_credentials" as any)
      .select("poshmark_email")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmail((data as any).poshmark_email);
          setIsConnected(true);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!email || !password) {
      toast.error("Enter both email and password");
      return;
    }
    setIsSaving(true);
    const { error } = await supabase
      .from("user_poshmark_credentials" as any)
      .upsert(
        {
          user_id: user.id,
          poshmark_email: email.trim(),
          poshmark_password: password.trim(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    setIsSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setIsConnected(true);
      setPassword("");
      toast.success("Poshmark credentials saved");
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_poshmark_credentials" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to disconnect: " + error.message);
    } else {
      setEmail("");
      setPassword("");
      setIsConnected(false);
      toast.success("Poshmark account disconnected");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Package className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Poshmark Account</h3>
          <p className="text-sm text-muted-foreground">
            Listings post to your Poshmark closet.
          </p>
        </div>
        {isConnected && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3 mr-1" /> Connected
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="poshmark_email">Email</Label>
          <Input
            id="poshmark_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="poshmark_password">Password</Label>
          <Input
            id="poshmark_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isConnected ? "••••••••  (leave blank to keep)" : "Your Poshmark password"}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {isConnected && (
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="gold" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isConnected ? "Update Credentials" : "Save Credentials"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "PoshmarkCredentialsCard\|credentials/" | head -20
```

Expected: no errors for the new file.

- [ ] **Step 3: Commit**

```bash
git add src/components/credentials/PoshmarkCredentialsCard.tsx
git commit -m "feat(ui): add PoshmarkCredentialsCard component for Settings"
```

---

## Task 5: DoaCredentialsCard Component

**Files:**
- Create: `src/components/credentials/DoaCredentialsCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Gavel, CheckCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function DoaCredentialsCard() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstLotUrl, setFirstLotUrl] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_doa_credentials" as any)
      .select("doa_email, doa_first_lot_url")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setEmail((data as any).doa_email);
          setFirstLotUrl((data as any).doa_first_lot_url || "");
          setIsConnected(true);
        }
      });
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    if (!email || !password) {
      toast.error("Enter email and password");
      return;
    }
    setIsSaving(true);
    const { error } = await supabase
      .from("user_doa_credentials" as any)
      .upsert(
        {
          user_id: user.id,
          doa_email: email.trim(),
          doa_password: password.trim(),
          doa_first_lot_url: firstLotUrl.trim() || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );
    setIsSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
    } else {
      setIsConnected(true);
      setPassword("");
      toast.success("Denver Online Auctions credentials saved");
    }
  };

  const handleDisconnect = async () => {
    if (!user) return;
    const { error } = await supabase
      .from("user_doa_credentials" as any)
      .delete()
      .eq("user_id", user.id);
    if (error) {
      toast.error("Failed to disconnect: " + error.message);
    } else {
      setEmail("");
      setPassword("");
      setFirstLotUrl("");
      setIsConnected(false);
      toast.success("DOA account disconnected");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Gavel className="h-5 w-5 text-muted-foreground" />
        <div className="flex-1">
          <h3 className="font-semibold text-foreground">Denver Online Auctions Account</h3>
          <p className="text-sm text-muted-foreground">
            Lots post to your DOA sub-admin account.
          </p>
        </div>
        {isConnected && (
          <Badge variant="outline" className="text-green-600 border-green-600">
            <CheckCircle className="h-3 w-3 mr-1" /> Connected
          </Badge>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="doa_email">DOA Email</Label>
          <Input
            id="doa_email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@email.com"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="doa_password">DOA Password</Label>
          <Input
            id="doa_password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isConnected ? "••••••••  (leave blank to keep)" : "Your DOA password"}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="doa_first_lot_url">First Lot URL (optional)</Label>
        <Input
          id="doa_first_lot_url"
          value={firstLotUrl}
          onChange={(e) => setFirstLotUrl(e.target.value)}
          placeholder="https://denveronlineauctions.com/sub-admin/EditAuction?id=..."
        />
        <p className="text-xs text-muted-foreground">
          The EditAuction URL for the first lot in your current auction. Used by the DOA agent to know where to start.
        </p>
      </div>

      <div className="flex justify-end gap-2">
        {isConnected && (
          <Button variant="outline" onClick={handleDisconnect}>
            Disconnect
          </Button>
        )}
        <Button variant="gold" onClick={handleSave} disabled={isSaving}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {isConnected ? "Update Credentials" : "Save Credentials"}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "DoaCredentialsCard\|credentials/" | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/credentials/DoaCredentialsCard.tsx
git commit -m "feat(ui): add DoaCredentialsCard component for Settings"
```

---

## Task 6: Update Settings.tsx

Add the three credential card sections after the existing eBay Connection section.

**Files:**
- Modify: `src/pages/Settings.tsx`

- [ ] **Step 1: Add imports at the top of the imports block**

In `src/pages/Settings.tsx`, add after the `EbayOAuthManager` import line:

```tsx
import { MercariCredentialsCard } from "@/components/credentials/MercariCredentialsCard";
import { PoshmarkCredentialsCard } from "@/components/credentials/PoshmarkCredentialsCard";
import { DoaCredentialsCard } from "@/components/credentials/DoaCredentialsCard";
```

- [ ] **Step 2: Add the three sections after the `{/* eBay Connection */}` closing `</div>` block**

Replace the closing `</div>` of the `max-w-3xl space-y-8` wrapper (currently after `</div>` for eBay Connection) with:

```tsx
        {/* Mercari Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Mercari Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Mercari account. Listings post to your store only.
          </p>
          <Separator className="my-6" />
          <MercariCredentialsCard />
        </div>

        {/* Poshmark Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Poshmark Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your Poshmark account. Listings post to your closet only.
          </p>
          <Separator className="my-6" />
          <PoshmarkCredentialsCard />
        </div>

        {/* Denver Online Auctions Connection */}
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="font-serif text-xl font-semibold text-foreground">Denver Online Auctions Connection</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect your DOA sub-admin account. Lots post to your auction only.
          </p>
          <Separator className="my-6" />
          <DoaCredentialsCard />
        </div>

      </div>
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "Settings\|credentials" | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Settings.tsx
git commit -m "feat(ui): add Mercari, Poshmark, DOA credential sections to Settings"
```

---

## Task 7: Update api.ts — Include user_id in crosspost_jobs + Credential Guard

**Files:**
- Modify: `src/lib/crosspost/api.ts`

- [ ] **Step 1: Add the credential check helper at the bottom of the file**

Add this function after the existing helpers at the bottom of `src/lib/crosspost/api.ts`:

```ts
async function hasCredentials(userId: string, platform: string): Promise<boolean> {
  const tableMap: Record<string, string> = {
    mercari: 'user_mercari_credentials',
    poshmark: 'user_poshmark_credentials',
  };
  const table = tableMap[platform];
  if (!table) return true; // no credential check needed for this platform
  const { data } = await supabase
    .from(table as any)
    .select('user_id')
    .eq('user_id', userId)
    .single();
  return data !== null;
}
```

- [ ] **Step 2: Update the `queue` dispatch block in `dispatchPlatform` to include `user_id` and the credential guard**

Find the block that starts with `if (adapter.publishType === 'queue' || adapter.publishType === 'etsy-api')` and replace it with:

```ts
    if (adapter.publishType === 'queue' || adapter.publishType === 'etsy-api') {
      // Guard: Mercari and Poshmark require the user to have saved their own credentials
      if (!await hasCredentials(user.id, platformId)) {
        return {
          ok: false,
          error: `Connect your ${adapter.label ?? platformId} account in Settings before cross-posting.`,
        };
      }

      const { error } = await supabase.from('crosspost_jobs').insert({
        listing_id: listingId,
        batch_id: batchId ?? null,
        user_id: user.id,
        platform: platformId,
        status: 'pending',
        formatted_data: { ...formattedData, imageUrls },
      });
      if (error) throw error;

      if (adapter.publishType === 'etsy-api') {
        supabase.functions.invoke('etsy-publish', {
          body: { platform: platformId, formatted: formattedData, imageUrls, listingId },
        }).catch(console.error);
      }

      return { ok: true };
    }
```

- [ ] **Step 3: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -i "api.ts\|crosspost" | head -20
```

Expected: no type errors. If you see a complaint about `adapter.label`, check `src/lib/crosspost/registry.ts` for the correct property name on the adapter type and use it (or substitute a hardcoded platform name string).

- [ ] **Step 4: Commit**

```bash
git add src/lib/crosspost/api.ts
git commit -m "feat(crosspost): include user_id in crosspost_jobs; guard mercari/poshmark dispatch without credentials"
```

---

## Task 8: Update Mercari Agent

**Files:**
- Modify: `doa-listing-agent/mercari-agent/agent.js`

- [ ] **Step 1: Remove the hard startup crash on missing env creds, add fetchCredentials function**

Replace the startup validation block and the constants at the top (lines 13-25) with:

```js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

/**
 * Fetch Mercari credentials for a user from Supabase.
 * Falls back to .env values so David's existing setup keeps working.
 */
async function fetchCredentials(userId) {
  if (userId) {
    const { data } = await supabase
      .from('user_mercari_credentials')
      .select('mercari_email, mercari_password')
      .eq('user_id', userId)
      .single();
    if (data) {
      return { email: data.mercari_email, password: data.mercari_password };
    }
  }
  // Fallback to .env for David's own setup
  const email = process.env.MERCARI_EMAIL;
  const password = process.env.MERCARI_PASSWORD;
  if (!email || !password) throw new Error('No Mercari credentials found in DB or .env');
  return { email, password };
}
```

- [ ] **Step 2: Update ensureLoggedIn to accept credentials param**

Replace the existing `ensureLoggedIn(page)` signature and the two `MERCARI_EMAIL` / `MERCARI_PASSWORD` references inside it:

```js
async function ensureLoggedIn(page, credentials) {
  await page.goto('https://www.mercari.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-testid="avatar-icon"], [aria-label="Account"]').count() > 0;
  if (isLoggedIn) {
    console.log('[mercari] Already logged in via saved session');
    return;
  }
  console.log('[mercari] Logging in...');
  await page.goto('https://www.mercari.com/login/', { waitUntil: 'networkidle' });
  await page.fill('input[name="email"]', credentials.email);
  await page.fill('input[name="password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[mercari] Logged in');
}
```

- [ ] **Step 3: Update the run() function to fetch credentials per-user**

In the `run()` function, after `const { data: jobs, error } = await supabase...` and the jobs check, replace the `await ensureLoggedIn(page)` call with:

```js
  // Group jobs by user_id so we log in once per user
  const jobsByUser = {};
  for (const job of jobs) {
    const uid = job.user_id || 'default';
    if (!jobsByUser[uid]) jobsByUser[uid] = [];
    jobsByUser[uid].push(job);
  }

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  for (const [userId, userJobs] of Object.entries(jobsByUser)) {
    let credentials;
    try {
      credentials = await fetchCredentials(userId === 'default' ? null : userId);
    } catch (err) {
      console.error(`[mercari-agent] No credentials for user ${userId}:`, err.message);
      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'failed',
          error_log: 'No Mercari credentials configured for this account',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      continue;
    }

    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
      await ensureLoggedIn(page, credentials);
      await context.storageState({ path: SESSION_FILE });

      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'in_progress', updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        try {
          await postListing(page, job);
          await supabase.from('crosspost_jobs').update({
            status: 'completed', updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          console.log(`[mercari-agent] ✓ Job ${job.id} completed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[mercari-agent] ✗ Job ${job.id} failed:`, msg);
          await supabase.from('crosspost_jobs').update({
            status: 'failed', error_log: msg, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }
      }
    } finally {
      await context.storageState({ path: SESSION_FILE });
      await browser.close();
    }
  }
```

- [ ] **Step 4: Remove the old browser/context/page block from run() that is now replaced**

After the above replacement, the old `const storageState = ...`, `const browser = ...`, `const context = ...`, `const page = ...` block and the original `try { await ensureLoggedIn(page); ... } finally { ... }` block must be deleted. The `run()` function should now only contain the DB query, the early-exit checks, and the `jobsByUser` loop above.

- [ ] **Step 5: Commit**

```bash
git add doa-listing-agent/mercari-agent/agent.js
git commit -m "feat(agent): mercari agent fetches per-user credentials from Supabase"
```

---

## Task 9: Update Poshmark Agent

**Files:**
- Modify: `doa-listing-agent/poshmark-agent/agent.js`

- [ ] **Step 1: Replace startup constants and add fetchCredentials**

Replace lines 13-27 (the constants and startup validation) with:

```js
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchCredentials(userId) {
  if (userId) {
    const { data } = await supabase
      .from('user_poshmark_credentials')
      .select('poshmark_email, poshmark_password')
      .eq('user_id', userId)
      .single();
    if (data) {
      return { email: data.poshmark_email, password: data.poshmark_password };
    }
  }
  const email = process.env.POSHMARK_EMAIL;
  const password = process.env.POSHMARK_PASSWORD;
  if (!email || !password) throw new Error('No Poshmark credentials found in DB or .env');
  return { email, password };
}
```

- [ ] **Step 2: Update ensureLoggedIn to accept credentials param**

Replace the existing `ensureLoggedIn(page)` with:

```js
async function ensureLoggedIn(page, credentials) {
  await page.goto('https://poshmark.com/', { waitUntil: 'domcontentloaded' });
  const isLoggedIn = await page.locator('[data-et-name="user_avatar"], .user-image, [data-testid="header-avatar"]').count() > 0;
  if (isLoggedIn) { console.log('[poshmark] Already logged in'); return; }

  console.log('[poshmark] Logging in...');
  await page.goto('https://poshmark.com/login', { waitUntil: 'networkidle' });
  await page.fill('input[name="login_form[username_email]"], input[placeholder*="Email"]', credentials.email);
  await page.fill('input[name="login_form[password]"], input[placeholder*="Password"]', credentials.password);
  await page.click('button[type="submit"]');
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 30000 });
  console.log('[poshmark] Logged in');
}
```

- [ ] **Step 3: Update run() with per-user grouping (same pattern as Mercari Task 8 Step 3)**

Replace the browser/login block in `run()` with the same `jobsByUser` loop pattern as in Task 8 Step 3, but:
- Change `fetchCredentials` table to `user_poshmark_credentials` (already done above)
- Change `SESSION_FILE` reference to `SESSION_FILE` (it's already `poshmark-state.json` in this file)
- Change log prefix from `[mercari-agent]` to `[poshmark-agent]`
- Change the error message string to `'No Poshmark credentials configured for this account'`

Full replacement for the `run()` function body after the jobs query and early exits:

```js
  const jobsByUser = {};
  for (const job of jobs) {
    const uid = job.user_id || 'default';
    if (!jobsByUser[uid]) jobsByUser[uid] = [];
    jobsByUser[uid].push(job);
  }

  if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

  for (const [userId, userJobs] of Object.entries(jobsByUser)) {
    let credentials;
    try {
      credentials = await fetchCredentials(userId === 'default' ? null : userId);
    } catch (err) {
      console.error(`[poshmark-agent] No credentials for user ${userId}:`, err.message);
      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'failed',
          error_log: 'No Poshmark credentials configured for this account',
          updated_at: new Date().toISOString(),
        }).eq('id', job.id);
      }
      continue;
    }

    const storageState = fs.existsSync(SESSION_FILE) ? SESSION_FILE : undefined;
    const browser = await chromium.launch({ headless: false });
    const context = await browser.newContext({ storageState });
    const page = await context.newPage();

    try {
      await ensureLoggedIn(page, credentials);
      await context.storageState({ path: SESSION_FILE });

      for (const job of userJobs) {
        await supabase.from('crosspost_jobs').update({
          status: 'in_progress', updated_at: new Date().toISOString(),
        }).eq('id', job.id);

        try {
          await postListing(page, job);
          await supabase.from('crosspost_jobs').update({
            status: 'completed', updated_at: new Date().toISOString(),
          }).eq('id', job.id);
          console.log(`[poshmark-agent] ✓ Job ${job.id} completed`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[poshmark-agent] ✗ Job ${job.id} failed:`, msg);
          await supabase.from('crosspost_jobs').update({
            status: 'failed', error_log: msg, updated_at: new Date().toISOString(),
          }).eq('id', job.id);
        }
      }
    } finally {
      await context.storageState({ path: SESSION_FILE });
      await browser.close();
    }
  }
```

- [ ] **Step 4: Commit**

```bash
git add doa-listing-agent/poshmark-agent/agent.js
git commit -m "feat(agent): poshmark agent fetches per-user credentials from Supabase"
```

---

## Task 10: Update DOA Agent

The DOA agent is invoked directly (not via `crosspost_jobs`), so it receives `userId` as an options parameter rather than reading it from a job row.

**Files:**
- Modify: `doa-listing-agent/doaAgent.js`

- [ ] **Step 1: Add Supabase import and fetchCredentials near the top**

After the existing `import 'dotenv/config'` and path imports, add:

```js
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
```

Then add this function after the `SELECTORS` and constants block (around line 140):

```js
// ── Credentials ───────────────────────────────────────────────────────────────

async function fetchDoaCredentials(userId) {
  if (userId && SUPABASE_URL && SUPABASE_KEY) {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data } = await supabase
      .from('user_doa_credentials')
      .select('doa_email, doa_password, doa_first_lot_url')
      .eq('user_id', userId)
      .single();
    if (data) {
      return {
        email: data.doa_email,
        password: data.doa_password,
        firstLotUrl: data.doa_first_lot_url || null,
      };
    }
  }
  // Fallback to .env
  const email = process.env.DOA_EMAIL;
  const password = process.env.DOA_PASSWORD;
  if (!email || !password) throw new Error('No DOA credentials found in DB or .env');
  return { email, password, firstLotUrl: process.env.DOA_FIRST_LOT_URL || null };
}
```

- [ ] **Step 2: Update doLogin to accept credentials param**

The existing `doLogin(page)` function uses the module-level `DOA_EMAIL` and `DOA_PASSWORD` constants. Update its signature and the two fill calls:

```js
async function doLogin(page, credentials) {
```

Replace:
```js
  await emailField.locator.fill(DOA_EMAIL);
```
with:
```js
  await emailField.locator.fill(credentials.email);
```

Replace:
```js
  await passField.locator.fill(DOA_PASSWORD);
```
with:
```js
  await passField.locator.fill(credentials.password);
```

- [ ] **Step 3: Update runDoaAgent to accept userId and fetch credentials**

Find the `runDoaAgent` exported function (or `run` function) — it currently reads `DOA_EMAIL`, `DOA_PASSWORD`, and `DOA_FIRST_LOT_URL_ENV`. Update its `options` destructuring and startup to:

```js
export async function runDoaAgent(options = {}) {
  const { firstLotUrl: passedFirstLotUrl, userId } = options;

  // Fetch credentials (DB if userId provided, .env otherwise)
  const creds = await fetchDoaCredentials(userId || null);
  const DOA_FIRST_LOT_URL = passedFirstLotUrl || creds.firstLotUrl || DOA_FIRST_LOT_URL_ENV;

  if (!DOA_FIRST_LOT_URL) {
    throw new Error(
      'DOA_FIRST_LOT_URL not set.\n' +
      '  Set it in Settings > Denver Online Auctions Connection, or in .env as DOA_FIRST_LOT_URL.'
    );
  }
```

Then replace all subsequent `DOA_EMAIL` / `DOA_PASSWORD` usages in the function with `creds.email` / `creds.password`, and replace the `doLogin(page)` call with `doLogin(page, creds)`.

- [ ] **Step 4: Commit**

```bash
git add doa-listing-agent/doaAgent.js
git commit -m "feat(agent): DOA agent fetches per-user credentials from Supabase"
```

---

## Task 11: Final Verification

- [ ] **Step 1: TypeScript check — full project**

```bash
cd C:/Users/david/OneDrive/Desktop/doa-listing-agent/.claude/worktrees/festive-jennings-9f2373
npx tsc --noEmit 2>&1
```

Expected: zero errors. Fix any that appear before continuing.

- [ ] **Step 2: Run existing crosspost API tests**

```bash
npx vitest run src/lib/crosspost/
```

Expected: all tests pass. If `api.test.ts` tests the `dispatchPlatform` queue path, update mocks to include `user_id` in the insert expectation.

- [ ] **Step 3: Verify Settings page renders**

Start the dev server and open Settings. Confirm:
- Mercari, Poshmark, DOA sections appear after eBay Connection
- Each shows "Not configured" badge initially
- Entering credentials and saving shows "Connected" badge
- Disconnect removes the badge

```bash
npm run dev
```

Then open: `http://localhost:5173/settings`

- [ ] **Step 4: Final commit (if any loose changes)**

```bash
git status
# Stage and commit anything not yet committed
```

---

## Success Criteria Checklist

- [ ] User can save Mercari, Poshmark, and DOA credentials in Settings
- [ ] Status badge shows "Connected" after saving
- [ ] User can disconnect (delete) credentials
- [ ] Mercari agent uses DB credentials when `user_id` has a row; falls back to `.env` if not
- [ ] Poshmark agent same
- [ ] DOA agent same
- [ ] CrossPostPanel/api.ts warns when user tries to post to Mercari/Poshmark without saved credentials
- [ ] David's own `.env`-based setup continues to work unchanged
- [ ] TypeScript compiles clean
- [ ] All crosspost tests pass
