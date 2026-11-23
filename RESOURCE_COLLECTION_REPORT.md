# Resource collection report

Updated: 23 November 2026

No automated collector has run. No playlists, lecture files, PDFs, papers, or resource counts are claimed as collected. The catalogue currently accepts user-supplied links and stores link metadata only.

## Source investigation

| Source | Public findings | Policy and access status | Current integration |
|---|---|---|---|
| [ShriCasa](https://shricasa.com/dashboard) | Public dashboard and [Past Papers index](https://shricasa.com/papers) were visible. The index lists exam attempts and document categories, and points primarily to ICAI-hosted files. | Terms were not located in this review. The research browser could not retrieve `robots.txt`, which does not establish whether crawling is allowed. | Manual link import only. Do not crawl until terms and robots/access rules are confirmed. |
| [NextGen Career Circle](https://nextgencareercircle.co/) | Public homepage lists CA Final resources, practice tools, past papers, and guidance content. Resource subpages returned only shared navigation in the research browser. | [Terms of Use](https://nextgencareercircle.co/terms), updated 26 October 2026, permit personal study use and prohibit copying, reselling, or republishing materials without permission. `robots.txt` could not be retrieved in this review. | Manual link import only until automated access rules are confirmed. Never copy/re-publish source content. |
| [CA Study Partner](https://www.castudypartner.com/) | Public landing/sign-up pages describe study and practice material; some content is account-gated. | [Terms and Conditions](https://www.castudypartner.com/Castudypartner_TermandConditon) prohibit unauthorized automated/systematic extraction, scraping, downloading, copying, and misuse. `robots.txt` could not be retrieved. | Automated discovery disabled. Use user-supplied links or an authorized export/API only. No sign-in automation. |
| [ICAI](https://www.icai.org/) | Official Students/BoS pages link to study resources, announcements, lectures, study material, RTPs, MTPs, and exam content. [ShriCasa's past-paper index](https://shricasa.com/papers) was observed linking to ICAI resource/CDN hosts. | ICAI's [student resources page](https://www.icai.org/students.shtml?mod=1) asserts copyright and restricts reproduction/transmission/storage of materials without written permission. `robots.txt` could not be retrieved in this review. | Preserve official URLs and minimal metadata only; no document copying or automated fetching until robots/access rules are verified. |

`robots.txt` retrieval was attempted through the research browser for the listed domains. Its cache/access failure is recorded as **unverified**, not as a site returning 404 or granting permission.

## Phase 2 implementation

- Added a D1 source registry with policy, robots status, access notes, and permitted integration mode for each investigated source.
- Added a Resource Collector page with source policy notes, manual link import, metadata fields, a saved catalogue, and pending subject/chapter mapping review.
- The import endpoint accepts HTTP(S) links only, removes common tracking parameters, canonicalizes YouTube video links, and deduplicates by canonical URL.
- The application does not fetch submitted URLs. A user-supplied subject or chapter mapping is marked pending review; it is not represented as verified classification.
- No automated source adapters are enabled because robots/access permissions are unverified for all four domains. CA Study Partner specifically prohibits unauthorized automated extraction.

## Collection rules

- Inspect source policies and access restrictions before automated discovery.
- Do not bypass a login, paywall, CAPTCHA, subscription, or other control.
- Store permitted links and metadata, not redistributed copies of protected lectures or documents.
- Use authorized export/API or manual link import for restricted sources.
- Record the checked date, discovery method, access class, and source URL for each finding.
- Keep uncertain subject/chapter mapping pending human review and avoid fabricated catalogue entries.
- Recheck link status at a bounded, polite rate. Report working links only after a check.
