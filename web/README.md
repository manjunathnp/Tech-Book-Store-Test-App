# Web storefront

`techbookstore-shop.html` is the current single-file UI. It is served by the
adjacent API at `/techbookstore-shop.html`; opening it directly from disk is not
the supported runtime because its requests expect the API origin.

`book-covers/` and `techbookstore-books-catalog.json` are application-owned data
and assets, not automation fixtures.
