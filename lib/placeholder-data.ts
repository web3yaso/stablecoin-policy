import type { Entity, Region } from "@/types";

export const ENTITIES: Entity[] = [
  // ─────────── NORTH AMERICA REGION ───────────
  {
    id: "us-federal",
    geoId: "840",
    name: "United States",
    region: "na",
    level: "federal",
    isOverview: true,
    canDrillDown: true,
    stance: "review",
    contextBlurb:
      "US federal AI and data center policy remains fragmented across agencies. No comprehensive national framework exists. The DOE, EPA, and FERC each regulate different aspects with overlapping and sometimes conflicting priorities.",
    legislation: [
      {
        id: "hr-9482",
        billCode: "H.R. 9482",
        title: "Federal Artificial Intelligence Risk Management Act",
        summary:
          "Directs NIST to operationalize the AI Risk Management Framework across federal agencies and procurement.",
        stage: "Committee",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-15",
        partyOrigin: "B",
      },
      {
        id: "s-1304",
        billCode: "S. 1304",
        title: "Clean Energy for Data Centers Act",
        summary:
          "Establishes federal grants for renewable-powered data center retrofits and PUE benchmarks for federally leased facilities.",
        stage: "Floor",
        impactTags: ["renewable-mandate", "emissions"],
        category: "data-centers",
        updatedDate: "2026-03-25",
        partyOrigin: "D",
      },
      {
        id: "hr-7213",
        billCode: "H.R. 7213",
        title: "AI Disclosure and Accountability Act",
        summary:
          "Requires disclosure when consumers interact with generative AI systems and mandates dataset provenance reporting.",
        stage: "Filed",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-02-10",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "us-schumer",
        name: "Chuck Schumer",
        role: "Senator · Senate Majority Leader",
        party: "D-NY",
        stance: "review",
        quote:
          "Congress must act on AI — but we have to get the guardrails right without smothering innovation.",
      },
      {
        id: "us-cantwell",
        name: "Maria Cantwell",
        role: "Senator · Chair, Commerce Committee",
        party: "D-WA",
        stance: "favorable",
        quote:
          "Lead author of S. 1304. Federal data center policy must catch up to the load curve.",
      },
      {
        id: "us-cruz",
        name: "Ted Cruz",
        role: "Senator · Ranking Member, Commerce Committee",
        party: "R-TX",
        stance: "concerning",
      },
      {
        id: "us-klobuchar",
        name: "Amy Klobuchar",
        role: "Senator",
        party: "D-MN",
        stance: "favorable",
      },
      {
        id: "us-warner",
        name: "Mark Warner",
        role: "Senator · Chair, Intelligence Committee",
        party: "D-VA",
        stance: "review",
        quote:
          "Sponsor of H.R. 7213 disclosure provisions in the Senate companion.",
      },
      {
        id: "us-eshoo",
        name: "Anna Eshoo",
        role: "Representative · CA-16",
        party: "D",
        stance: "favorable",
        quote: "Lead House sponsor of the AI Disclosure and Accountability Act.",
      },
      {
        id: "us-beyer",
        name: "Don Beyer",
        role: "Representative · VA-08",
        party: "D",
        stance: "review",
        quote:
          "Northern Virginia carries the grid burden of AI build-out — Congress can't keep ignoring it.",
      },
      {
        id: "us-obernolte",
        name: "Jay Obernolte",
        role: "Representative · CA-23, Co-Chair AI Task Force",
        party: "R",
        stance: "review",
      },
      {
        id: "us-mcmorris",
        name: "Cathy McMorris Rodgers",
        role: "Representative · WA-05, Energy & Commerce",
        party: "R",
        stance: "concerning",
      },
    ],
    news: [
      {
        id: "us-news-1",
        headline: "FERC opens inquiry into co-located data center load",
        source: "Reuters",
        date: "2026-03-30",
        url: "#",
      },
      {
        id: "us-news-2",
        headline: "White House AI council pushes interagency efficiency standards",
        source: "The Washington Post",
        date: "2026-03-18",
        url: "#",
      },
    ],
  },
  {
    id: "virginia",
    geoId: "Virginia",
    name: "Virginia",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Virginia hosts over 35% of global internet traffic through its Northern Virginia data center corridor. HB 1515 proposes a moratorium while HB 2084 enacted a rate classification review.",
    legislation: [
      {
        id: "va-hb1515",
        billCode: "HB 1515",
        title: "Data Center Development Moratorium",
        summary:
          "Imposes a one-year moratorium on data center special-use permits in counties exceeding 5 GW of approved load.",
        stage: "Carried Over",
        impactTags: ["zoning", "local-control", "grid-strain"],
        category: "data-centers",
        updatedDate: "2026-02-20",
        partyOrigin: "D",
      },
      {
        id: "va-hb2084",
        billCode: "HB 2084",
        title: "Data Center Rate Classification Review",
        summary:
          "Directs the State Corporation Commission to evaluate a separate retail rate class for hyperscale data center customers.",
        stage: "Enacted",
        impactTags: ["rate-hikes", "grid-strain"],
        category: "data-centers",
        updatedDate: "2026-03-08",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "va-subramanyam",
        name: "Suhas Subramanyam",
        role: "Delegate · HD-32 · Lead sponsor, HB 1515",
        party: "D",
        stance: "review",
        quote:
          "Loudoun County families shouldn't subsidize the grid build-out for the largest server farms on Earth.",
      },
      {
        id: "va-boysko",
        name: "Jennifer Boysko",
        role: "State Senator · SD-38 · Co-sponsor, HB 1515",
        party: "D",
        stance: "restrictive",
        quote:
          "We need a moratorium until Dominion can show ratepayers won't bear the cost of hyperscale.",
      },
      {
        id: "va-reid",
        name: "David Reid",
        role: "Delegate · HD-28 · Patron, HB 2084",
        party: "D",
        stance: "favorable",
        quote:
          "Separate rate classification protects residential ratepayers without freezing investment.",
      },
      {
        id: "va-sickles",
        name: "Mark Sickles",
        role: "Delegate · HD-43 · Commerce & Labor Chair",
        party: "D",
        stance: "review",
      },
    ],
    news: [
      {
        id: "va-news-1",
        headline: "Loudoun supervisors freeze new data center rezonings",
        source: "Washington Business Journal",
        date: "2026-03-26",
        url: "#",
      },
      {
        id: "va-news-2",
        headline: "Dominion Energy files revised data center tariff with SCC",
        source: "Richmond Times-Dispatch",
        date: "2026-03-11",
        url: "#",
      },
    ],
  },
  {
    id: "texas",
    geoId: "Texas",
    name: "Texas",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "Texas offers aggressive tax incentives for data center development with limited environmental safeguards. Water usage in drought-prone regions is a growing concern.",
    legislation: [
      {
        id: "tx-sb1308",
        billCode: "SB 1308",
        title: "Data Center Sales Tax Exemption Extension",
        summary:
          "Extends qualified data center sales-and-use tax exemptions through 2035 with reduced job creation thresholds.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-01-30",
        partyOrigin: "R",
      },
      {
        id: "tx-hb4422",
        billCode: "HB 4422",
        title: "Large Load Interconnection Standards Act",
        summary:
          "Establishes ERCOT interconnection rules for loads exceeding 75 MW, including curtailment obligations during scarcity events.",
        stage: "Floor",
        impactTags: ["grid-strain", "rate-hikes"],
        category: "data-centers",
        updatedDate: "2026-03-22",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "tx-king",
        name: "Phil King",
        role: "State Senator · SD-10 · Lead author, SB 1308",
        party: "R",
        stance: "concerning",
        quote:
          "Texas welcomes the data center boom — government should clear the path, not slow it down.",
      },
      {
        id: "tx-johnson",
        name: "Ann Johnson",
        role: "State Representative · HD-134 · Sponsor, HB 4422",
        party: "D",
        stance: "review",
        quote:
          "ERCOT can't keep saying yes to every interconnection request without curtailment teeth.",
      },
      {
        id: "tx-lujan",
        name: "John Lujan",
        role: "State Representative · HD-118 · Co-author, HB 4422",
        party: "R",
        stance: "review",
      },
    ],
    news: [
      {
        id: "tx-news-1",
        headline: "ERCOT warns of 152 GW long-term load forecast driven by AI",
        source: "Dallas Morning News",
        date: "2026-03-29",
        url: "#",
      },
      {
        id: "tx-news-2",
        headline: "West Texas counties weigh moratoriums amid water concerns",
        source: "Texas Tribune",
        date: "2026-03-14",
        url: "#",
      },
    ],
  },
  {
    id: "california",
    geoId: "California",
    name: "California",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "California has enacted strong data center efficiency standards requiring renewable energy commitments and community benefit agreements for new developments.",
    legislation: [
      {
        id: "ca-sb253",
        billCode: "SB 253",
        title: "Climate Corporate Data Accountability Act",
        summary:
          "Requires large operators to disclose Scope 1, 2, and 3 emissions, including data center energy and embodied carbon.",
        stage: "Enacted",
        impactTags: ["emissions", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-10",
        partyOrigin: "D",
      },
      {
        id: "ca-ab2013",
        billCode: "AB 2013",
        title: "Generative AI Training Data Transparency Act",
        summary:
          "Requires developers of generative AI to publish high-level summaries of datasets used to train consumer-facing models.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-02-25",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "ca-wiener",
        name: "Scott Wiener",
        role: "State Senator · SD-11 · Lead author, SB 253",
        party: "D",
        stance: "favorable",
        quote:
          "California has always led on tech accountability, and AI is no exception.",
      },
      {
        id: "ca-irwin",
        name: "Jacqui Irwin",
        role: "Assemblymember · AD-42 · Lead author, AB 2013",
        party: "D",
        stance: "favorable",
        quote:
          "Provenance is the floor, not the ceiling, of responsible AI development.",
      },
      {
        id: "ca-stern",
        name: "Henry Stern",
        role: "State Senator · SD-27 · Principal co-author, SB 253",
        party: "D",
        stance: "favorable",
      },
    ],
    news: [
      {
        id: "ca-news-1",
        headline: "CARB finalizes data center reporting rule under SB 253",
        source: "Los Angeles Times",
        date: "2026-03-21",
        url: "#",
      },
      {
        id: "ca-news-2",
        headline: "Newsom signs follow-on AI watermark bill",
        source: "CalMatters",
        date: "2026-03-03",
        url: "#",
      },
    ],
  },
  {
    id: "oregon",
    geoId: "Oregon",
    name: "Oregon",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "Oregon passed a moratorium on large-scale data center development near protected watershed areas following community opposition in the Columbia River Gorge.",
    legislation: [
      {
        id: "or-hb2816",
        billCode: "HB 2816",
        title: "Critical Watershed Data Center Moratorium",
        summary:
          "Prohibits new data center siting within designated critical watershed areas through 2030.",
        stage: "Enacted",
        impactTags: ["water", "national-park", "agricultural-land"],
        category: "data-centers",
        updatedDate: "2026-03-12",
        partyOrigin: "D",
      },
      {
        id: "or-sb471",
        billCode: "SB 471",
        title: "Data Center Energy Source Disclosure",
        summary:
          "Requires annual public reporting of energy mix and water consumption for facilities above 10 MW.",
        stage: "Enacted",
        impactTags: ["water", "emissions", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-28",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "or-marsh",
        name: "Pam Marsh",
        role: "State Representative · HD-5 · Chief sponsor, HB 2816",
        party: "D",
        stance: "restrictive",
        quote:
          "The Columbia River Gorge cannot be the cooling tower for the entire AI industry.",
      },
      {
        id: "or-sollman",
        name: "Janeen Sollman",
        role: "State Senator · SD-15 · Chief sponsor, SB 471",
        party: "D",
        stance: "favorable",
        quote:
          "Disclosure isn't anti-development. It's how we hold operators to their renewable promises.",
      },
      {
        id: "or-helm",
        name: "Ken Helm",
        role: "State Representative · HD-34 · Co-sponsor, HB 2816",
        party: "D",
        stance: "restrictive",
      },
    ],
    news: [
      {
        id: "or-news-1",
        headline: "The Dalles weighs second moratorium on hyperscale projects",
        source: "Oregon Public Broadcasting",
        date: "2026-03-19",
        url: "#",
      },
      {
        id: "or-news-2",
        headline: "PGE forecasts 8 GW data center load by 2030",
        source: "The Oregonian",
        date: "2026-03-06",
        url: "#",
      },
    ],
  },
  {
    id: "new-york",
    geoId: "New York",
    name: "New York",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "New York is actively reviewing data center energy demands amid grid strain concerns, particularly in regions dependent on fossil fuel peaker plants.",
    legislation: [
      {
        id: "ny-a8884",
        billCode: "A. 8884",
        title: "Data Center Grid Impact Study Act",
        summary:
          "Directs NYSERDA and the PSC to jointly study the grid impact of large data center loads in upstate New York.",
        stage: "Committee",
        impactTags: ["grid-strain", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-18",
        partyOrigin: "D",
      },
      {
        id: "ny-s7422",
        billCode: "S. 7422",
        title: "Peaker Plant Replacement and Data Center Siting Act",
        summary:
          "Conditions data center siting approvals on co-investment in peaker plant retirement and storage replacement.",
        stage: "Filed",
        impactTags: ["emissions", "noise"],
        category: "data-centers",
        updatedDate: "2026-03-05",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "ny-fahy",
        name: "Patricia Fahy",
        role: "Assemblymember · AD-109 · Lead sponsor, A. 8884",
        party: "D",
        stance: "review",
        quote:
          "We can't approve gigawatt loads without knowing what they do to upstate ratepayers.",
      },
      {
        id: "ny-harckham",
        name: "Pete Harckham",
        role: "State Senator · SD-40 · Lead sponsor, S. 7422",
        party: "D",
        stance: "restrictive",
        quote:
          "If a data center wants to plug into a peaker, the peaker has to retire. Period.",
      },
      {
        id: "ny-krueger",
        name: "Liz Krueger",
        role: "State Senator · SD-28 · Chair, Finance",
        party: "D",
        stance: "review",
      },
    ],
    news: [
      {
        id: "ny-news-1",
        headline: "PSC opens proceeding on large-load tariff design",
        source: "Albany Times Union",
        date: "2026-03-24",
        url: "#",
      },
      {
        id: "ny-news-2",
        headline: "Hochul administration mulls data center moratorium near peakers",
        source: "Politico New York",
        date: "2026-03-09",
        url: "#",
      },
    ],
  },
  {
    id: "canada-federal",
    geoId: "124",
    name: "Canada",
    region: "na",
    level: "federal",
    stance: "favorable",
    contextBlurb:
      "Canada's proposed Artificial Intelligence and Data Act (AIDA) takes a risk-based approach to AI regulation with strong provincial consultation requirements.",
    legislation: [
      {
        id: "c-27",
        billCode: "C-27",
        title: "Digital Charter Implementation Act (AIDA)",
        summary:
          "Companion legislation creating obligations for high-impact AI systems and establishing an AI and Data Commissioner.",
        stage: "Committee",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-20",
        partyOrigin: "B",
      },
      {
        id: "c-72",
        billCode: "C-72",
        title: "Data Centre Sustainability Reporting Act",
        summary:
          "Requires federally regulated data center operators to report energy mix, water draw, and grid impact annually.",
        stage: "Filed",
        impactTags: ["emissions", "water", "grid-strain"],
        category: "data-centers",
        updatedDate: "2026-02-15",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "ca-champagne",
        name: "François-Philippe Champagne",
        role: "Minister of Innovation, Science and Industry",
        party: "Liberal",
        stance: "favorable",
        quote:
          "We can lead on responsible AI while keeping Canada the best place to build AI companies.",
      },
      {
        id: "ca-rempel",
        name: "Michelle Rempel Garner",
        role: "MP, Industry Critic",
        party: "Conservative",
        stance: "review",
      },
    ],
    news: [
      {
        id: "ca-news-1",
        headline: "INDU committee holds final AIDA hearings ahead of report stage",
        source: "The Globe and Mail",
        date: "2026-03-25",
        url: "#",
      },
      {
        id: "ca-news-2",
        headline: "Quebec, Alberta press Ottawa on provincial AI carve-outs",
        source: "CBC News",
        date: "2026-03-08",
        url: "#",
      },
    ],
  },

  // ── US States (restrictive) ──
  {
    id: "maine",
    geoId: "Maine",
    name: "Maine",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "Maine LD 307 would impose the first statewide data center moratorium, banning facilities over 20 MW until November 2027. Passed both chambers and awaits final enactment.",
    legislation: [
      {
        id: "me-ld307",
        billCode: "LD 307",
        title: "Data Center Moratorium Act",
        summary:
          "Bans new data center facilities exceeding 20 MW of installed load until November 2027 pending statewide environmental and grid impact study.",
        stage: "Floor",
        impactTags: ["grid-strain", "water", "local-control"],
        category: "data-centers",
        updatedDate: "2026-03-30",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "me-brenner",
        name: "Stacy Brenner",
        role: "State Senator · SD-30 · Lead sponsor, LD 307",
        party: "D",
        stance: "restrictive",
        quote:
          "Maine's grid was built for paper mills, not gigawatt-scale data centers. We need to slow down and study what we're saying yes to.",
      },
    ],
    news: [
      {
        id: "me-news-1",
        headline: "Maine Senate advances LD 307 to enactment vote",
        source: "Portland Press Herald",
        date: "2026-03-28",
        url: "#",
      },
    ],
  },
  {
    id: "wisconsin",
    geoId: "Wisconsin",
    name: "Wisconsin",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "AB 432 would impose a two-year moratorium on hyperscale data centers in Wisconsin while a joint legislative committee studies grid and water impacts in the Lake Michigan basin.",
    legislation: [
      {
        id: "wi-ab432",
        billCode: "AB 432",
        title: "Hyperscale Data Center Moratorium",
        summary:
          "Two-year moratorium on data center facilities exceeding 100 MW of installed load, with joint legislative study commission.",
        stage: "Committee",
        impactTags: ["grid-strain", "water", "local-control"],
        category: "data-centers",
        updatedDate: "2026-03-15",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "wi-subeck",
        name: "Lisa Subeck",
        role: "State Representative · AD-78 · Lead author, AB 432",
        party: "D",
        stance: "restrictive",
      },
    ],
    news: [],
  },
  {
    id: "vermont",
    geoId: "Vermont",
    name: "Vermont",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "Vermont H. 567 limits new data center siting to grid corridors served by 100% renewable generation and prohibits any siting in conservation overlay districts.",
    legislation: [
      {
        id: "vt-h567",
        billCode: "H. 567",
        title: "Renewable-Sourced Data Center Siting Act",
        summary:
          "Restricts new data center construction to 100% renewable grid corridors and bans siting in conservation overlay districts.",
        stage: "Floor",
        impactTags: ["renewable-mandate", "agricultural-land", "national-park"],
        category: "data-centers",
        updatedDate: "2026-03-19",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "vt-sheldon",
        name: "Amy Sheldon",
        role: "State Representative · Middlebury · Chair, Environment Committee",
        party: "D",
        stance: "restrictive",
        quote:
          "Vermont's brand is renewable. We're not going to let it be diluted by fossil-backed compute.",
      },
    ],
    news: [
      {
        id: "vt-news-1",
        headline: "Burlington solar coop weighs in on H. 567 hearings",
        source: "VTDigger",
        date: "2026-03-21",
        url: "#",
      },
    ],
  },
  {
    id: "maryland",
    geoId: "Maryland",
    name: "Maryland",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "Maryland HB 1043 imposes a moratorium on Tier 4 data centers (75 MW+) until July 2027 while the Public Service Commission completes a grid load forecast.",
    legislation: [
      {
        id: "md-hb1043",
        billCode: "HB 1043",
        title: "Tier 4 Data Center Moratorium",
        summary:
          "Moratorium on data centers above 75 MW until July 2027, contingent on Public Service Commission grid impact study completion.",
        stage: "Committee",
        impactTags: ["grid-strain", "rate-hikes", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-17",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "md-charkoudian",
        name: "Lorig Charkoudian",
        role: "Delegate · LD-20 · Lead sponsor, HB 1043",
        party: "D",
        stance: "restrictive",
        quote:
          "BG&E ratepayers shouldn't be the financing mechanism for the AI boom.",
      },
    ],
    news: [],
  },
  {
    id: "new-jersey",
    geoId: "New Jersey",
    name: "New Jersey",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "A. 4831 would prohibit new data center construction within the Pinelands National Reserve and surrounding buffer zones, citing groundwater and habitat concerns.",
    legislation: [
      {
        id: "nj-a4831",
        billCode: "A. 4831",
        title: "Pinelands Data Center Prohibition Act",
        summary:
          "Prohibits new data center facilities within the Pinelands National Reserve and a 5-mile buffer zone, with retrofit requirements for existing operators.",
        stage: "Committee",
        impactTags: ["national-park", "water", "agricultural-land"],
        category: "data-centers",
        updatedDate: "2026-03-22",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "nj-lagana",
        name: "Joseph Lagana",
        role: "Assemblymember · LD-38 · Lead sponsor, A. 4831",
        party: "D",
        stance: "restrictive",
      },
    ],
    news: [],
  },
  {
    id: "connecticut",
    geoId: "Connecticut",
    name: "Connecticut",
    region: "na",
    level: "state",
    stance: "restrictive",
    contextBlurb:
      "Connecticut SB 1124 prohibits data center construction in critical watershed areas and requires DEEP review for any facility above 50 MW.",
    legislation: [
      {
        id: "ct-sb1124",
        billCode: "SB 1124",
        title: "Critical Watershed Data Center Protection Act",
        summary:
          "Prohibits new data center siting in designated critical watershed areas and requires DEEP environmental review for facilities above 50 MW.",
        stage: "Floor",
        impactTags: ["water", "environmental-study", "local-control"],
        category: "data-centers",
        updatedDate: "2026-03-24",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "ct-cohen",
        name: "Christine Cohen",
        role: "State Senator · SD-12 · Chair, Environment Committee",
        party: "D",
        stance: "restrictive",
        quote:
          "We protect drinking water for 1.4 million people in this part of the state. That doesn't bend for any industry.",
      },
    ],
    news: [],
  },

  // ── US States (concerning) ──
  {
    id: "michigan",
    geoId: "Michigan",
    name: "Michigan",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "Michigan's existing data center tax exemption is under bipartisan review after grid forecasts showed DTE and Consumers Energy nearing capacity limits.",
    legislation: [
      {
        id: "mi-hb4765",
        billCode: "HB 4765",
        title: "Data Center Tax Exemption Review Act",
        summary:
          "Adds environmental and grid impact triggers to the existing data center sales tax exemption, with sunset clauses if PUE thresholds are exceeded.",
        stage: "Committee",
        impactTags: ["tax-exemption", "grid-strain", "emissions"],
        category: "data-centers",
        updatedDate: "2026-03-14",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "mi-hill",
        name: "Jenn Hill",
        role: "State Representative · HD-109 · Sponsor, HB 4765",
        party: "D",
        stance: "review",
      },
    ],
    news: [
      {
        id: "mi-news-1",
        headline: "DTE's load forecast triggers Lansing scrutiny of data center deals",
        source: "Detroit Free Press",
        date: "2026-03-16",
        url: "#",
      },
    ],
  },
  {
    id: "georgia",
    geoId: "Georgia",
    name: "Georgia",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "Georgia is reconsidering its sales tax exemption for data centers as Georgia Power's IRP shows unprecedented load growth driven by metro Atlanta hyperscale projects.",
    legislation: [
      {
        id: "ga-sb426",
        billCode: "SB 426",
        title: "Data Center Sales Tax Exemption Sunset Acceleration",
        summary:
          "Accelerates the sunset of Georgia's data center sales tax exemption from 2031 to 2027 and adds carve-outs for projects without renewable PPA commitments.",
        stage: "Floor",
        impactTags: ["tax-exemption", "rate-hikes", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-03-26",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "ga-hufstetler",
        name: "Chuck Hufstetler",
        role: "State Senator · SD-52 · Chair, Finance",
        party: "R",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "minnesota",
    geoId: "Minnesota",
    name: "Minnesota",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "Minnesota HF 2310 requires environmental review for any data center exceeding 50 MW, after community pushback against a proposed facility in Becker.",
    legislation: [
      {
        id: "mn-hf2310",
        billCode: "HF 2310",
        title: "Data Center Permitting Environmental Review Act",
        summary:
          "Requires full Environmental Impact Statement under MEPA for data centers above 50 MW of installed load.",
        stage: "Committee",
        impactTags: ["environmental-study", "water", "local-control"],
        category: "data-centers",
        updatedDate: "2026-03-09",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "mn-hollins",
        name: "Athena Hollins",
        role: "State Representative · HD-66B · Lead author, HF 2310",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "massachusetts",
    geoId: "Massachusetts",
    name: "Massachusetts",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "Massachusetts H. 3789 establishes statewide data center siting standards including renewable energy requirements and noise abatement near residential zones.",
    legislation: [
      {
        id: "ma-h3789",
        billCode: "H. 3789",
        title: "Data Center Siting Standards Act",
        summary:
          "Establishes statewide siting standards for data centers including renewable PPA requirements, noise abatement zones, and a 1-mile residential buffer.",
        stage: "Committee",
        impactTags: ["noise", "renewable-mandate", "local-control"],
        category: "data-centers",
        updatedDate: "2026-03-11",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "ma-meschino",
        name: "Joan Meschino",
        role: "State Representative · 3rd Plymouth · Lead author, H. 3789",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "south-dakota",
    geoId: "South Dakota",
    name: "South Dakota",
    region: "na",
    level: "state",
    stance: "concerning",
    contextBlurb:
      "South Dakota offers data center tax incentives but faces growing concern about Ogallala aquifer drawdown from proposed Sioux Falls and Rapid City facilities.",
    legislation: [
      {
        id: "sd-hb1234",
        billCode: "HB 1234",
        title: "Aquifer Protection Act",
        summary:
          "Requires aquifer impact assessment and mitigation plans for any data center withdrawing more than 100,000 gallons per day.",
        stage: "Filed",
        impactTags: ["water", "agricultural-land", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-02-27",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "sd-healy",
        name: "Erin Healy",
        role: "State Representative · HD-14 · Sponsor, HB 1234",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },

  // ── US States (under review) ──
  {
    id: "illinois",
    geoId: "Illinois",
    name: "Illinois",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Illinois HB 5290 establishes an AI Accountability Office and requires impact assessments for high-risk AI systems used by state agencies and contractors.",
    legislation: [
      {
        id: "il-hb5290",
        billCode: "HB 5290",
        title: "AI Accountability Act",
        summary:
          "Establishes a state AI Accountability Office and mandates pre-deployment impact assessments for high-risk AI systems used by Illinois public bodies.",
        stage: "Committee",
        impactTags: [],
        category: "govt-ai",
        updatedDate: "2026-03-19",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "il-evans",
        name: "Marcus Evans Jr.",
        role: "State Representative · HD-33 · Sponsor, HB 5290",
        party: "D",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "colorado",
    geoId: "Colorado",
    name: "Colorado",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Colorado SB 24-205 was the first state law explicitly regulating high-risk AI consumer-facing applications, with disclosure and risk management requirements.",
    legislation: [
      {
        id: "co-sb24205",
        billCode: "SB 24-205",
        title: "AI Consumer Protection Act",
        summary:
          "Requires developers and deployers of high-risk AI systems to use reasonable care to protect consumers from algorithmic discrimination.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-02-08",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "co-rodriguez",
        name: "Robert Rodriguez",
        role: "State Senator · SD-32 · Lead sponsor, SB 24-205",
        party: "D",
        stance: "favorable",
        quote:
          "Colorado built the first real AI consumer protection floor in the country. Other states are following.",
      },
    ],
    news: [],
  },
  {
    id: "arizona",
    geoId: "Arizona",
    name: "Arizona",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Arizona HB 2462 directs ADWR to study water usage by Phoenix-area data centers as Colorado River allocations tighten and aquifer depletion accelerates.",
    legislation: [
      {
        id: "az-hb2462",
        billCode: "HB 2462",
        title: "Data Center Water Use Study Act",
        summary:
          "Directs the Arizona Department of Water Resources to publish annual water consumption data for facilities above 5 MW.",
        stage: "Floor",
        impactTags: ["water", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-23",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "az-grijalva",
        name: "Consuelo Hernández",
        role: "State Representative · LD-21 · Lead sponsor, HB 2462",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "pennsylvania",
    geoId: "Pennsylvania",
    name: "Pennsylvania",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "PA HB 1865 directs the PUC to study grid impact of large data center loads in PJM territory, particularly in Bucks and Berks counties.",
    legislation: [
      {
        id: "pa-hb1865",
        billCode: "HB 1865",
        title: "Large Load Grid Impact Study Act",
        summary:
          "Directs the Public Utility Commission to publish quarterly grid impact assessments for data center loads above 100 MW.",
        stage: "Committee",
        impactTags: ["grid-strain", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-17",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "pa-fiedler",
        name: "Elizabeth Fiedler",
        role: "State Representative · HD-184 · Sponsor, HB 1865",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "washington",
    geoId: "Washington",
    name: "Washington",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Washington SB 5343 establishes AI procurement guidelines for state agencies and requires inventory disclosure of all AI systems in government use.",
    legislation: [
      {
        id: "wa-sb5343",
        billCode: "SB 5343",
        title: "Government AI Procurement Review Act",
        summary:
          "Mandates inventory disclosure of AI systems used by Washington state agencies and establishes procurement guidelines.",
        stage: "Floor",
        impactTags: [],
        category: "govt-ai",
        updatedDate: "2026-03-25",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "wa-nguyen",
        name: "Joe Nguyen",
        role: "State Senator · SD-34 · Lead sponsor, SB 5343",
        party: "D",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "hawaii",
    geoId: "Hawaii",
    name: "Hawaii",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Hawaii SB 2572 prohibits the use of deepfake technology in election communications and requires labeling of AI-generated political content.",
    legislation: [
      {
        id: "hi-sb2572",
        billCode: "SB 2572",
        title: "Election Deepfake Prohibition Act",
        summary:
          "Prohibits the use of synthetic media depicting candidates within 90 days of an election without clear disclosure.",
        stage: "Floor",
        impactTags: [],
        category: "deepfakes",
        updatedDate: "2026-03-14",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "hi-rhoads",
        name: "Karl Rhoads",
        role: "State Senator · SD-13 · Lead sponsor, SB 2572",
        party: "D",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "delaware",
    geoId: "Delaware",
    name: "Delaware",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Delaware HB 392 requires DNREC environmental review for any data center with more than 25 MW of backup generation capacity.",
    legislation: [
      {
        id: "de-hb392",
        billCode: "HB 392",
        title: "Data Center Environmental Review Act",
        summary:
          "Requires DNREC environmental impact review and air quality permits for data centers with backup generation exceeding 25 MW.",
        stage: "Committee",
        impactTags: ["emissions", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-08",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "de-osienski",
        name: "Edward Osienski",
        role: "State Representative · HD-24 · Sponsor, HB 392",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "rhode-island",
    geoId: "Rhode Island",
    name: "Rhode Island",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Rhode Island H. 6207 directs the Department of Administration to study land-use implications of data center proposals on conservation land.",
    legislation: [
      {
        id: "ri-h6207",
        billCode: "H. 6207",
        title: "Data Center Land Use Review Act",
        summary:
          "Establishes a Department of Administration review process for data center siting on or adjacent to conservation land.",
        stage: "Filed",
        impactTags: ["zoning", "agricultural-land"],
        category: "data-centers",
        updatedDate: "2026-03-02",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "ri-handy",
        name: "Arthur Handy",
        role: "State Representative · HD-18 · Sponsor, H. 6207",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "new-hampshire",
    geoId: "New Hampshire",
    name: "New Hampshire",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "New Hampshire HB 1576 directs Eversource and the Public Utilities Commission to assess data center grid impact and rate base implications.",
    legislation: [
      {
        id: "nh-hb1576",
        billCode: "HB 1576",
        title: "Data Center Grid Impact Assessment",
        summary:
          "Directs the PUC to study rate impacts of approved data center loads on residential customers.",
        stage: "Committee",
        impactTags: ["grid-strain", "rate-hikes"],
        category: "data-centers",
        updatedDate: "2026-03-12",
        partyOrigin: "B",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "wyoming",
    geoId: "Wyoming",
    name: "Wyoming",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Wyoming HB 173 directs the Public Service Commission to study siting data centers near wind farms in Carbon and Albany counties.",
    legislation: [
      {
        id: "wy-hb173",
        billCode: "HB 173",
        title: "Wind-Adjacent Data Center Siting Study",
        summary:
          "PSC study on co-locating data centers with wind generation to reduce curtailment in southeast Wyoming.",
        stage: "Filed",
        impactTags: ["renewable-mandate", "agricultural-land"],
        category: "data-centers",
        updatedDate: "2026-02-22",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "north-carolina",
    geoId: "North Carolina",
    name: "North Carolina",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "NC HB 462 directs the Utilities Commission to assess grid impact of data center growth in the Research Triangle and Charlotte metro areas.",
    legislation: [
      {
        id: "nc-hb462",
        billCode: "HB 462",
        title: "Data Center Grid Impact Assessment Act",
        summary:
          "Directs the NCUC to publish quarterly assessments of data center grid demand and rate impacts.",
        stage: "Committee",
        impactTags: ["grid-strain", "rate-hikes", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-21",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "nc-harrison",
        name: "Pricey Harrison",
        role: "State Representative · HD-61 · Sponsor, HB 462",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },
  {
    id: "ohio",
    geoId: "Ohio",
    name: "Ohio",
    region: "na",
    level: "state",
    stance: "review",
    contextBlurb:
      "Ohio HB 281 establishes data center transparency requirements after Intel and Amazon expansions raised questions about water and grid commitments.",
    legislation: [
      {
        id: "oh-hb281",
        billCode: "HB 281",
        title: "Data Center Transparency Act",
        summary:
          "Requires annual disclosure of water use, energy mix, and tax incentive value for any data center receiving state-level support.",
        stage: "Committee",
        impactTags: ["water", "tax-exemption", "emissions"],
        category: "data-centers",
        updatedDate: "2026-03-15",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "oh-russo",
        name: "Allison Russo",
        role: "State Representative · HD-7 · House Minority Leader",
        party: "D",
        stance: "review",
      },
    ],
    news: [],
  },

  // ── US States (favorable / incentive) ──
  {
    id: "tennessee",
    geoId: "Tennessee",
    name: "Tennessee",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Tennessee SB 1123 expands the existing data center sales tax exemption and adds a property tax abatement for facilities investing more than $200M.",
    legislation: [
      {
        id: "tn-sb1123",
        billCode: "SB 1123",
        title: "Data Center Investment Incentive Expansion",
        summary:
          "Expands sales-and-use tax exemption to qualifying data center investments above $200M and adds 20-year property tax abatement.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-18",
        partyOrigin: "R",
      },
    ],
    keyFigures: [
      {
        id: "tn-bailey",
        name: "Paul Bailey",
        role: "State Senator · SD-15 · Lead sponsor, SB 1123",
        party: "R",
        stance: "favorable",
      },
    ],
    news: [],
  },
  {
    id: "mississippi",
    geoId: "Mississippi",
    name: "Mississippi",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Mississippi HB 1717 offers some of the most aggressive data center incentives in the South, with combined sales, franchise, and property tax exemptions.",
    legislation: [
      {
        id: "ms-hb1717",
        billCode: "HB 1717",
        title: "Mississippi Data Center Incentive Act",
        summary:
          "Provides combined sales tax, franchise tax, and 30-year property tax exemption for qualifying data center investments above $50M.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-01-25",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "kansas",
    geoId: "Kansas",
    name: "Kansas",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Kansas SB 360 extends the state's data center sales tax exemption through 2035 and adds workforce training credits.",
    legislation: [
      {
        id: "ks-sb360",
        billCode: "SB 360",
        title: "Data Center Sales Tax Exemption Extension",
        summary:
          "Extends sales-and-use tax exemption for qualified data centers through 2035 with workforce development grants attached.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-12",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "south-carolina",
    geoId: "South Carolina",
    name: "South Carolina",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "South Carolina H. 4087 expands the data center sales tax exemption and adds a job tax credit tied to facility size.",
    legislation: [
      {
        id: "sc-h4087",
        billCode: "H. 4087",
        title: "Data Center Investment Act",
        summary:
          "Expands sales tax exemption and adds job tax credit of $1,500 per FTE for qualifying data center projects.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-05",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "idaho",
    geoId: "Idaho",
    name: "Idaho",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Idaho H. 542 offers a property tax abatement for data center investments, particularly in the Boise metro and Magic Valley.",
    legislation: [
      {
        id: "id-h542",
        billCode: "H. 542",
        title: "Idaho Data Center Property Tax Abatement",
        summary:
          "Provides 15-year property tax abatement for data center investments above $100M with renewable energy commitments.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-01-19",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "north-dakota",
    geoId: "North Dakota",
    name: "North Dakota",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "North Dakota HB 1418 offers data center sales tax exemption and grid interconnection priority for facilities co-located with stranded gas or wind generation.",
    legislation: [
      {
        id: "nd-hb1418",
        billCode: "HB 1418",
        title: "Stranded Energy Data Center Incentive Act",
        summary:
          "Sales tax exemption plus grid interconnection priority for data centers co-located with stranded gas flares or wind curtailment zones.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate", "emissions"],
        category: "data-centers",
        updatedDate: "2026-02-21",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "iowa",
    geoId: "Iowa",
    name: "Iowa",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Iowa SF 2105 extends the state's data center sales tax exemption and adds incentives for facilities sourcing wind power directly.",
    legislation: [
      {
        id: "ia-sf2105",
        billCode: "SF 2105",
        title: "Data Center Wind Power Incentive Act",
        summary:
          "Sales tax exemption with bonus credit for data centers under direct wind PPA agreements.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-09",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "nevada",
    geoId: "Nevada",
    name: "Nevada",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Nevada SB 222 expands the abated personal property and sales tax incentives for data center investments above $500M with strong solar PPA commitments.",
    legislation: [
      {
        id: "nv-sb222",
        billCode: "SB 222",
        title: "Data Center Abatement Expansion Act",
        summary:
          "Expands eligible data center abatements to include facilities with mandatory solar PPA commitments above 80% of load.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate", "water"],
        category: "data-centers",
        updatedDate: "2026-02-28",
        partyOrigin: "B",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "indiana",
    geoId: "Indiana",
    name: "Indiana",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Indiana HB 1238 expands the existing data center sales tax exemption and adds streamlined siting for facilities in Opportunity Zones.",
    legislation: [
      {
        id: "in-hb1238",
        billCode: "HB 1238",
        title: "Indiana Data Center Investment Act",
        summary:
          "Expands sales tax exemption and adds expedited siting review for data centers in designated Opportunity Zones.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "zoning", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-01-31",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "kentucky",
    geoId: "Kentucky",
    name: "Kentucky",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Kentucky HB 232 establishes a data center investment tax credit and exempts qualifying purchases from sales tax through 2032.",
    legislation: [
      {
        id: "ky-hb232",
        billCode: "HB 232",
        title: "Kentucky Data Center Investment Act",
        summary:
          "Tax credit for data center investments and sales tax exemption on qualifying purchases through 2032.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-14",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "alabama",
    geoId: "Alabama",
    name: "Alabama",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Alabama HB 540 extends the qualified data center exemption and adds capital credit for facilities investing more than $100M.",
    legislation: [
      {
        id: "al-hb540",
        billCode: "HB 540",
        title: "Alabama Data Center Capital Credit Act",
        summary:
          "Provides 10-year capital tax credit and sales tax exemption for data centers with investments above $100M.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-04",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "arkansas",
    geoId: "Arkansas",
    name: "Arkansas",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Arkansas HB 1654 establishes targeted data center incentives focused on the Little Rock and Northwest Arkansas corridors.",
    legislation: [
      {
        id: "ar-hb1654",
        billCode: "HB 1654",
        title: "Arkansas Data Center Tax Incentive Act",
        summary:
          "Sales tax exemption and refundable income tax credit for qualifying data center investments above $50M.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-01-22",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "louisiana",
    geoId: "Louisiana",
    name: "Louisiana",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Louisiana HB 678 expands the data center sales tax exemption and adds a 10-year property tax abatement administered by Louisiana Economic Development.",
    legislation: [
      {
        id: "la-hb678",
        billCode: "HB 678",
        title: "Louisiana Data Center Investment Act",
        summary:
          "Expanded sales tax exemption and 10-year LED-administered property tax abatement for data center investments.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-17",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "missouri",
    geoId: "Missouri",
    name: "Missouri",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Missouri SB 95 establishes a state-administered data center sales tax exemption with workforce training requirements.",
    legislation: [
      {
        id: "mo-sb95",
        billCode: "SB 95",
        title: "Missouri Data Center Sales Tax Exemption Act",
        summary:
          "Sales tax exemption for qualifying data center investments paired with mandatory workforce training partnerships.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-26",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "nebraska",
    geoId: "Nebraska",
    name: "Nebraska",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Nebraska LB 619 (the ImagineNE Act) extends data center incentives and aligns them with public power utility integration requirements.",
    legislation: [
      {
        id: "ne-lb619",
        billCode: "LB 619",
        title: "ImagineNE Data Center Incentive Act",
        summary:
          "Extended sales and personal property tax exemption for data centers integrated with Nebraska public power district planning.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-11",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "new-mexico",
    geoId: "New Mexico",
    name: "New Mexico",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "New Mexico HB 78 offers data center tax incentives focused on solar-rich areas of the southern part of the state.",
    legislation: [
      {
        id: "nm-hb78",
        billCode: "HB 78",
        title: "Solar Data Center Investment Act",
        summary:
          "Sales tax exemption for data centers paired with PPA commitments above 90% solar in southern New Mexico.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-08",
        partyOrigin: "B",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "utah",
    geoId: "Utah",
    name: "Utah",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Utah HB 348 extends the state's data center sales and use tax exemption and adds priority interconnection for facilities co-located with geothermal generation.",
    legislation: [
      {
        id: "ut-hb348",
        billCode: "HB 348",
        title: "Utah Data Center Geothermal Co-location Act",
        summary:
          "Sales tax exemption and grid priority for data centers co-located with Utah geothermal generation projects.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-15",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "west-virginia",
    geoId: "West Virginia",
    name: "West Virginia",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "West Virginia HB 4571 establishes data center microgrid districts with streamlined permitting and tax incentives, primarily targeting closed coal plant sites.",
    legislation: [
      {
        id: "wv-hb4571",
        billCode: "HB 4571",
        title: "Data Center Microgrid District Act",
        summary:
          "Establishes data center microgrid districts on closed coal plant sites with sales tax exemption and streamlined permitting.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "zoning", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-19",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "florida",
    geoId: "Florida",
    name: "Florida",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Florida HB 1373 expands data center sales and use tax exemptions and adds expedited environmental permitting for qualifying facilities.",
    legislation: [
      {
        id: "fl-hb1373",
        billCode: "HB 1373",
        title: "Florida Data Center Investment Act",
        summary:
          "Expanded sales tax exemption and expedited environmental permitting for qualifying data center investments above $150M.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "job-creation"],
        category: "data-centers",
        updatedDate: "2026-02-23",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },
  {
    id: "oklahoma",
    geoId: "Oklahoma",
    name: "Oklahoma",
    region: "na",
    level: "state",
    stance: "favorable",
    contextBlurb:
      "Oklahoma HB 2596 establishes a data center investment tax credit and prioritizes interconnection in regions with surplus wind generation capacity.",
    legislation: [
      {
        id: "ok-hb2596",
        billCode: "HB 2596",
        title: "Oklahoma Wind-Adjacent Data Center Act",
        summary:
          "Investment tax credit and grid priority for data centers in Oklahoma wind generation surplus zones.",
        stage: "Enacted",
        impactTags: ["tax-exemption", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-06",
        partyOrigin: "R",
      },
    ],
    keyFigures: [],
    news: [],
  },

  // ── US States (no major activity) ──
  {
    id: "alaska",
    geoId: "Alaska",
    name: "Alaska",
    region: "na",
    level: "state",
    stance: "none",
    contextBlurb:
      "No major data center or AI legislation under active consideration in Alaska as of March 2026.",
    legislation: [],
    keyFigures: [],
    news: [],
  },
  {
    id: "montana",
    geoId: "Montana",
    name: "Montana",
    region: "na",
    level: "state",
    stance: "none",
    contextBlurb:
      "No major data center or AI legislation under active consideration in Montana as of March 2026.",
    legislation: [],
    keyFigures: [],
    news: [],
  },

  // ─────────── EU REGION ───────────
  {
    id: "eu-bloc",
    geoId: "eu-bloc",
    name: "European Union",
    region: "eu",
    level: "bloc",
    isOverview: true,
    stance: "favorable",
    contextBlurb:
      "The EU AI Act represents the world's first comprehensive legal framework for artificial intelligence, establishing risk-based requirements for AI systems and strict limits on data center energy consumption.",
    legislation: [
      {
        id: "eu-ai-act",
        billCode: "Reg. 2024/1689",
        title: "Artificial Intelligence Act",
        summary:
          "Risk-based regulation prohibiting unacceptable AI uses, requiring conformity assessments for high-risk systems, and transparency obligations for general-purpose AI models.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-12",
        partyOrigin: "B",
      },
      {
        id: "eu-edd",
        billCode: "Dir. 2023/1791",
        title: "Energy Efficiency Directive (recast)",
        summary:
          "Mandatory reporting and efficiency standards for data centers above 500 kW, including PUE disclosure and waste-heat reuse requirements.",
        stage: "Enacted",
        impactTags: ["emissions", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-02-28",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "eu-vestager",
        name: "Margrethe Vestager",
        role: "Former EVP, Digital Age",
        party: "ALDE",
        stance: "favorable",
        quote:
          "Trustworthy AI requires guardrails — not after harm is done, but before products reach the market.",
      },
      {
        id: "eu-breton",
        name: "Thierry Breton",
        role: "Former Commissioner, Internal Market",
        party: "Renaissance",
        stance: "favorable",
      },
    ],
    news: [
      {
        id: "eu-news-1",
        headline: "EU AI Office issues first guidance on general-purpose models",
        source: "Politico EU",
        date: "2026-03-12",
        url: "#",
      },
      {
        id: "eu-news-2",
        headline: "Member states diverge on data center reporting deadlines",
        source: "Euractiv",
        date: "2026-02-28",
        url: "#",
      },
    ],
  },
  {
    id: "germany",
    geoId: "276",
    name: "Germany",
    region: "eu",
    level: "federal",
    stance: "favorable",
    contextBlurb:
      "Germany is implementing the EU AI Act with additional national provisions on AI in employment and a binding data center efficiency law (EnEfG) requiring 100% renewable power for new facilities by 2027.",
    legislation: [
      {
        id: "de-enefg",
        billCode: "EnEfG §11",
        title: "Energy Efficiency Act — Data Centre Provisions",
        summary:
          "Requires PUE ≤ 1.2 for new data centers, 50% waste-heat reuse, and 100% renewable energy by 2027.",
        stage: "Enacted",
        impactTags: ["emissions", "renewable-mandate"],
        category: "data-centers",
        updatedDate: "2026-03-27",
        partyOrigin: "B",
      },
      {
        id: "de-ai-employment",
        billCode: "Drs. 20/8129",
        title: "AI in Employment Act",
        summary:
          "Establishes works council co-determination rights over AI systems used in hiring, performance review, and dismissal decisions.",
        stage: "Floor",
        impactTags: [],
        category: "employment",
        updatedDate: "2026-03-10",
        partyOrigin: "D",
      },
    ],
    keyFigures: [
      {
        id: "de-wissing",
        name: "Volker Wissing",
        role: "Federal Minister for Digital and Transport · EnEfG sponsor",
        party: "FDP",
        stance: "favorable",
        quote:
          "Germany cannot lead on AI without first leading on data centre efficiency.",
      },
      {
        id: "de-mast",
        name: "Katja Mast",
        role: "MdB · SPD · Lead, AI in Employment Act",
        party: "SPD",
        stance: "favorable",
        quote:
          "Workers must have a seat at the table when AI decides who gets hired or fired.",
      },
      {
        id: "de-rasche",
        name: "Maria-Lena Weiss",
        role: "MdB · CDU · Digital Committee Ranking Member",
        party: "CDU",
        stance: "review",
      },
    ],
    news: [
      {
        id: "de-news-1",
        headline: "Frankfurt operators warn EnEfG renewables deadline is unworkable",
        source: "Handelsblatt",
        date: "2026-03-27",
        url: "#",
      },
      {
        id: "de-news-2",
        headline: "Bundestag committee advances AI co-determination bill",
        source: "Süddeutsche Zeitung",
        date: "2026-03-10",
        url: "#",
      },
    ],
  },
  {
    id: "france",
    geoId: "250",
    name: "France",
    region: "eu",
    level: "federal",
    stance: "review",
    contextBlurb:
      "France is positioning itself as the European AI capital while CNIL has flagged data center water consumption as an urgent regulatory gap. The government's AI sovereignty strategy emphasizes domestic compute capacity.",
    legislation: [
      {
        id: "fr-loi-num",
        billCode: "PJL-AN 2024-512",
        title: "Loi pour la Souveraineté Numérique",
        summary:
          "Establishes a national framework for sovereign cloud certification and data center siting near low-carbon power sources.",
        stage: "Committee",
        impactTags: [],
        category: "data-centers",
        updatedDate: "2026-03-05",
        partyOrigin: "B",
      },
      {
        id: "fr-cnil-water",
        billCode: "Arr. CNIL-2025",
        title: "CNIL Water Use Disclosure Order",
        summary:
          "Mandates water consumption disclosure for data centers exceeding 5 MW under expanded environmental reporting authority.",
        stage: "Enacted",
        impactTags: ["water"],
        category: "data-centers",
        updatedDate: "2026-03-22",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "fr-bothorel",
        name: "Éric Bothorel",
        role: "Deputy · Renaissance · Chair, AI Working Group",
        party: "Renaissance",
        stance: "favorable",
        quote:
          "Sovereignty is about controlling the stack — from chips to data to deployment.",
      },
      {
        id: "fr-de-montchalin",
        name: "Amélie de Montchalin",
        role: "Senator · Renaissance · Lead, Loi pour la Souveraineté Numérique",
        party: "Renaissance",
        stance: "favorable",
      },
      {
        id: "fr-bayou",
        name: "Julien Bayou",
        role: "Deputy · EELV · Water-use disclosure advocate",
        party: "EELV",
        stance: "restrictive",
        quote:
          "Marseille's data centres cannot drink the Rhône dry while families ration water.",
      },
    ],
    news: [
      {
        id: "fr-news-1",
        headline: "Marseille tech hub sees pushback over freshwater cooling",
        source: "Le Monde",
        date: "2026-03-22",
        url: "#",
      },
      {
        id: "fr-news-2",
        headline: "France earmarks €2.5B for sovereign AI compute under France 2030",
        source: "Les Echos",
        date: "2026-03-05",
        url: "#",
      },
    ],
  },
  {
    id: "united-kingdom",
    geoId: "826",
    name: "United Kingdom",
    region: "eu",
    level: "federal",
    stance: "review",
    // (key figures populated below)
    contextBlurb:
      "Post-Brexit, the UK has pursued a pro-innovation, principles-based AI approach distinct from the EU AI Act. Recent grid pressures from data center growth have prompted a National Grid load-zone review.",
    legislation: [
      {
        id: "uk-ai-bill",
        billCode: "HL Bill 11",
        title: "Artificial Intelligence (Regulation) Bill",
        summary:
          "Establishes a UK AI Authority with cross-sectoral coordination duties and a statutory duty to consult on high-risk model evaluations.",
        stage: "Committee",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-28",
        partyOrigin: "B",
      },
      {
        id: "uk-grid",
        billCode: "Ofgem CR-2025/04",
        title: "Data Centre Connection Code Review",
        summary:
          "Ofgem consultation on new connection queue rules for sub-50 MW data center loads following grid congestion in West London.",
        stage: "Filed",
        impactTags: ["grid-strain"],
        category: "data-centers",
        updatedDate: "2026-03-13",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "uk-clement-jones",
        name: "Lord Tim Clement-Jones",
        role: "Peer · Lib Dem · Lead, HL Bill 11",
        party: "Lib Dem",
        stance: "favorable",
        quote:
          "A principles-based UK approach still needs a regulator with statutory teeth.",
      },
      {
        id: "uk-onwurah",
        name: "Chi Onwurah",
        role: "MP · Labour · Shadow Minister, Science & Innovation",
        party: "Labour",
        stance: "review",
        quote:
          "Innovation that nobody trusts isn't innovation. The AI Authority must be properly empowered.",
      },
      {
        id: "uk-vaizey",
        name: "Lord Ed Vaizey",
        role: "Peer · Conservative · Communications and Digital Committee",
        party: "Conservative",
        stance: "concerning",
      },
    ],
    news: [
      {
        id: "uk-news-1",
        headline: "DSIT publishes pre-deployment evaluation framework",
        source: "Financial Times",
        date: "2026-03-28",
        url: "#",
      },
      {
        id: "uk-news-2",
        headline: "West London council blocks 200 MW data center expansion",
        source: "BBC News",
        date: "2026-03-13",
        url: "#",
      },
    ],
  },

  // ─────────── ASIA REGION ───────────
  {
    id: "asia-region",
    geoId: "asia-region",
    name: "Asia",
    region: "asia",
    level: "bloc",
    isOverview: true,
    stance: "review",
    contextBlurb:
      "AI governance across Asia varies widely. China maintains strict sovereign data requirements while Japan and South Korea pursue innovation-first frameworks with emerging environmental standards.",
    legislation: [
      {
        id: "asia-overview-1",
        billCode: "—",
        title: "Regional regulatory landscape",
        summary:
          "No pan-Asian AI framework exists. ASEAN issued non-binding guidance in 2024; APEC continues digital economy negotiations.",
        stage: "Filed",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-04",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "asia-koh",
        name: "Tan See Leng",
        role: "Singapore · Minister for Manpower & Trade",
        party: "PAP",
        stance: "favorable",
      },
      {
        id: "asia-lim",
        name: "Lim Joon Yong",
        role: "ASEAN Digital Working Group · Lead Negotiator",
        party: "—",
        stance: "review",
      },
    ],
    news: [
      {
        id: "asia-news-1",
        headline: "Japan METI updates voluntary AI guidelines for foundation models",
        source: "Nikkei Asia",
        date: "2026-03-22",
        url: "#",
      },
      {
        id: "asia-news-2",
        headline: "Singapore IMDA opens consultation on data center water use",
        source: "The Straits Times",
        date: "2026-03-04",
        url: "#",
      },
    ],
  },
  {
    id: "japan",
    geoId: "392",
    name: "Japan",
    region: "asia",
    level: "federal",
    stance: "favorable",
    contextBlurb:
      "Japan has pursued an innovation-first approach with voluntary AI guidelines from METI, while the FSA and METI jointly review data center grid integration as part of the GX (Green Transformation) initiative.",
    legislation: [
      {
        id: "jp-ai-guidelines",
        billCode: "METI 2024-G",
        title: "AI Business Operator Guidelines (revised)",
        summary:
          "Voluntary risk management framework for AI developers and deployers, aligned with international interoperability principles.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-22",
        partyOrigin: "B",
      },
      {
        id: "jp-gx-dc",
        billCode: "Bill 213",
        title: "GX Data Centre Promotion Act",
        summary:
          "Provides tax incentives for data centers sited in regions with surplus renewable generation and grid capacity headroom.",
        stage: "Floor",
        impactTags: ["renewable-mandate", "tax-exemption"],
        category: "data-centers",
        updatedDate: "2026-03-26",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "jp-saito",
        name: "Ken Saito",
        role: "Minister of Economy, Trade and Industry · METI guidelines",
        party: "LDP",
        stance: "favorable",
        quote:
          "Voluntary frameworks let Japanese industry lead, not lag, on AI safety.",
      },
      {
        id: "jp-konishi",
        name: "Hiroyuki Konishi",
        role: "Diet Member · CDP · Lead, GX Data Centre Promotion Act",
        party: "CDP",
        stance: "favorable",
      },
      {
        id: "jp-yamada",
        name: "Taro Yamada",
        role: "Diet Member · LDP · Digital Society Committee",
        party: "LDP",
        stance: "review",
      },
    ],
    news: [
      {
        id: "jp-news-1",
        headline: "Hokkaido data center cluster wins GX designation",
        source: "Nikkei Asia",
        date: "2026-03-26",
        url: "#",
      },
      {
        id: "jp-news-2",
        headline: "JEITA publishes interoperability assessment for AI Act compliance",
        source: "The Japan Times",
        date: "2026-03-14",
        url: "#",
      },
    ],
  },
  {
    id: "china",
    geoId: "156",
    name: "China",
    region: "asia",
    level: "federal",
    stance: "restrictive",
    contextBlurb:
      "China maintains the world's most prescriptive AI regime, with mandatory security reviews for generative AI services, content labeling requirements, and aggressive data localization rules paired with significant state compute investment.",
    legislation: [
      {
        id: "cn-genai",
        billCode: "CAC 2023-07",
        title: "Interim Measures for Generative AI Services",
        summary:
          "Requires security assessments, content labeling, and licensed providers for public-facing generative AI services.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-29",
        partyOrigin: "B",
      },
      {
        id: "cn-east-data",
        billCode: "NDRC-2024-DC",
        title: "East Data West Compute Initiative — Phase II",
        summary:
          "National plan directing eastern data center workloads to renewable-rich western provinces, with mandatory PUE caps in eastern hubs.",
        stage: "Enacted",
        impactTags: ["grid-strain", "renewable-mandate", "emissions"],
        category: "data-centers",
        updatedDate: "2026-03-08",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "cn-zhuang",
        name: "Zhuang Rongwen",
        role: "Director · Cyberspace Administration of China",
        party: "CCP",
        stance: "restrictive",
        quote:
          "Generative AI must serve the socialist values of the people; security review is non-negotiable.",
      },
      {
        id: "cn-li",
        name: "Li Lecheng",
        role: "Vice Minister · MIIT · NDRC East Data West Compute lead",
        party: "CCP",
        stance: "restrictive",
      },
      {
        id: "cn-wang",
        name: "Wang Zhigang",
        role: "Former Minister of Science and Technology",
        party: "CCP",
        stance: "favorable",
      },
    ],
    news: [
      {
        id: "cn-news-1",
        headline: "CAC publishes second batch of approved generative AI services",
        source: "Caixin",
        date: "2026-03-29",
        url: "#",
      },
      {
        id: "cn-news-2",
        headline: "Inner Mongolia surpasses Beijing in installed AI compute",
        source: "South China Morning Post",
        date: "2026-03-08",
        url: "#",
      },
    ],
  },
  {
    id: "south-korea",
    geoId: "410",
    name: "South Korea",
    region: "asia",
    level: "federal",
    stance: "favorable",
    contextBlurb:
      "South Korea enacted its AI Basic Act in 2024 establishing a national framework, sandbox provisions, and a national AI safety institute. The Ministry of Trade is studying grid impacts of upcoming hyperscale projects.",
    legislation: [
      {
        id: "kr-ai-bf",
        billCode: "Bill 2206128",
        title: "AI Basic Act",
        summary:
          "Framework establishing high-impact AI categories, regulatory sandbox provisions, and a national AI safety institute.",
        stage: "Enacted",
        impactTags: [],
        category: "ai-regulation",
        updatedDate: "2026-03-25",
        partyOrigin: "B",
      },
      {
        id: "kr-dc-grid",
        billCode: "MOTIE-2025-04",
        title: "Hyperscale Data Centre Grid Integration Act",
        summary:
          "Mandates grid impact assessments and curtailment agreements for data centers exceeding 200 MW.",
        stage: "Committee",
        impactTags: ["grid-strain", "environmental-study"],
        category: "data-centers",
        updatedDate: "2026-03-11",
        partyOrigin: "B",
      },
    ],
    keyFigures: [
      {
        id: "kr-ahn",
        name: "Ahn Cheol-soo",
        role: "National Assembly Member · PPP · Lead, AI Basic Act",
        party: "PPP",
        stance: "favorable",
        quote:
          "Korea must build the safety institute the world will trust to evaluate frontier AI.",
      },
      {
        id: "kr-jo",
        name: "Jo Seoung-lae",
        role: "National Assembly Member · DPK · Lead, MOTIE-2025-04",
        party: "DPK",
        stance: "review",
      },
      {
        id: "kr-park",
        name: "Park Soo-young",
        role: "Minister of Science and ICT",
        party: "PPP",
        stance: "favorable",
      },
    ],
    news: [
      {
        id: "kr-news-1",
        headline: "Korea AI Safety Institute publishes evaluation methodology",
        source: "The Korea Herald",
        date: "2026-03-25",
        url: "#",
      },
      {
        id: "kr-news-2",
        headline: "Naver, Kakao announce joint compliance roadmap for AI Basic Act",
        source: "Yonhap News Agency",
        date: "2026-03-11",
        url: "#",
      },
    ],
  },
];

export function getEntity(geoId: string, region: Region): Entity | null {
  return ENTITIES.find((e) => e.geoId === geoId && e.region === region) ?? null;
}

export function getOverviewEntity(region: Region): Entity | null {
  return ENTITIES.find((e) => e.region === region && e.isOverview) ?? null;
}

export function getEntitiesByRegion(region: Region): Entity[] {
  return ENTITIES.filter((e) => e.region === region);
}
