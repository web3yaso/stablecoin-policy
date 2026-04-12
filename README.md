# Track Policy

A live map of where AI and data center policy is actually happening — across the US (federal + every state), the EU and major member states, and key Asia-Pacific jurisdictions.

The goal is simple: make it easy to see, at a glance, which governments are restricting AI, which are courting it, which are still studying it, and which are doing nothing. Click into any jurisdiction to read the bills currently moving, the politicians driving them, and the latest news.

## Tech stack

- **Next.js 16** + **React 19** + **TypeScript**
- **Tailwind CSS v4** for styling
- **react-simple-maps** + **d3-geo** + **topojson-client** for the interactive maps
- Legislation data sourced from **LegiScan**, news enriched via the **Anthropic API** with web search
