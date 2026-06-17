# Glass Pitch

## Skill routing

At the start of any task, work out which installed skills apply and use them.
Prefer the most specific; don't stack overlapping skills.

Frontend / UI (components, pages, styling, layout, accessibility, charts):
- ui-ux-pro-max — UI/UX decisions: layout, interaction states, a11y, typography, chart choice.
- ui-styling — implementing those components in Tailwind + shadcn/ui (shadcn adopted for
  interactive primitives only — see docs/ARCHITECTURE.md §6).
- Source of truth is docs/DESIGN.md — its colours, tokens, type, and voice. Use these
  skills to BUILD that system; never to invent a new palette, theme, or token set.

Data / backend (Supabase, SQL, schema):
- supabase — anything touching Supabase: client reads (supabase-js / @supabase/ssr),
  auth, RLS, migrations, Edge Functions.
- supabase-postgres-best-practices — writing, reviewing, or optimising SQL, schema, indexes.

Asset / marketing work (ONLY when explicitly doing it — not during normal app building):
- brand — brand voice, messaging, style guides.
- design / design-system — logos, corporate identity, token systems
  (defer to docs/DESIGN.md for this project's tokens).
- slides — building a pitch deck / presentation.
- banner-design — social, ad, or hero banners.

Defaults: frontend work → ui-ux-pro-max + ui-styling. Data work → supabase.
For the review/commit pass you may invoke the built-in code-review / verify workflows.

Hard rule: no design or asset skill may override docs/DESIGN.md or docs/ARCHITECTURE.md.
