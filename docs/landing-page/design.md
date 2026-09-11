# Landing and onboarding design

Reference concepts: `hero-concept.png`, `catalog-concept.png`, `registration-concept.png`.

- Forest background #071b16, mint-white #eff9ef, muted mint #b0c8bd, lime #d0fa88, rule #284b3d. No warm or white backgrounds.
- Manrope, locally bundled. Desktop hero scales to 94px, section headings to 48px, body 16–24px, chrome 12–16px. Mobile hero scales from 33px. Gutters 6vw; content maximum 1360px.
- Hero: simple navigation, two-line title, supporting paragraph, two actions, right-hand emerald ring artwork, bottom three-part benefits line. No color overlay on artwork; only edge blending. Fine borders, open section layouts, one pricing band per real catalog record.
- Exact hero copy: siskop.; Platform; Paket; Cara bergabung; Masuk; Mulai sekarang; Koperasi maju.; Tumbuh bersama.; Satu ruang untuk anggota, simpanan, dan masa depan koperasi Anda.; Temukan paket Anda; Kenali SISKOP; Anggota terhubung; Operasional tertata; Keuangan transparan.
- Continuation: cooperative types, real package catalog, three registration steps, footer. Catalog example in concept is illustrative; runtime never invents packages or prices.
- Registration: two-column form and order summary, progress indicator, Xendit handoff. Additional operating principle (Konvensional/Syariah) field is required by the existing backend. Payment: centered status panel with recovery, resume, and success states.
- Icons: Lucide, 1.5–2px outline strokes, 16–20px UI; simple linked rings brand mark. Lime filled circle checkmarks for package features.
- Motion: subtle float, pointer parallax, scroll reveal. Published Spline scene loaded only when configured and motion is enabled. Generated art stays visible during scene loading, failure, and reduced motion. Pause control stops motion.
- Default scope: cooperative SaaS subscriptions; one month of access, no automatic renewal. Reuse the existing dashboard.

## Visual verification, 10 September 2026

Concepts and rendered screenshots were inspected directly with `view_image`, including a 1536 × 1024 hero comparison and a 390 × 844 mobile check.

| Comparison | Concept evidence | Render evidence and resolution |
| --- | --- | --- |
| Hero copy | Two-line title, supporting sentence, two CTAs, three benefits | Same wording and order; no added eyebrow or invented metrics. |
| Hero composition | Left title and actions, right emerald rings, next section visible | Matched at native width; adjusted hero height and typography to recover the next-section preview. |
| Palette and artwork | Forest, mint, lime, luminous green rings | Original generated artwork blends into the forest background without a color overlay; matching CSS tokens and local Manrope. |
| Motion bounds | Centerpiece stays inside the viewport | Fixed decorative horizontal overflow with scoped clipping; document width equals viewport width at 1536px and 390px. |
| Catalog | Wide package band and three steps | Uses live package data and the same band structure; illustrative explanatory copy is omitted from the product. |
| Registration | Form beside a bordered order summary | Same family of controls and summary; required operational principle is added, desktop heading wraps, mobile summary moves above the form. |
| Payment and motion | Payment success panel and cinematic centerpiece | Payment states require verified provider data. Spline runtime was checked with an official sample; the branded scene and real provider payment remain unverified pending configuration. |

Functional browser checks covered package navigation, registration selections, mobile menu state, invalid recovery credentials, missing-checkout-session recovery, and public workspace entry into tenant login. Automated backend tests simulate the paid journey; browser QA did not make a real payment. Live Spline scene fidelity requires a separate pass once the actual scene is supplied.
