# Citely Product Family — Public Policy Subsites and Paid Playbooks

**Date:** 2026-07-31
**Status:** Accepted
**Scope:** Define the product boundary between Citely, the Stablecoin Policy subsite, the planned AI Policy subsite, and future policy-domain subsites such as Web3 Policy.

## Product family

Citely is the shared commercial surface and thin client for paid playbooks. Domain policy products are public-facing Citely subsites backed by domain APIs:

- **Stablecoin Policy** — stablecoin regulatory intelligence;
- **AI Policy** — global AI regulatory intelligence;
- **Web3 Policy** — a future broader Web3 regulatory-intelligence subsite;
- additional policy domains may be added by implementing the same API contract rather than adding domain logic to the Citely main site.

The exact hostname or path for each subsite is a deployment decision and is not fixed by this document.

## Public subsite boundary

Each policy subsite may publicly expose:

- official-source-backed jurisdiction and topic pages;
- legislation, regulatory events, amendments, deadlines, and source citations;
- monthly updates, explainers, comparisons, and editorial analysis;
- a curated research library containing high-quality open-access papers, datasets, codebooks, and the subsite's original research briefs;
- coverage, freshness, methodology, and source-health information;
- free previews or diagnostics that do not execute the paid decision engine;
- contextual links into the relevant Citely playbook.

A subsite must not expose through its public pages or unauthenticated APIs:

- proprietary `DecisionRule` definitions or rule-engine logic;
- executable decision graphs and private branching criteria;
- generated `PlaybookAction` plans;
- saved customer profiles, answers, reviewer notes, or playbook progress;
- private evidence packs, diligence rooms, monitoring portfolios, or customer notifications;
- billing or entitlement implementation.

The backend serving a subsite may own the private domain playbook runtime. Its paid endpoints must require authenticated server-to-server access and must return presentation-safe packages rather than raw proprietary rule definitions.

Public source documents and provision-level citations are not proprietary merely because a paid playbook uses them. Paid conclusions must still show the legal evidence needed to understand and review the result.

## Public research library and publication rights

The public subsites may curate research that helps readers understand regulatory problems, compare practices, or evaluate methods. For example, an AI Policy research brief may discuss a study of GenAI service terms, its codebook, findings, limitations, and relevance to consumer-protection enforcement.

Research is a distinct evidence class from legal authority:

- official legislation, regulations, regulator decisions, and binding instruments support statements about legal requirements;
- reputable research can support context, empirical observations, methods, competing interpretations, and discovery of primary sources;
- a paper must not be promoted into a binding `LegalClaim` merely because it cites or analyzes law;
- every public brief must label jurisdiction, publication version, publication or venue status, retrieval date, and whether the work has been peer reviewed.

"Open access" means the work is publicly readable; it does not by itself grant permission to republish, translate, or adapt the full text. Each research record must capture the canonical URL and an explicit rights review before content is mirrored or adapted. At minimum, use these rights states:

- `LINK_ONLY` — publish metadata, a link, and Citely's independently written commentary; do not mirror the work;
- `SUMMARY_WITH_CITATION` — publish an original summary and limited quotations consistent with the applicable law and publisher terms;
- `REPUBLISH_ALLOWED` — mirror the licensed work with the required attribution, licence link, notices, and version information;
- `ADAPT_ALLOWED` — translate, annotate, remix, or otherwise modify the work while identifying changes and satisfying the licence conditions.

Rights are assessed per version and per artifact. A paper's licence does not automatically cover third-party figures, datasets, trademarks, photographs, or linked supplements. Commercial use must also be checked: content under a non-commercial licence cannot be reused inside a commercial Citely publication unless separate permission or a legal exception applies.

The minimum `ResearchPublication` record should include:

- title, authors, canonical URL, persistent identifier, publication date, and version;
- abstract or Citely-authored description, topics, jurisdictions, and policy domains;
- venue and publication status, including a clear preprint or peer-review label;
- licence identifier and URL, rights state, attribution text, and rights-review date;
- source, dataset, code, codebook, supplement, and correction links where available;
- editorial-review state, conflicts or funding disclosures when known, and a content checksum for any mirrored artifact.

When mirroring is permitted, PDFs and other artifacts belong in object storage rather than Git. The database stores metadata, rights, provenance, review status, and object references. A new paper version creates a new immutable source version and may trigger an editorial review; it does not silently replace the earlier record.

## Thin Citely client and authenticated domain APIs

The paid experience remains at <https://www.citely.info/playbook>, but the Citely main site is intentionally thin. It owns only shared commercial and presentation concerns:

- authentication, team access, billing, entitlements, and commercial audit logs;
- domain routing and an authenticated server-side API client;
- a generic renderer for API-supplied catalog cards, forms, playbook steps, results, actions, evidence, freshness, and review states;
- minimal account-to-package references and delivery history when required for the customer experience.

The Citely main site must not duplicate domain-specific legal corpora, source adapters, evidence assembly, topic-to-playbook mappings, decision rules, action generation, or monitoring-impact logic.

Each subsite's authenticated domain API owns:

- playbook catalog metadata, intake/form schemas, and versioned templates;
- private `DecisionRule` evaluation and `PlaybookAction` generation;
- source, provision, claim, citation, and evidence-bundle assembly;
- source health, coverage, uncertainty, review gates, and domain-specific validation;
- versioned playbook packages, artifacts, and change-to-action impact evaluation;
- storage of domain corpus and artifacts according to the external-storage rules below.

The paid API returns a presentation-safe `PlaybookPackage`. At minimum it contains:

- `package_id`, `domain`, `playbook_id`, title, stage, status, and display schema;
- confirmed-input requirements and validation errors;
- evaluated result and generated actions, without raw `DecisionRule` definitions or private decision graphs;
- an `EvidenceBundle` with claims, provisions, precise citations, canonical source URLs, and review state;
- corpus, rule-set, playbook-template, source, and response-schema versions;
- coverage, freshness, uncertainty, human-review, and blocking states;
- `evaluated_at`, immutable artifact references, and integrity metadata.

Citely sends customer facts only through an authenticated server-to-server `POST`, after entitlement checks and explicit customer confirmation. Sensitive facts must not appear in URLs, public feed payloads, browser-visible credentials, or acquisition attribution parameters. The domain API either returns an immutable package or an opaque package reference that the generic Citely client can retrieve and render.

Public endpoints and paid endpoints are separate. Public subsite pages may link domain, jurisdiction, topic, and playbook identifiers into Citely. They do not carry customer answers or unlock paid package endpoints.

## Shared data and service boundary

The product family should share one source-backed regulatory-data substrate rather than duplicate official documents per subsite:

```text
Official sources
→ SourceDocument and SourceVersion
→ Provision
→ domain-tagged LegalClaim
→ private domain DecisionRule
→ authenticated domain API PlaybookPackage and EvidenceBundle
→ Citely generic renderer
```

`SourceDocument`, `SourceVersion`, and `Provision` are globally reusable. A GDPR provision, for example, may support AI, stablecoin, and Web3 claims without storing three copies of the official text. `LegalClaim` records may be tagged to one or more policy domains. `DecisionRule` definitions, submitted customer facts, and paid package artifacts remain private commercial data and are never returned by public subsite endpoints.

`ResearchPublication` and its versioned artifacts are also reusable across domains, but remain typed as research context rather than legal authority. A research brief may link to relevant provisions and official sources without changing that evidence boundary.

Shared infrastructure should include:

- official-source adapters, provenance, versioning, and source health;
- object storage for immutable raw HTML, XML, PDF, and generated artifacts;
- a queryable database for documents, provisions, claims, research publications, events, rights reviews, and editorial reviews;
- common identifiers, taxonomies, change events, and a versioned `PlaybookPackage`/`EvidenceBundle` API contract implemented by every domain;
- per-domain source registries, claim sets, editorial views, and playbook templates.

## Repository and storage rule

This boundary incorporates [GitHub Issue #14](https://github.com/web3yaso/stablecoin-policy/issues/14): production datasets and frequently changing generated files must not be duplicated or committed into each subsite repository.

- Git stores code, schemas, migrations, source registries, private rule code where appropriate, small fixtures, and release manifests.
- Object storage stores immutable raw sources, corpus snapshots, and generated artifacts.
- PostgreSQL or an equivalent database stores queryable metadata, provisions, claims, events, reviews, playbook runs, and watchlists.
- Daily ingestion updates storage and the database instead of committing large JSON files to `main`.
- Subsites consume shared services or pinned dataset releases with caching, integrity checks, explicit stale behavior, and rollback support.

## Acquisition and routing

The public-to-paid path is:

```text
Subsite tracker, monthly update, topic page, or research brief
→ contextual Citely playbook landing page
→ Citely entitlement check and generic intake renderer
→ authenticated call to the relevant subsite API
→ PlaybookPackage plus EvidenceBundle
→ Citely renders the evidence-backed result and action plan
→ optional monitoring subscription
```

Attribution should preserve the originating domain, page, jurisdiction, topic, and campaign without passing sensitive user facts in URLs.

## Accepted decisions

- Citely is the single customer-facing paid playbook surface for the policy product family and remains a thin, domain-agnostic client.
- Stablecoin Policy, AI Policy, and future Web3 Policy are Citely subsites and acquisition/intelligence surfaces.
- Authenticated subsite APIs own domain playbook definitions, `DecisionRule` execution, `PlaybookAction` generation, evidence assembly, and domain monitoring; Citely queries those APIs and renders their versioned packages.
- Raw `DecisionRule` definitions, private decision graphs, customer facts, and paid packages are never exposed through public subsite pages or unauthenticated APIs.
- Public subsites may expose official legal sources, provisions, citations, methodology, and non-customer-specific analysis.
- Public subsites may curate open-access research and publish original research briefs, subject to explicit per-artifact rights review and clear research-versus-legal-authority labeling.
- Official-source ingestion and canonical legal documents are shared across domains; customer inputs and paid artifacts remain private even when processed or stored by a domain API.
- New subsites must follow the external-storage and non-duplication requirements recorded in Issue #14.
