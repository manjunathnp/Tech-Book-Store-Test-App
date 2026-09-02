#!/usr/bin/env python3
"""
Builds the companion PDF guide for the Tech Book Store Practice API.

This version is written for an ABSOLUTE BEGINNER who has never touched API
automation. Every step is tiny and spelled out. It also includes a complete,
exhaustive catalog of every test that ships with the project, marked as
positive (happy path) or negative (error path).

Pipeline:
  1. Build a styled HTML document.
  2. Render to a base PDF with wkhtmltopdf.
  3. Overlay a simple 3-line diagonal watermark and a footer (name + clickable
     LinkedIn link + page numbers) on every page with reportlab + pypdf.
"""

import os
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "guide")
os.makedirs(OUT_DIR, exist_ok=True)

BRAND_NAME = "Manjunath N P"
LINKEDIN_TEXT = "linkedin.com/in/manjunathnp"
LINKEDIN_URL = "https://www.linkedin.com/in/manjunathnp/"
WATERMARK_TEXT = "MANJUNATH N P  |  linkedin.com/in/manjunathnp"
DOC_TITLE = "Tech Book Store Practice API"
DOC_SUBTITLE = "A Beginner's Step by Step Guide to API Test Automation with Playwright"

# ---------------------------------------------------------------------------
# The complete list of automated tests, so the guide can print an exhaustive,
# accurate catalog. kind: "pos" (happy path) or "neg" (error / unhappy path).
# ---------------------------------------------------------------------------

PLAYWRIGHT_TESTS = [
    ("Smoke (first checks)", [
        ("The health endpoint replies with status ok.", "pos"),
        ("The API index lists the available resources.", "pos"),
        ("The books list comes back in the standard data plus meta shape.", "pos"),
    ]),
    ("Books: create, read, update, delete", [
        ("Read a seeded book by its id and confirm it has an ETag.", "pos"),
        ("An admin creates a book and gets 201 with a Location header.", "pos"),
        ("A PATCH changes one field and the version number goes up by one.", "pos"),
        ("A PUT replaces the whole book record.", "pos"),
        ("An admin deletes a book, then reading it returns 410 Gone.", "pos"),
    ]),
    ("Books: list query features", [
        ("Page and limit values are honoured, and the seed has 60 books.", "pos"),
        ("A huge limit is capped at the server maximum of 100.", "pos"),
        ("Sorting by price, highest first, returns items in that order.", "pos"),
        ("Filtering by in stock true returns only in stock books.", "pos"),
        ("Filtering by a price range returns only books inside the range.", "pos"),
        ("Search finds books ignoring upper or lower case.", "pos"),
        ("Asking for only id and title returns just those two fields.", "pos"),
    ]),
    ("Authentication and roles", [
        ("Login returns both an access token and a refresh token.", "pos"),
        ("A protected route with no token is rejected with 401.", "neg"),
        ("The me endpoint returns the logged in user.", "pos"),
        ("A normal user creating a book is refused with 403.", "neg"),
        ("Refresh returns new tokens, and the old refresh token stops working.", "neg"),
        ("Logout makes the access token stop working (401 afterwards).", "neg"),
        ("Register creates a normal user and returns tokens.", "pos"),
        ("Registering an email that already exists is refused with 409.", "neg"),
    ]),
    ("Other login styles", [
        ("An API key request with no key is rejected with 401.", "neg"),
        ("An API key request with the correct key is accepted.", "pos"),
        ("An API key request with a wrong key is rejected with 401.", "neg"),
        ("Basic auth with correct credentials is accepted.", "pos"),
        ("Basic auth with wrong credentials is rejected with 401.", "neg"),
    ]),
    ("Chaining: cart to order", [
        ("Add items, check out, read the order back, then cancel it.", "pos"),
        ("Sending the same idempotency key twice returns the same order.", "pos"),
        ("Checking out with an empty cart is refused with 409.", "neg"),
        ("A different user cannot read your order (403).", "neg"),
    ]),
    ("Chaining: books and reviews", [
        ("Create a book, post a review to it, then read the review back.", "pos"),
        ("Reviewing the same book twice as one user is refused with 409.", "neg"),
        ("Reviewing without logging in is refused with 401.", "neg"),
    ]),
    ("Error and boundary handling", [
        ("Reading a book id that does not exist returns 404.", "neg"),
        ("Calling a route that does not exist returns 404.", "neg"),
        ("Using the wrong method returns 405 with an Allow header.", "neg"),
        ("Sending a non JSON body returns 415.", "neg"),
        ("Sending broken JSON returns 400.", "neg"),
        ("Invalid fields return 422 with a details list of what is wrong.", "neg"),
        ("A book pointing at a missing author returns 422 naming authorId.", "neg"),
        ("Creating a book with no token returns 401.", "neg"),
        ("The status generator returns whatever code you ask for.", "pos"),
    ]),
    ("Advanced behaviours", [
        ("Reading gives an ETag, and an update with a matching ETag succeeds.", "pos"),
        ("An update with a stale ETag is refused with 412.", "neg"),
        ("Going over the rate limit returns 429 with a Retry-After header.", "neg"),
        ("The delay endpoint really waits before replying.", "pos"),
        ("A deleted book returns 410 and is hidden from the normal list.", "neg"),
        ("Restore brings a soft deleted book back so it reads with 200 again.", "pos"),
    ]),
]

POSTMAN_FOLDERS = [
    ("00 Setup", "Reset the data to a known starting point.", 1),
    ("01 Health and Info", "Confirm the server is alive and lists its resources.", 2),
    ("02 Auth", "Register, log in as admin, user, and shopper, read the profile, "
     "refresh tokens, and try the wrong password, API key, and Basic auth.", 10),
    ("03 Books", "List, page, sort, search, filter, sparse fields, get one, and the "
     "full admin lifecycle including 401, 403, 422, 412, soft delete, restore, 405.", 18),
    ("04 Authors, Categories, Publishers", "List and read the simple resources, create "
     "one as admin, and confirm a normal user is refused with 403.", 6),
    ("05 Reviews", "Create a review under a book, list it, get a 409 on a duplicate, "
     "and update your own review.", 4),
    ("06 Cart and Wishlist", "Empty the cart, add items, view totals, change quantity, "
     "and add to the wishlist.", 7),
    ("07 Orders", "Check out with an idempotency key, replay it, read and list orders, "
     "get a 403 as another user, cancel, and see 409 on a second cancel or empty cart.", 8),
    ("08 Negative and Status Codes", "Trigger 415, 400, and generate 418, 503, and 204 "
     "on demand.", 5),
    ("09 Advanced", "Exercise the delay endpoint and push the rate limit until it returns 429.", 7),
]

# Every Postman request, folder by folder, so the catalog can list them all.
POSTMAN_REQUESTS = [
    ("00 Setup", ["Reset data"]),
    ("01 Health and Info", ["Health", "API index"]),
    ("02 Auth", [
        "Register new user", "Login as admin", "Login as user", "Login as shopper (Sam)",
        "Get current user (me)", "Login with wrong password (401)", "Refresh tokens (rotation)",
        "API key endpoint (200)", "API key endpoint wrong key (401)", "Basic auth endpoint (200)",
    ]),
    ("03 Books", [
        "List books", "List books page 2 limit 5", "Sort by price desc", "Search playwright",
        "Filter inStock and price range", "Sparse fields id,title", "Get book 1 (capture ETag)",
        "Get missing book (404)", "Create book without token (401)", "Create book as user (403)",
        "Create book invalid (422)", "Create book (admin), capture id and ETag",
        "Update with stale If-Match (412)", "Update with correct If-Match (200)",
        "Soft delete book (204)", "Get soft-deleted book (410)", "Restore book (200)",
        "Method not allowed on collection (405)",
    ]),
    ("04 Authors, Categories, Publishers", [
        "List authors", "Get author 1", "Create author (admin)", "List categories",
        "List publishers", "Create category as user (403)",
    ]),
    ("05 Reviews", [
        "Create review under book 45", "List reviews for book 45",
        "Duplicate review (409)", "Update own review",
    ]),
    ("06 Cart and Wishlist", [
        "Empty cart first", "Add book 2 x2 to cart", "Add book 3 to cart", "View cart",
        "Update cart item quantity", "Add to wishlist", "View wishlist",
    ]),
    ("07 Orders", [
        "Checkout (create order) with Idempotency-Key", "Replay checkout (same key, same order)",
        "Get order", "List my orders", "Another user cannot view my order (403)",
        "Cancel order", "Cancel again (409)", "Checkout empty cart (409)",
    ]),
    ("08 Negative and Status Codes", [
        "415 wrong content type", "400 bad JSON body", "Status generator 418",
        "Status generator 503", "Status generator 204",
    ]),
    ("09 Advanced", [
        "Delay 800ms", "Rate limit hit 1", "Rate limit hit 2", "Rate limit hit 3",
        "Rate limit hit 4 (likely 429)", "Rate limit hit 5 (likely 429)", "Rate limit hit 6 (likely 429)",
    ]),
]

# ---------------------------------------------------------------------------
# Styling. Plain language throughout. No em dashes anywhere.
# ---------------------------------------------------------------------------

CSS = """
@page { margin: 22mm 18mm 24mm 18mm; }
* { box-sizing: border-box; }
body { font-family: "Liberation Serif", "Georgia", serif; font-size: 11.4pt; line-height: 1.55; color: #1a2230; margin: 0; }
h1, h2, h3, h4 { font-family: "Liberation Sans", "Helvetica", sans-serif; color: #0b3a4a; line-height: 1.25; }
h1 { font-size: 20pt; margin: 0 0 8pt; }
h2 { font-size: 15.5pt; margin: 18pt 0 7pt; border-bottom: 2px solid #0e7490; padding-bottom: 3pt; }
h3 { font-size: 12.6pt; margin: 13pt 0 4pt; color: #0e7490; }
h4 { font-size: 11.2pt; margin: 9pt 0 3pt; color: #1f3d52; }
p { margin: 0 0 8pt; }
ul, ol { margin: 0 0 8pt; padding-left: 18pt; }
li { margin: 0 0 4pt; }
code { font-family: "Liberation Mono", "Consolas", monospace; font-size: 9.8pt; background: #eef3f6; padding: 1px 4px; border-radius: 3px; color: #0b3a4a; }
pre { background: #0b1220; color: #e6edf3; font-family: "Liberation Mono", "Consolas", monospace; font-size: 9.1pt; line-height: 1.42; padding: 10pt 12pt; border-radius: 6px; margin: 0 0 10pt; white-space: pre-wrap; page-break-inside: avoid; }
table { width: 100%; border-collapse: collapse; margin: 0 0 10pt; font-size: 9.8pt; page-break-inside: avoid; }
th, td { border: 1px solid #cdd9e0; padding: 5pt 7pt; text-align: left; vertical-align: top; }
th { background: #e3eef2; font-family: "Liberation Sans", sans-serif; color: #0b3a4a; }
.step { background: #f5f9fb; border: 1px solid #d8e6ec; border-radius: 6px; padding: 9pt 12pt 9pt 12pt; margin: 0 0 9pt; page-break-inside: avoid; }
.step .num { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #fff; background: #0e7490; border-radius: 50%; display: inline-block; width: 18pt; height: 18pt; text-align: center; line-height: 18pt; font-size: 9.5pt; margin-right: 6pt; }
.step .t { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #0b3a4a; font-size: 10.6pt; }
.callout { background: #f1f8fb; border-left: 4px solid #0e7490; padding: 8pt 12pt; margin: 0 0 10pt; border-radius: 0 4px 4px 0; page-break-inside: avoid; }
.callout .lead { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #0b3a4a; font-size: 10.5pt; }
.everyday { background: #fff7ed; border-left: 4px solid #c05621; padding: 8pt 12pt; margin: 0 0 10pt; border-radius: 0 4px 4px 0; page-break-inside: avoid; }
.everyday .lead { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #9a3412; font-size: 10.5pt; }
.warn { background: #fef2f2; border-left: 4px solid #dc2626; padding: 8pt 12pt; margin: 0 0 10pt; border-radius: 0 4px 4px 0; page-break-inside: avoid; }
.warn .lead { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #b91c1c; font-size: 10.5pt; }
.small { font-size: 9.5pt; color: #4b5b68; }
.kv { font-family: "Liberation Mono", monospace; font-size: 9.6pt; }
.page-break { page-break-before: always; }
.toc p { margin: 3pt 0; }
.toc .num { color: #0e7490; font-family: "Liberation Sans", sans-serif; font-weight: bold; }
.cover { text-align: center; padding-top: 55mm; }
.cover .badge { display: inline-block; border: 2px solid #0e7490; color: #0e7490; font-family: "Liberation Sans", sans-serif; font-size: 10pt; letter-spacing: 2px; padding: 4pt 14pt; border-radius: 20px; margin-bottom: 16mm; }
.cover h1 { font-size: 29pt; color: #0b3a4a; margin-bottom: 6pt; }
.cover .sub { font-family: "Liberation Sans", sans-serif; font-size: 13pt; color: #0e7490; margin-bottom: 36mm; }
.cover .meta { font-family: "Liberation Sans", sans-serif; font-size: 10.5pt; color: #4b5b68; line-height: 1.7; }
.pos { color: #15803d; font-weight: bold; font-family: "Liberation Sans", sans-serif; font-size: 8.6pt; }
.neg { color: #b91c1c; font-weight: bold; font-family: "Liberation Sans", sans-serif; font-size: 8.6pt; }
.tcount { font-family: "Liberation Sans", sans-serif; color: #0b3a4a; font-weight: bold; }
.glossary dt { font-family: "Liberation Sans", sans-serif; font-weight: bold; color: #0b3a4a; margin-top: 7pt; font-size: 10.6pt; }
.glossary dd { margin: 1pt 0 0 0; }
"""


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def code(text):
    return f"<pre>{esc(text)}</pre>"


def step(n, title, html):
    return f'<div class="step"><div><span class="num">{n}</span><span class="t">{title}</span></div><div style="margin-top:5pt;">{html}</div></div>'


def build_html():
    P = []
    a = P.append

    # ---------------- Cover ----------------
    a(f"""
    <div class="cover">
      <div class="badge">BEGINNER FRIENDLY</div>
      <h1>{DOC_TITLE}</h1>
      <div class="sub">{DOC_SUBTITLE}</div>
      <div class="meta">
        Start from zero. No prior API knowledge needed.<br/>
        Run a real API on your own computer, send your first request,<br/>
        then automate your first tests with Playwright, one tiny step at a time.<br/><br/>
        Prepared by {BRAND_NAME}<br/>
        {LINKEDIN_TEXT}
      </div>
    </div>
    <div class="page-break"></div>
    """)

    # ---------------- TOC ----------------
    a("""
    <h1>What is inside this guide</h1>
    <div class="toc">
      <p><span class="num">Part 1.</span> The absolute basics, explained in plain words</p>
      <p><span class="num">Part 2.</span> Set up your practice lab, step by tiny step</p>
      <p><span class="num">Part 3.</span> Send your very first request by hand</p>
      <p><span class="num">Part 4.</span> Explore safely with the built in documentation page</p>
      <p><span class="num">Part 5.</span> Your first automated test with Playwright</p>
      <p><span class="num">Part 6.</span> Running the tests in VS Code, click by click</p>
      <p><span class="num">Part 7.</span> Running the Postman collection, click by click</p>
      <p><span class="num">Part 8.</span> Read a real test, line by line</p>
      <p><span class="num">Part 9.</span> The complete catalog of tests (positive and negative)</p>
      <p><span class="num">Part 10.</span> Four advanced ideas, made simple</p>
      <p><span class="num">Part 11.</span> A plain word glossary</p>
      <p><span class="num">Part 12.</span> When something goes wrong</p>
    </div>
    <div class="page-break"></div>
    """)

    # ---------------- Part 1: Basics ----------------
    a("""
    <h1>Part 1. The absolute basics, explained in plain words</h1>
    <p>If you have never tested an API before, this part gives you the whole picture in a few minutes. Read it once, slowly. You do not need to memorize anything. Every term here appears again later with an example.</p>

    <h3>What is an API?</h3>
    <p>API stands for Application Programming Interface. That sounds heavy, so here is the simple version: an API is a way for one program to ask another program to do something, using messages instead of buttons and screens.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      Think of a restaurant. You do not walk into the kitchen and cook. You give your order to a waiter, the kitchen prepares it, and the waiter brings back your food. An API is the waiter. Your program places an order (a request), the server does the work, and it sends back a result (a response).
    </div>

    <h3>What is a request and a response?</h3>
    <p>Every interaction with an API is one request and one response.</p>
    <ul>
      <li>A <b>request</b> is the message you send. It says what you want, for example "give me book number 1" or "create a new book with this title and price".</li>
      <li>A <b>response</b> is the message you get back. It contains a result and a short status number that says how it went.</li>
    </ul>

    <h3>What is a method?</h3>
    <p>Every request carries a method, which is a single word describing the kind of action. You will use five of them.</p>
    <table>
      <tr><th>Method</th><th>Means</th><th>Example</th></tr>
      <tr><td class="kv">GET</td><td>Read something, change nothing</td><td>Get the list of books</td></tr>
      <tr><td class="kv">POST</td><td>Create something new</td><td>Add a new book</td></tr>
      <tr><td class="kv">PUT</td><td>Replace something completely</td><td>Replace a whole book record</td></tr>
      <tr><td class="kv">PATCH</td><td>Change part of something</td><td>Change only a book's price</td></tr>
      <tr><td class="kv">DELETE</td><td>Remove something</td><td>Delete a book</td></tr>
    </table>

    <h3>What is a status code?</h3>
    <p>Every response comes with a three digit number that summarizes the outcome. You do not need all of them, just the families.</p>
    <table>
      <tr><th>Range</th><th>Meaning</th><th>Common ones you will see</th></tr>
      <tr><td class="kv">2xx</td><td>Success</td><td>200 ok, 201 created, 204 done with no content</td></tr>
      <tr><td class="kv">4xx</td><td>You made a mistake</td><td>400 bad request, 401 not logged in, 403 not allowed, 404 not found, 409 conflict, 422 invalid fields, 429 too many requests</td></tr>
      <tr><td class="kv">5xx</td><td>The server had a problem</td><td>500 internal error</td></tr>
    </table>
    <div class="callout">
      <div class="lead">Why this matters</div>
      Most of API testing is checking that you get the right status code for a given request. A good test does not only check the happy path (a 200). It also checks that a bad request gets the correct error, for example that creating a book without logging in returns 401, not a success.
    </div>

    <h3>What is JSON?</h3>
    <p>JSON is the format the messages are written in. It is just text, arranged as names and values inside curly braces. Here is a tiny book in JSON.</p>
    """)
    a(code('{\n  "id": 1,\n  "title": "Playwright End to End Testing",\n  "price": 19.99,\n  "inStock": false\n}'))
    a("""
    <p>You can read it left to right: the id is 1, the title is that text, the price is 19.99, and inStock is false. That is all JSON is. Curly braces hold an object. Square brackets hold a list. Text goes in double quotes. Numbers and true or false do not.</p>

    <h3>What is a header?</h3>
    <p>A header is a small label attached to a request or response, separate from the main body. Two headers matter most for you.</p>
    <ul>
      <li><b>Content-Type</b> tells the server what kind of body you are sending. When you send JSON, you set it to <code>application/json</code>.</li>
      <li><b>Authorization</b> carries your login token so the server knows who you are.</li>
    </ul>

    <h3>So what is API test automation?</h3>
    <p>It is writing small programs that send requests to an API and automatically check the responses, instead of you clicking through screens by hand. A test might log in, create a book, then confirm the book reads back correctly. If the API ever breaks, the test fails and tells you at once. That is the whole job, and this project is where you will practise it safely.</p>
    """)

    # ---------------- Part 2: Setup ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 2. Set up your practice lab, step by tiny step</h1>
    <p>Do these in order. Each step is small. After this part you will have a real API running on your own computer.</p>

    <h3>The terminal, in one paragraph</h3>
    <p>The terminal is a window where you type commands instead of clicking. On Windows, open the Start menu, type <b>PowerShell</b>, and press Enter. On a Mac, open Spotlight with Command and Space, type <b>Terminal</b>, and press Enter. A window opens with a blinking cursor. That is where every command below goes. You type the command, then press Enter.</p>
    """)
    a(step(1, "Install Node.js",
           "<p>Node.js is the program that runs the API. Open a web browser, go to <b>nodejs.org</b>, and download the version labelled LTS (it means long term support, the stable one). Run the installer and keep clicking Next with the default choices. When it finishes, close and reopen your terminal.</p>"
           "<p>Check it worked by typing this and pressing Enter:</p>" + code("node --version") +
           "<p>You should see a version number such as <code>v20.11.0</code>. Any number that starts with 18, 20, or higher is fine. If you see a number, Node is installed.</p>"))
    a(step(2, "Get the project onto your computer",
           "<p>Unzip the project folder somewhere easy to find, for example your Desktop. You will get a folder named <code>Tech-Book-Store-Upgrade</code>. It contains a clean <code>application</code> folder and a separate <code>automation</code> folder.</p>"))
    a(step(3, "Move into the API folder",
           "<p>In the terminal, type <code>cd</code> (which means change directory), a space, then the path to the API inside the project. It will look something like this:</p>" + code("cd Desktop/Tech-Book-Store-Upgrade/application/api")))
    a(step(4, "Start the server",
           "<p>Type this and press Enter:</p>" + code("node server.js") +
           "<p>The window prints a short banner and then seems to pause. That pause is good: it means the server is running and waiting for requests. You will see the addresses to use and the login accounts:</p>" +
           code("Base URL   : http://127.0.0.1:3000\n"
                "API docs   : http://127.0.0.1:3000/docs\n\n"
                "admin@bookstore.test / admin123      (role: admin)\n"
                "user@bookstore.test  / password123   (role: user)")))
    a("""
    <div class="warn">
      <div class="lead">Do not close this window</div>
      The server runs only while this terminal window stays open. Leave it running and open a second terminal window for the next commands. To stop the server later, click back into this window and press the Control key and C together.
    </div>
    <p class="small">The address 127.0.0.1 always means "this same computer". Port 3000 is just the door number the server listens on. So http://127.0.0.1:3000 means "my own computer, door 3000".</p>
    """)

    # ---------------- Part 3: First request ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 3. Send your very first request by hand</h1>
    <p>You have a running API. Let us talk to it. There are three easy ways, from simplest to most useful.</p>

    <h3>Way one: your web browser</h3>
    <p>A browser sends a GET request when you visit an address. Open a new browser tab and type this in the address bar:</p>
    """)
    a(code("http://127.0.0.1:3000/api/books?limit=3"))
    a("""
    <p>Press Enter. You will see a block of JSON with three books inside a <code>data</code> list, and a <code>meta</code> block below it. That is a real API response. You just made your first request.</p>

    <h3>Way two: the built in documentation page</h3>
    <p>Open <code>http://127.0.0.1:3000/docs</code> in your browser. This is a friendly page that lists every endpoint and lets you send requests by clicking. Part 4 walks through it. For most beginners this is the nicest way to explore.</p>

    <h3>Way three: the curl command</h3>
    <p>curl is a small tool for sending requests from the terminal. It comes built in on modern Windows and Mac. In your second terminal window, try this:</p>
    """)
    a(code("curl http://127.0.0.1:3000/api/books/1"))
    a("<p>You get back book number 1 as JSON. To create a book you must prove you are an admin, which takes two steps. First, log in and copy the access token from the reply:</p>")
    a(code('curl -X POST http://127.0.0.1:3000/api/auth/login \\\n'
           "  -H 'Content-Type: application/json' \\\n"
           '  -d \'{"email":"admin@bookstore.test","password":"admin123"}\''))
    a("<p>The reply contains a long <code>accessToken</code>. Copy it. Then paste it into the next command where it says PASTE_TOKEN_HERE:</p>")
    a(code('curl -X POST http://127.0.0.1:3000/api/books \\\n'
           '  -H "Authorization: Bearer PASTE_TOKEN_HERE" \\\n'
           "  -H 'Content-Type: application/json' \\\n"
           '  -d \'{"title":"My First Book","authorId":1,"categoryId":1,"price":19.99}\''))
    a("""
    <p>You get back the new book with a fresh id and a status of 201, which means created. Congratulations: you have now read and created data through an API.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      Logging in and getting a token is like collecting a wristband at the entrance of an event. After that, you flash the wristband (the token in the Authorization header) instead of showing your ticket again at every stall.
    </div>
    """)

    # ---------------- Part 4: Docs page ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 4. Explore safely with the built in documentation page</h1>
    <p>Open <code>http://127.0.0.1:3000/docs</code>. This page is organized like the professional API docs testers use every day. Here is how to drive it, with nothing left out.</p>
    """)
    a(step(1, "Find your way around",
           "<p>On the left is a list of sections (Auth, Books, Cart, and so on) with a filter box at the top. In the middle is the same list as clickable rows. Each row is colored by its method: blue for GET, green for POST, orange for PUT, teal for PATCH, and red for DELETE.</p>"))
    a(step(2, "Log in with one click",
           "<p>Click the green <b>Authorize</b> button at the top right. A small window opens. Press <b>Log in as admin</b>. It fills your token behind the scenes and shows that you are signed in. Press <b>Close</b>. You can now use the admin only actions.</p>"))
    a(step(3, "Open an endpoint and read it",
           "<p>Click any row, for example the blue <code>GET /api/books</code>. It expands to show what it does, the parameters you can use, and the possible responses with their status codes. This is how you learn an endpoint before testing it.</p>"))
    a(step(4, "Try it out for real",
           "<p>Inside the expanded endpoint, press <b>Try it out</b>. Fill any fields you like (or leave them blank), then press <b>Execute</b>. The real request goes to the server and the real response appears right there, including the status code and the JSON body. Nothing is pretend.</p>"))
    a(step(5, "Reset whenever you want",
           "<p>If you create or delete things and want a clean slate, open Authorize again and press <b>Reset data</b>. The original 60 books come back. You can do this as often as you like.</p>"))
    a("""
    <div class="callout">
      <div class="lead">A good first exploration</div>
      Try these in order on the docs page: run GET /api/books and read the list. Then Authorize as admin. Then run POST /api/books to create one. Then GET /api/books/61 to read your new book. Then DELETE /api/books/61 and try GET /api/books/61 again to see the 410 Gone. Finally, Reset data. That single loop touches reading, creating, deleting, and error handling.
    </div>
    """)

    # ---------------- Part 5: First Playwright test ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 5. Your first automated test with Playwright</h1>
    <p>Doing things by hand is great for learning. Automation is where testing becomes a real skill. Playwright is a free tool that sends requests and checks the responses for you, again and again, in seconds.</p>

    <h3>What is Playwright, simply?</h3>
    <p>Playwright is a testing tool made by Microsoft. People often use it to click around websites, but it also has a request client for testing APIs directly, with no browser involved. That is what this project uses, so it is fast and needs no browser download.</p>
    """)
    a(step(1, "Install the test tools",
           "<p>Open a terminal in the separate <code>automation</code> folder. From the API folder used earlier, this command takes you there:</p>" + code("cd ../../automation\nnpm install") +
           "<p>This reads the project's list of tools and installs Playwright and TypeScript into a local folder. You only do this once.</p>"))
    a(step(2, "You do not start the server yourself",
           "<p>For the tests, the project is set up to start the server for you automatically and stop it when the tests finish. So you can close the server window from earlier if you like. The tests handle it.</p>"))
    a(step(3, "Run the gentlest lesson first",
           "<p>Type this:</p>" + code("npm run test:smoke") +
           "<p>Playwright quietly starts the server, sends a few simple requests, checks the replies, and prints a green list of passing tests. Seeing that green list is your first automated test run.</p>"))
    a(step(4, "Run the full course",
           "<p>When you are ready, run everything:</p>" + code("npm test") +
           "<p>Then open the nicely formatted report in your browser with:</p>" + code("npm run test:report")))
    a("""
    <h3>The lessons, in the order to learn them</h3>
    <p>The tests are grouped into folders that build on each other. Run them one at a time as you learn.</p>
    <table>
      <tr><th>Command</th><th>What you practise</th></tr>
      <tr><td class="kv">npm run test:smoke</td><td>Send a request, check a status and one field</td></tr>
      <tr><td class="kv">npm run test:crud</td><td>Create, read, update, and delete a book</td></tr>
      <tr><td class="kv">npm run test:query</td><td>Paging, sorting, filtering, and search</td></tr>
      <tr><td class="kv">npm run test:auth</td><td>Tokens, roles, refresh, logout, API key, Basic auth</td></tr>
      <tr><td class="kv">npm run test:chaining</td><td>Cart to order flows and safe retries</td></tr>
      <tr><td class="kv">npm run test:negative</td><td>Every error on purpose</td></tr>
      <tr><td class="kv">npm run test:advanced</td><td>Version conflicts, soft delete, rate limits</td></tr>
    </table>
    """)

    # ---------------- Part 6: Run tests in VS Code ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 6. Running the tests in VS Code, click by click</h1>
    <p>The terminal works, but many people prefer a friendly editor with buttons. VS Code (short for Visual Studio Code) is a free editor from Microsoft that shows your tests with little green play buttons. Here is the whole setup and run, with nothing skipped.</p>
    """)
    a(step(1, "Install VS Code",
           "<p>Open a browser and go to <b>code.visualstudio.com</b>. Download the version for your system (Windows or Mac) and run the installer with the default choices. Open VS Code when it finishes.</p>"))
    a(step(2, "Open the project folder",
           "<p>In VS Code, click the top menu <b>File</b>, then <b>Open Folder</b>. Find and select <code>Tech-Book-Store-Upgrade</code>, then click Open. The left panel shows the separate <code>application</code> and <code>automation</code> folders. If a bar asks whether you trust the authors, click <b>Yes, I trust the authors</b>.</p>"))
    a(step(3, "Open a terminal inside VS Code",
           "<p>Click the top menu <b>Terminal</b>, then <b>New Terminal</b>. A terminal opens at the project root. Move into automation and run the one-time install:</p>" + code("cd automation\nnpm install")))
    a(step(4, "Install the Playwright extension (recommended)",
           "<p>Click the Extensions icon on the far left (it looks like four squares). In the search box type <b>Playwright</b>. Install the one named <b>Playwright Test for VSCode</b> made by Microsoft. This adds a Testing panel with run buttons.</p>"))
    a(step(5, "Run tests with the green play buttons",
           "<p>Click the <b>Testing</b> icon on the far left (a flask or beaker shape). You will see the test files in a tree. Hover over any test or folder and a green triangle appears. Click it to run just that test or that whole group. Green ticks mean pass, red crosses mean fail. Click a test name to jump straight to its code.</p>"))
    a(step(6, "Run everything, or run from the terminal",
           "<p>To run the full suite, press the top level play button in the Testing panel, or use the terminal at the bottom:</p>" + code("npm test") +
           "<p>To run only one lesson, use its script, for example:</p>" + code("npm run test:auth")))
    a(step(7, "Debug a failing test, step by step",
           "<p>If a test fails and you want to watch it run slowly, click just to the left of a line number to place a red dot (a breakpoint). Then, in the Testing panel, right click the test and choose <b>Debug Test</b>. Execution pauses at your red dot so you can inspect what happened. This is the calm way to understand a failure.</p>"))
    a("""
    <div class="callout">
      <div class="lead">Try the visual UI mode</div>
      For a guided, visual experience, run <code>npm run test:headed:ui</code> in the terminal. A window opens where you can pick tests, watch them run, and see each request and response in a timeline. It is the friendliest way to learn what each test does.
    </div>
    """)

    # ---------------- Part 7: Run the Postman collection ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 7. Running the Postman collection, click by click</h1>
    <p>Postman is a popular visual tool for sending requests and running saved checks by clicking, with no coding at all. The project ships a ready made collection so you can test the whole API in Postman in minutes. Make sure the server is running first (Part 2, step 4).</p>
    """)
    a(step(1, "Install Postman",
           "<p>Open a browser, go to <b>postman.com/downloads</b>, download Postman for your system, and install it. Open it when done. You can skip creating an account: look for a small <b>Skip and go to the app</b> or <b>Continue without an account</b> link.</p>"))
    a(step(2, "Import the collection and the environment",
           "<p>In Postman, click the <b>Import</b> button (top left). Drag these two files from <code>application/api/postman</code> into it, then confirm:</p>"
           "<ul><li><code>TechBookStore.postman_collection.json</code> (the requests and their checks)</li>"
           "<li><code>TechBookStore.postman_environment.json</code> (the base address)</li></ul>"))
    a(step(3, "Select the environment",
           "<p>At the top right there is a dropdown that usually says <b>No Environment</b>. Click it and choose <b>Tech Book Store (Local)</b>. This tells Postman that the base address is http://127.0.0.1:3000. Nothing works correctly until you do this.</p>"))
    a(step(4, "Send your first request",
           "<p>On the left, expand the collection <b>Tech Book Store Practice API</b>, open the folder <b>01 Health and Info</b>, and click <b>Health</b>. Press the blue <b>Send</b> button. The response appears in the lower panel. Click the <b>Test Results</b> tab there to see the checks pass with green ticks.</p>"))
    a(step(5, "Log in so later requests work",
           "<p>Open the <b>00 Setup</b> folder and send <b>Reset data</b> once. Then open <b>02 Auth</b> and send <b>Login as admin</b>, <b>Login as user</b>, and <b>Login as shopper (Sam)</b>. These quietly save your tokens into the collection so the Books, Cart, and Orders folders can use them. You do not copy anything by hand.</p>"))
    a(step(6, "Run the entire collection at once",
           "<p>To run everything in order, hover over the collection name <b>Tech Book Store Practice API</b>, click the three dots, and choose <b>Run collection</b>. The Collection Runner opens. Keep the order as shown, make sure the environment is still selected, and press <b>Run Tech Book Store Practice API</b>. Postman fires all 68 requests and shows a full pass or fail summary.</p>"))
    a(step(7, "Read the results",
           "<p>Each request shows how many checks passed. Green means pass, red means fail, with the reason next to it. A clean run is all green. If you see red, the most common cause is forgetting to select the environment (step 3) or not running the login requests first (step 5).</p>"))
    a("""
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      The collection is like a recipe card box with the cards already in order. The first card preps the kitchen (reset), the next few sign you in, and each later card assumes that prep is done. Run them in order and dinner comes out right every time.
    </div>
    """)

    # ---------------- Part 8: Read a test line by line ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 8. Read a real test, line by line</h1>
    <p>Here is one real test from the smoke lesson. Do not worry about writing it yet. Just read the explanation next to each idea. Once this makes sense, every other test in the project will look familiar.</p>
    """)
    a(code(
        "test('health endpoint responds ok', async ({ request }) => {\n"
        "  const res = await request.get('/health');\n"
        "  expect(res.status()).toBe(200);\n\n"
        "  const body = await res.json();\n"
        "  expect(body.status).toBe('ok');\n"
        "});"
    ))
    a("""
    <ul>
      <li><code>test('...', ...)</code> defines one test and gives it a name. The name is what you see in the pass or fail list.</li>
      <li><code>async</code> and <code>await</code> simply mean "wait for this to finish before moving on". Network calls take a moment, so we wait for each one.</li>
      <li><code>request.get('/health')</code> sends a GET request to the health endpoint. The result is stored in <code>res</code>, short for response.</li>
      <li><code>expect(res.status()).toBe(200)</code> is a check. It reads "I expect the status to be 200". If it is not, the test fails.</li>
      <li><code>res.json()</code> turns the response body into an object you can read.</li>
      <li><code>expect(body.status).toBe('ok')</code> checks that the field named status equals the text ok.</li>
    </ul>
    <p>That is the entire pattern of API testing: send a request, then write one or more expect checks about the response. Everything else is variations on this. A negative test looks the same, but the expected status is an error such as 401 or 404.</p>

    <div class="callout">
      <div class="lead">The one habit worth copying</div>
      The project logs in once and builds a helper that carries your token automatically, so tests do not repeat the login. You will see helpers named adminApi and shopperApi in the tests. When you write your own tests, copy that idea. It keeps tests short and clean.
    </div>
    """)

    # ---------------- Part 7: Exhaustive test catalog ----------------
    total_pw = sum(len(items) for _, items in PLAYWRIGHT_TESTS)
    pos_pw = sum(1 for _, items in PLAYWRIGHT_TESTS for _, k in items if k == "pos")
    neg_pw = total_pw - pos_pw
    total_pm = sum(n for _, _, n in POSTMAN_FOLDERS)

    a(f"""
    <div class="page-break"></div>
    <h1>Part 9. The complete catalog of tests</h1>
    <p>This is the full, exhaustive list of everything the project checks, so you know exactly what is covered. Each Playwright test is marked <span class="pos">POSITIVE</span> (it confirms a correct action succeeds) or <span class="neg">NEGATIVE</span> (it confirms a wrong action is refused with the right error). Testing both kinds is what separates a beginner from a professional.</p>
    <p class="tcount">Playwright tests: {total_pw} in total ({pos_pw} positive, {neg_pw} negative). Postman requests: {total_pm} in total, each with its own checks. A built in checker (node tools/verify.js) runs 64 more assertions against the server.</p>
    """)

    for group_name, items in PLAYWRIGHT_TESTS:
        rows = []
        for text, kind in items:
            tag = '<span class="pos">POS</span>' if kind == "pos" else '<span class="neg">NEG</span>'
            rows.append(f"<tr><td style='width:10%;text-align:center;'>{tag}</td><td>{esc(text)}</td></tr>")
        a(f"<h3>{esc(group_name)}</h3>")
        a("<table><tr><th style='width:10%;'>Type</th><th>What the test confirms</th></tr>" + "".join(rows) + "</table>")

    a("""
    <div class="page-break"></div>
    <h2>The Postman collection, folder by folder</h2>
    <p>The Postman collection covers the same ground with clickable requests, each carrying its own automatic checks. Run the folders top to bottom. The counts show how many requests are in each folder.</p>
    <table>
      <tr><th style="width:26%;">Folder</th><th style="width:10%;">Requests</th><th>What it covers</th></tr>
    """)
    for name, desc, n in POSTMAN_FOLDERS:
        a(f"<tr><td><b>{esc(name)}</b></td><td style='text-align:center;'>{n}</td><td>{esc(desc)}</td></tr>")
    a("</table>")

    # Full, exhaustive enumeration of every Postman request by name.
    a("""
    <div class="page-break"></div>
    <h2>Every Postman request, by name</h2>
    <p>For completeness, here is every single request in the collection. A name ending in a status code (for example 401, 403, 409) is a negative test that deliberately triggers that error. All the others confirm a correct action. You can run any of these on its own, or run a whole folder, or run the entire collection.</p>
    """)
    for folder_name, reqs in POSTMAN_REQUESTS:
        items = "".join(f"<li>{esc(r)}</li>" for r in reqs)
        a(f"<h4>{esc(folder_name)}</h4><ul style='margin-top:2pt;'>{items}</ul>")
    a(f"""
    <div class="callout">
      <div class="lead">Coverage at a glance</div>
      Between the {total_pw} Playwright tests, the {total_pm} Postman requests, and the 64 built in server assertions, every endpoint, every status code from 200 to 429, both login styles, all the chaining flows, and all the advanced behaviours are exercised in both their correct and their failing forms. That is well over one hundred concrete, automated scenarios.
    </div>
    """)

    # ---------------- Part 8: Advanced ideas ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 10. Four advanced ideas, made simple</h1>

    <h3>Version conflicts, and the ETag</h3>
    <p>Imagine two people edit the same book at the same time. Both read version 1. The first saves a change. The second, still holding version 1, saves and quietly erases the first person's work. To prevent this, every book carries a small version tag called an ETag. When you save, you may send the tag you last saw. If the book changed since then, your tag is out of date and the server refuses with status 412, so you re read and try again.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      It is like editing a shared paper list with a version number in the corner. Before you cross anything off, you check the number matches the copy you took. If it does not, someone edited it while you were away, so you fetch the fresh copy first instead of scribbling over their work.
    </div>

    <h3>Safe retries, and the idempotency key</h3>
    <p>You press check out, the network stalls, and you are unsure if the order went through. If you press again, will you be charged twice? An idempotency key prevents that. It is a unique string you attach to the checkout. If the server sees the same key twice, it returns the order it already made instead of making a second one.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      It is like the call button for a lift. Pressing it five times does not summon five lifts. The first press counts, and the rest do nothing new.
    </div>

    <h3>Delete without destroying, the soft delete</h3>
    <p>Deleting a book here does not erase it. It marks the book as deleted and hides it from normal lists. Reading it afterwards gives status 410, which means it existed and is now gone, a clearer message than a plain 404. Because the record still exists, a restore action brings it right back.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      This is the recycle bin on your computer. Deleted files are not shredded on the spot; they move out of sight and can be restored if you change your mind.
    </div>

    <h3>Being asked to slow down, rate limiting</h3>
    <p>One endpoint accepts only a few requests in a short window. Go over, and it replies with status 429, meaning too many requests, plus a Retry-After header telling you how many seconds to wait. Handling this politely, by pausing and trying again, is a skill every API client needs.</p>
    <div class="everyday">
      <div class="lead">In everyday terms</div>
      Think of a ride with a gate that lets a set number of people through each minute. Arrive too fast and the attendant asks you to wait a moment. Retry-After is the attendant telling you exactly how long.
    </div>
    """)

    # ---------------- Part 9: Glossary ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 11. A plain word glossary</h1>
    <dl class="glossary">
      <dt>API</dt><dd>A way for programs to talk to each other using messages. Your practice target is an API.</dd>
      <dt>Endpoint</dt><dd>One specific address and method you can call, for example GET /api/books. An API is a collection of endpoints.</dd>
      <dt>Request</dt><dd>The message you send to an endpoint, describing what you want.</dd>
      <dt>Response</dt><dd>The message you get back, containing a status code and usually a JSON body.</dd>
      <dt>Method</dt><dd>The action word on a request: GET, POST, PUT, PATCH, or DELETE.</dd>
      <dt>Status code</dt><dd>A three digit number that summarizes the outcome. 2xx is success, 4xx is your mistake, 5xx is the server's problem.</dd>
      <dt>JSON</dt><dd>The text format used for message bodies, made of names and values inside curly braces.</dd>
      <dt>Header</dt><dd>A small label on a request or response, such as Content-Type or Authorization.</dd>
      <dt>Body</dt><dd>The main content of a request or response, usually JSON.</dd>
      <dt>Token</dt><dd>A long string you receive after logging in. You attach it to later requests to prove who you are.</dd>
      <dt>Bearer token</dt><dd>The style of token used here. It travels in the header as "Authorization: Bearer your-token".</dd>
      <dt>Access token</dt><dd>A short lived token used on normal requests. It expires after fifteen minutes by default.</dd>
      <dt>Refresh token</dt><dd>A longer lived token whose only job is to get you a new access token without logging in again.</dd>
      <dt>Authentication</dt><dd>Proving who you are. A missing or bad token gives a 401.</dd>
      <dt>Authorization</dt><dd>Checking what you are allowed to do. A valid user doing a forbidden action gets a 403.</dd>
      <dt>Positive test</dt><dd>A test that confirms a correct action succeeds.</dd>
      <dt>Negative test</dt><dd>A test that confirms a wrong action fails with the right error.</dd>
      <dt>Chaining</dt><dd>Using the result of one request as the input to the next, for example create a book then review it.</dd>
      <dt>ETag</dt><dd>A version tag on a record used to prevent two people overwriting each other's changes.</dd>
      <dt>Idempotency key</dt><dd>A unique string that lets you retry an action safely without doing it twice.</dd>
      <dt>Soft delete</dt><dd>Marking a record as deleted and hiding it, rather than erasing it, so it can be restored.</dd>
      <dt>Rate limit</dt><dd>A cap on how many requests you may send in a time window. Going over returns 429.</dd>
      <dt>Playwright</dt><dd>The tool used here to send requests and check responses automatically.</dd>
      <dt>Postman</dt><dd>A visual tool for sending requests and running collections of checks by clicking.</dd>
      <dt>Seed data</dt><dd>The fixed starting data the server loads every time it starts or is reset.</dd>
    </dl>
    """)

    # ---------------- Part 10: Troubleshooting ----------------
    a("""
    <div class="page-break"></div>
    <h1>Part 12. When something goes wrong</h1>
    <table>
      <tr><th style="width:40%;">What you see</th><th>What it means and what to do</th></tr>
      <tr><td>node is not recognized</td><td>Node.js is not installed, or the terminal was open before you installed it. Install from nodejs.org, then close and reopen the terminal.</td></tr>
      <tr><td>Cannot connect, or the page will not load</td><td>The server is not running. In <code>application/api</code>, run <code>npm start</code> again and leave that window open.</td></tr>
      <tr><td>Every write returns 401</td><td>You have no token, or it expired after fifteen minutes. Log in again, or on the docs page press Authorize and log in as admin.</td></tr>
      <tr><td>A write returns 403</td><td>You are logged in as a normal user. Creating or changing catalog items needs the admin account.</td></tr>
      <tr><td>A request with a body returns 415</td><td>You forgot the header that says the body is JSON. Add Content-Type application/json.</td></tr>
      <tr><td>An update returns 412</td><td>Your ETag is out of date. Read the item again to get the current ETag, then retry the update.</td></tr>
      <tr><td>The limited endpoint keeps returning 429</td><td>That is expected once you pass the limit. Wait the seconds shown in Retry-After, or reset the data.</td></tr>
      <tr><td>Tests behave differently each run</td><td>Reset the data at the start so every run begins from the same 60 books. The tests already do this where needed.</td></tr>
      <tr><td>npm install seems stuck</td><td>The first install downloads a few files and can take a minute on a slow connection. Give it time. If it fails, check your internet and run it again.</td></tr>
    </table>

    <div class="callout">
      <div class="lead">A closing thought</div>
      The fastest way to get good at API testing is steady repetition against a target that never surprises you for the wrong reasons. Start the server, pick one scenario from Part 9, reproduce it by hand on the docs page, then find or write the automated test for it and watch it go green. Then pick the next one. Small wins add up quickly, and before long the whole catalog will feel easy.
    </div>

    <p class="small">Prepared by Manjunath N P. Connect at linkedin.com/in/manjunathnp.</p>
    """)

    html = f"<!doctype html><html><head><meta charset='utf-8'><style>{CSS}</style></head><body>{''.join(P)}</body></html>"
    return html


def render_base_pdf(html_path, pdf_path):
    subprocess.run([
        "wkhtmltopdf", "--enable-local-file-access", "--encoding", "utf-8",
        "--margin-top", "22mm", "--margin-bottom", "24mm",
        "--margin-left", "18mm", "--margin-right", "18mm", "--quiet",
        html_path, pdf_path,
    ], check=True)


def overlay(base_pdf, final_pdf):
    from reportlab.pdfgen import canvas
    from pypdf import PdfReader, PdfWriter
    import io

    reader = PdfReader(base_pdf)
    writer = PdfWriter()
    total = len(reader.pages)

    for i, page in enumerate(reader.pages):
        w = float(page.mediabox.width)
        h = float(page.mediabox.height)
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=(w, h))

        # ---- Simple 3-line diagonal watermark ----
        c.saveState()
        c.setFillColorRGB(126 / 255, 126 / 255, 126 / 255)
        try:
            c.setFillAlpha(0.08)
        except Exception:
            pass
        c.setFont("Helvetica-Bold", 15)
        for frac in (0.24, 0.50, 0.76):
            c.saveState()
            c.translate(w / 2, h * frac)
            c.rotate(33)
            c.drawCentredString(0, 0, WATERMARK_TEXT)
            c.restoreState()
        c.restoreState()

        # ---- Footer (skip the cover page) ----
        if i > 0:
            c.setFillColorRGB(0.42, 0.47, 0.52)
            c.setFont("Helvetica", 8)
            prefix = f"{BRAND_NAME}  |  "
            c.drawString(52, 26, prefix + LINKEDIN_TEXT)
            # Clickable link over the LinkedIn portion only.
            px = 52 + c.stringWidth(prefix, "Helvetica", 8)
            lw = c.stringWidth(LINKEDIN_TEXT, "Helvetica", 8)
            c.linkURL(LINKEDIN_URL, (px, 22, px + lw, 34), relative=0, thickness=0)
            c.drawRightString(w - 52, 26, f"Page {i} of {total - 1}")
            c.setStrokeColorRGB(0.80, 0.85, 0.88)
            c.setLineWidth(0.5)
            c.line(52, 36, w - 52, 36)

        c.save()
        buf.seek(0)
        page.merge_page(PdfReader(buf).pages[0])
        writer.add_page(page)

    with open(final_pdf, "wb") as f:
        writer.write(f)


def main():
    html_path = os.path.join(OUT_DIR, "_guide.html")
    base_pdf = os.path.join(OUT_DIR, "_base.pdf")
    final_pdf = os.path.join(OUT_DIR, "TechBookStore-Practice-API-Guide.pdf")

    with open(html_path, "w", encoding="utf-8") as f:
        f.write(build_html())
    render_base_pdf(html_path, base_pdf)
    overlay(base_pdf, final_pdf)

    for p in (html_path, base_pdf):
        try:
            os.remove(p)
        except OSError:
            pass

    from pypdf import PdfReader
    print(f"Wrote {final_pdf} ({len(PdfReader(final_pdf).pages)} pages).")


if __name__ == "__main__":
    main()
