# InsureSPR performance budgets

Run the read-only regression audit from the repository root:

```powershell
node tools/performance-audit.mjs
```

The audit covers the homepage, X-Ray service landing page, booking page, and workforce page in isolated mobile (`390 × 844`) and desktop (`1440 × 900`) Chromium contexts. It performs a complete scroll journey so lazy-loaded media is included rather than measuring only the first viewport.

Timing gates use the median of three isolated runs for each page/profile pair,
matching the repeat-run approach used by lab performance tools and preventing a
single host-scheduling spike from being presented as a repeatable site defect.
All three longest-task samples remain visible in the report.

## Release gates

| Measurement | Budget |
| --- | ---: |
| Initial first-party encoded transfer | ≤ 900 KiB |
| Full-page first-party encoded transfer | ≤ 1,800 KiB |
| Full-page image transfer | ≤ 1,500 KiB |
| CSS transfer | ≤ 40 KiB |
| JavaScript transfer | ≤ 40 KiB |
| Largest first-party response | ≤ 250 KiB |
| Initial requests | ≤ 18 |
| Full-page requests | ≤ 30 |
| External requests | ≤ 4 |
| First Contentful Paint, local lab | ≤ 1,800 ms |
| Largest Contentful Paint, local lab | ≤ 2,500 ms |
| Cumulative Layout Shift, local lab | ≤ 0.10 |
| Rendered-ready proxy | ≤ 2,500 ms |
| Initial-load total long-task time | ≤ 200 ms |
| Initial-load longest task | ≤ 50 ms |
| DOM nodes | ≤ 1,200 |
| Horizontal overflow elements | 0 |
| Images missing intrinsic dimensions | 0 |
| Failed requests, broken images, and console errors | 0 |
| Mobile page length | ≤ 20 viewport screens |
| Desktop page length | ≤ 14 viewport screens |

## What is real and what is a proxy

- FCP, LCP, CLS, and initial-load long-task entries come from Chromium's Performance APIs. They are captured before the audit begins its scripted full-page walk. They are real lab measurements, but the browser runs on unthrottled loopback. They are not Lighthouse scores, CrUX field data, or evidence of production Core Web Vitals at the 75th percentile.
- The full-scroll long-task total is printed as a diagnostic only. It includes the audit's own in-page loop that forces every lazy image eager and scrolls the complete document; treating that test-owned work as production application work would be a false release failure. Transfer totals still include all lazy media.
- The rendered-ready value is a local proxy: the document is complete, above-the-fold images have decoded, fonts report loaded, and the primary heading is visible.
- Horizontal overflow, intrinsic image dimensions, DOM size, and page length are layout-complexity regression proxies. They are deterministic and useful, but they are not Web Vitals.
- First-party text is served with deterministic gzip and binary media is served as stored, so encoded body sizes are reproducible. HTTP/TLS header overhead is not included.
- Google Fonts and Supabase API calls are stubbed to keep the audit offline-safe and deterministic. Their requests count against the request budget, while their production bytes and latency are explicitly excluded. Use Lighthouse against the deployed URL and field monitoring for production network and font costs.

Lighthouse was not installed when this audit was introduced. The script therefore does not claim a Lighthouse score and fails objective local budgets rather than manufacturing or estimating one.
