# Drug name to NDC lookup: RxNorm

A static browser tool using the public NLM RxNorm API. No API key, external JavaScript library or backend is needed. Internet access is required.

## Coverage modes

| Mode | Included codes |
|---|---|
| Current + historical | Current and historical RxNorm NDC associations |
| Current only | Current RxNorm NDC associations |

Both modes deduplicate codes. Current means a current association to a retrieved RxNorm product, not confirmed marketing availability. Historical dates are RxNorm association release months, not time on the market. No study-date filter is applied.

## Use

1. Open [Drug name to NDC](https://yihuayue.github.io/ndc-lookup/) in a modern browser.
2. Enter one generic name, brand name or ingredient per line. An empty box searches the gray examples: pirtobrutinib (Jaypirca, including CLL), abemaciclib and selpercatinib. Entered names replace the examples. Underscores become spaces and duplicate inputs are removed without regard to case.
3. Choose a coverage mode. **Include combination products** is checked by default. Uncheck for single-ingredient searches to exclude products or packs with additional active ingredients, then click **Find NDCs**.
4. Review the matched drug, code counts and outcomes. Multiple matches require selection before NDC retrieval.
5. Open **NDC mapping** to inspect product names and current/historical coverage. **Data sources & notes** explains the RxNorm API steps and coverage definitions.
6. Click **Export Excel workbook**, then **Download Excel workbook**. One Excel workbook includes all results regardless of display filters.

Prefer base ingredient names for ingredient-wide coverage. Salt names and specific products may be narrower. Review combination products, routes and forms against the intended definition. This tool does not assign ATC or CYP classifications.

## One workbook, three sheets

- **Drug summary:** one row per input, matched concepts, lookup status, NDC and product counts, exclusion counts, and notes / errors. Drugs with no NDCs remain in this sheet.
- **NDC mapping:** one row per input/NDC, matched concepts, products, current/history flags, original association intervals and remapped RxCUIs, current / historical / product / ingredient API URLs, and run metadata.
- **Methods:** source-selection rationale, coverage rules, export definitions, RxNorm release, Eastern timestamps and API documentation.

NDCs are text with leading zeros preserved. Unexpected formats remain raw evidence with blank NDC11 and partial status.

Lookup timestamps in the tool and exports use US Eastern Time (America/New_York), labeled EDT or EST as appropriate. Export filenames use the Eastern calendar date. RxNorm association release months are unchanged.

## Method and source selection

RxNorm provides a common terminology and NDC source for the drug-name and ATC tools, keeping product relationships and historical-association definitions consistent. The tools have different input-resolution steps. Equivalent ingredient/product scopes use the same current and historical NDC APIs. This is a defined retrieval method, not a claim of exhaustive NDC coverage.

Name lookup uses exact names/synonyms (`search=0`, `allsrc=0`), then normalized names (`search=1`); no fuzzy matching. IN/PIN/MIN/BN concepts expand to active SCD/SBD/GPCK/BPCK products. Specific products are queried directly. Current mode uses `getNDCs`; history mode additionally uses `getAllHistoricalNDCs?history=2`.

Codes merge by input name and NDC11, preserving returned NDC relationships and historical intervals. Overall metrics count distinct NDCs across inputs. Requests are cached per batch, retried up to three times, and paced at 220 ms. Stops and failed requests produce PARTIAL exports; unresolved names produce REVIEW exports. Successful zero results are distinct from failures.

The combination filter applies only to searches resolving to a single ingredient (IN or PIN). It checks each candidate product using `related.json?tty=IN` and retains exactly one distinct base ingredient. Multiple ingredients across a whole pack count as a combination; salt forms are not counted separately. Brand (BN), explicit combination (MIN) and specific product / pack inputs keep their matched scope. Missing or failed ingredient checks withhold that product and mark the run Partial. Filtering uses current product relationships before retrieving NDCs, including historical NDCs; it does not independently reclassify historical remapped concepts. The workbook retains the selected setting and exclusion counts; NDC mapping includes ingredient API links for retained products. Detailed excluded-product inventories and the full successful-request log are not exported.

Documentation: [Names](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.findRxcuiByString.html), [products](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getRelatedByType.html), [current NDCs](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getNDCs.html), [historical NDCs](https://lhncbc.nlm.nih.gov/RxNav/APIs/api-RxNorm.getAllHistoricalNDCs.html).
