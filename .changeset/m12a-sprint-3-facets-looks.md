---
'scorpion': minor
---

The service catalogues (`/services` and the public `/catalog/services`) offer three looks for their search and filters, chosen by an administrator in the settings of the services module (`catalogueFilters`), and the same for both catalogues:

- **`combined`**, the default for a new instance: one box for the name and the filters. Typing searches the service names and offers matching filter values; the chosen filters are chips inside the box; clicking into the empty box lists the filters. Type `provider:ipk` (or the filter's name in German) to jump to a filter. On the public page, buttons under the box open each filter.
- **`bar`**: a search box with a row of filter buttons that open a list of values (a sheet at the bottom of a phone), and the chosen filters as chips.
- **`sidebar`**: the filters as lists of checkboxes beside the table, the look so far.

**Existing instances keep `sidebar`** until an administrator switches; the upgrade stores it once at the first start. All three looks behave the same, keep the addresses of filtered lists (`?q=&f.<facet>=<value>`) and are tested with the keyboard alone, with axe in both themes and, for `combined`, with the NVDA screen reader. Both list answers (`GET /api/internal/services` and the public `GET /api/internal/catalog/services`) gain the field `filterStyle`; public API v1 is unchanged.
