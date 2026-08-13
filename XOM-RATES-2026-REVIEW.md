# XOM rates 2026 - evidence review

Source reviewed: the privately supplied six-page `XOM Rates2026.pdf`. The source evidence is held outside this repository.

Review date: 2026-08-13

## Publication decision

Do not publish or import these amounts yet.

The six-page source identifies itself as a Qsight (Pty)Ltd `Item Listing
Report`. It contains 95 rows, but it does not state a currency, the meaning of
`GP Amount`, whether the amounts are cash or medical-aid rates, whether `Incl.`
and `Excl.` refer to VAT, an effective date, an expiry date, or approval terms.
Every inclusive amount is arithmetically consistent with adding 15 percent to
the exclusive amount after cent rounding, but the document does not label that
calculation as VAT.

The current Supabase prices therefore remain unpublished or quote-only.

## Candidate mapping to the live catalogue

| Source evidence | Current service | Decision |
| --- | --- | --- |
| `30110-VISA` - Chest Emmigration/Immigration | Visa Application Chest X-Ray | Direct description match; price still requires approval and billing context. |
| `1` - BONE MINERAL DENSITY (pensioner) | DXA Bone Density | Conceptual only: pensioner qualifier and DXA modality are not confirmed. |
| `003a` - BODY COMPOSITION Fitness | DXA Body Composition | Conceptual only: the report does not identify DXA modality. |
| `4` and `50120` - combined bone-density/body-composition items | No one-to-one live service | Treat as possible bundles; do not split or copy to either service. |
| 90 diagnostic-radiography rows | Primary Healthcare X-Ray | Candidate catalogue only; the report does not prove every examination is currently offered. |
| No matching row | Workplace Medicals | Keep quote-only. |
| No matching care/consultation row | Nurse-led Osteoporosis Care | Bone-density testing is not evidence of the care service price. |

## Source defects requiring owner confirmation

- Code `4`: Excl. `1680.53`, Incl. `1932.61`, but GP `880.53`.
- Code `74135`: Excl. `505.62`, Incl. `581.46`, but GP `54.32`.
- Codes `62100` and `62105` both say `Right Humerus` at different rates.
- `Right Calcaneous` appears under codes `71135` and `74135` at different rates.
- Code `74120` (`Left Foot`) has no category.
- Codes `4` and `50120` are both combined bone-density/body-composition items at different amounts.
- `GP Amount` is undefined.
- The report does not identify DXA modality.
- The bone-density-only row is labelled specifically for a pensioner.

## Required written confirmation before publication

The owner or authorised billing lead must confirm:

1. that this is the approved InsureSPR/XOM public 2026 tariff;
2. the currency;
3. the meaning of `Incl.`, `Excl.` and `GP Amount`;
4. whether each amount is cash, medical-aid, internal billing or another class;
5. the effective and expiry dates;
6. which examinations are actually available at the Randburg practice;
7. appointment, walk-in, referral and preparation rules;
8. the two GP anomalies and duplicate/missing catalogue descriptions;
9. whether the bone/body-composition rows are DXA; and
10. whether a combined scan package should become a separate public service.

The source PDF itself remains the authoritative row-by-row evidence. This
review records why its amounts were not silently interpreted or published.
