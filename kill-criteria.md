# Kill Criteria — Vendor Zen Tool (VZT)

**Last reviewed:** 2026-06-25
**Verdict:** Pass

---

## 1. Functionality

**Kill threshold:** Listing pipeline (intake → photo processing → creation → publish) fails on any of the four major platforms (DOA, LiveAuctioneers, EstateSales, eBay) for more than 2 consecutive days. OR core features (inventory management, batch operations, multi-platform publishing) are unavailable to JSG for more than 4 hours.

**Current status:** Pass

**How to measure:** 
- Daily health check: can we create a test listing end-to-end on each platform?
- Weekly: verify batch operations work (create 5+ listings, publish to all 4 platforms)
- Automated test suite: listing generation pipeline + image processing pipeline passing

---

## 2. Efficiency

**Kill threshold:** Average listing creation time exceeds 15 minutes (including photo processing). OR image processing takes >5 minutes per batch of 10 items. OR platform publish failures (retries needed) exceed 10% of attempts.

**Current status:** Pass

**How to measure:**
- Timestamp analytics in `listings` table (created_at vs. published_at)
- Image processing logs (batch duration tracking)
- Platform API error rates via Supabase logs + `model_costs` table

---

## 3. Scalability

**Kill threshold:** During multi-tenant transition, any single tenant's activity (>100 listings/month) causes measurable degradation for other tenants. OR RLS policies break data isolation between tenants. OR Supabase query times exceed 2 seconds for any user-facing operation.

**Current status:** Pass (currently single-tenant; multi-tenant transition in progress — this criterion becomes active before first paying tenant)

**How to measure:**
- Tenant isolation testing: verify data from Tenant A is never visible to Tenant B
- Performance testing under load: >100 concurrent listings in progress
- Query analysis: Supabase Logs tab, check slowest operations

---

## 4. Time-to-Revenue

**Kill threshold:** Multi-tenant SaaS transition not on track to first paying customer within 6 months (by 2026-12-25). OR acquisition cost per tenant exceeds $5,000. OR payback period (CAC ÷ MRR per tenant) exceeds 12 months.

**Current status:** Pass

**How to measure:**
- Roadmap milestone tracking: is multi-tenant architecture complete? (scope, timeline tracking in Mission Control)
- Sales pipeline: have we identified 3+ prospective tenants (other auction houses)?
- Unit economics: cost to onboard one tenant vs. expected MRR

---

## Notes

- VZT is Tier 1 (protected). All changes get Codex second-opinion review before merge.
- Before first paying tenant, additional safeguards activate: feature flags, manual deploy approval, health monitoring in MC dashboard, incident response playbook.
- Current focus: single-tenant stability (JSG internal) + multi-tenant architecture (SaaS foundation). Scalability criterion becomes critical before shipping to other auction houses.
