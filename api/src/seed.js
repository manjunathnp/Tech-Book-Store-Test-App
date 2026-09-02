'use strict';

/*
 * Deterministic seed data for the Tech Book Store.
 *
 * "Deterministic" means the exact same data is produced every time the server
 * starts or POST /api/reset is called. That is what makes automated tests
 * reliable: you always know book 1 is the same book with the same fields.
 *
 * The catalog focuses on test automation, Playwright, and related engineering
 * topics so the data feels real to someone learning API testing.
 */

const crypto = require('crypto');
const { hashPassword } = require('./auth/password');

const NOW = '2025-01-01T00:00:00.000Z';

function uuidFrom(seedText) {
  // Stable pseudo-UUID derived from a seed string so UUIDs are reproducible.
  const h = crypto.createHash('sha256').update(seedText).digest('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    '4' + h.slice(13, 16),
    ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20),
    h.slice(20, 32),
  ].join('-');
}

function buildSeed() {
  // ----- Authors -----
  const authorNames = [
    'Anita Rao', 'David Chen', 'Priya Nair', 'Marcus Webb', 'Sofia Alvarez',
    'Rahul Menon', 'Elena Popov', 'James Okoro', 'Mei Lin', 'Carlos Duarte',
    'Fatima Hassan', 'Tomas Novak', 'Grace Kim', 'Owen Bennett', 'Lena Fischer',
    'Arjun Bhat', 'Nadia Petrova', 'Samuel Green', 'Yuki Tanaka', 'Ravi Shankar',
  ];
  const authors = authorNames.map((name, i) => ({
    id: i + 1,
    uuid: uuidFrom('author-' + (i + 1)),
    name,
    bio: `${name} is a software engineer and author focused on test automation and quality engineering.`,
    country: ['IN', 'US', 'IN', 'GB', 'ES', 'IN', 'RU', 'NG', 'CN', 'BR',
      'AE', 'CZ', 'KR', 'GB', 'DE', 'IN', 'RU', 'US', 'JP', 'IN'][i],
    createdAt: NOW,
    updatedAt: NOW,
  }));

  // ----- Categories -----
  const categoryNames = [
    'Test Automation', 'Playwright', 'API Testing', 'JavaScript', 'TypeScript',
    'CI/CD', 'Performance Testing', 'DevOps', 'Web Development', 'Programming Fundamentals',
  ];
  const categories = categoryNames.map((name, i) => ({
    id: i + 1,
    uuid: uuidFrom('category-' + (i + 1)),
    name,
    slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    description: `Books about ${name}.`,
    createdAt: NOW,
    updatedAt: NOW,
  }));

  // ----- Publishers -----
  const publisherNames = [
    'Quality Press', 'Automation House', 'DevBooks Media', 'Testing Guild Publishing',
    'CodeCraft Books', 'Signal & Assert', 'Continuous Publishing', 'Bytesmith Press',
  ];
  const publishers = publisherNames.map((name, i) => ({
    id: i + 1,
    uuid: uuidFrom('publisher-' + (i + 1)),
    name,
    city: ['Bengaluru', 'London', 'Austin', 'Berlin', 'Toronto', 'Singapore', 'Dublin', 'Pune'][i],
    foundedYear: 2005 + i,
    createdAt: NOW,
    updatedAt: NOW,
  }));

  // ----- Books -----
  // A curated list of realistic titles across the categories above.
  const bookTitles = [
    'Playwright End to End Testing',
    'Mastering API Test Automation',
    'The Playwright Handbook',
    'TypeScript for Testers',
    'JavaScript Testing Essentials',
    'Continuous Testing with CI/CD',
    'REST API Testing in Practice',
    'Page Object Model Patterns',
    'Debugging Flaky Tests',
    'Test Data Management',
    'Contract Testing Fundamentals',
    'GraphQL API Testing',
    'Performance Testing with k6',
    'Docker for Test Engineers',
    'Kubernetes Testing Strategies',
    'Selenium to Playwright Migration',
    'Automating Authentication Flows',
    'Web Accessibility Testing',
    'Visual Regression Testing',
    'Mocking and Service Virtualization',
    'BDD with Cucumber and Playwright',
    'The SDET Career Guide',
    'Clean Test Code',
    'Test Architecture at Scale',
    'Reporting and Test Analytics',
    'Cross Browser Testing Deep Dive',
    'Mobile Web Automation',
    'Network Interception Techniques',
    'Fixtures and Test Isolation',
    'Parallel Test Execution',
    'Shift Left Testing',
    'Exploratory Testing Reimagined',
    'API Security Testing',
    'Load Testing Foundations',
    'Observability for Test Engineers',
    'Git for Test Automation',
    'Writing Maintainable Assertions',
    'The Art of Test Reviews',
    'Test Environments and Config',
    'From Manual to Automation',
    'Playwright Component Testing',
    'End to End Test Design',
    'Data Driven Testing Patterns',
    'HTTP and the Web for Testers',
    'JSON Schema Validation',
    'Async Testing in JavaScript',
    'Retry and Resilience Patterns',
    'Testing Microservices',
    'API Documentation for Testers',
    'The Quality Engineering Mindset',
    'Selenium Grid in Depth',
    'Cypress vs Playwright',
    'Automated Smoke and Regression',
    'Test Pyramid in Practice',
    'Flaky Test Forensics',
    'Advanced Locators and Selectors',
    'Session and Cookie Testing',
    'Rate Limiting and Throttling',
    'Idempotency in APIs',
    'Pagination and Filtering Patterns',
    'Playwright Fixtures in Depth',
    'Test Reporting with Allure',
    'API Mocking with Playwright',
    'Continuous Integration Cookbook',
    'The Test Automation Pyramid',
    'Selectors and Auto Waiting',
    'Handling Iframes and Popups',
    'File Upload and Download Testing',
    'Web Sockets Testing Basics',
    'Authentication State Reuse',
    'Screenshot and Video Capture',
    'Trace Viewer Mastery',
    'Sharding Tests Across Machines',
    'Environment Variables for Tests',
    'Secrets Management in CI',
    'Testing Single Page Applications',
    'Handling Dynamic Content',
    'Keyboard and Mouse Simulation',
    'Drag and Drop Automation',
    'Testing Forms and Validation',
    'Cookies and Local Storage',
    'Geolocation and Permissions',
    'Emulating Mobile Devices',
    'Dark Mode and Theming Tests',
    'Accessibility Tree Snapshots',
    'Component Testing with React',
    'Testing Vue Applications',
    'API First Development',
    'OpenAPI and Schema Testing',
    'Postman to Playwright',
    'Test Case Design Techniques',
    'Risk Based Testing',
    'Boundary Value Analysis',
    'Equivalence Partitioning Guide',
    'State Transition Testing',
    'Decision Table Testing',
    'The Automation ROI Playbook',
    'Building a Test Strategy',
    'Quality Gates in Pipelines',
    'From SDET to Test Lead',
  ];


  // Assign categories by subject matter instead of round-robin position.
  // More specific rules come first so, for example, Playwright API titles
  // remain in Playwright while general REST/OpenAPI titles go to API Testing.
  function categoryIdFor(title) {
    const t = title.toLowerCase();
    // Programming Fundamentals is reserved for books whose primary subject is
    // writing and structuring code. Testing-methodology, career, strategy, and
    // process books belong to Test Automation instead.
    if (/page object model patterns|clean test code|test architecture at scale|writing maintainable assertions|data driven testing patterns|retry and resilience patterns/.test(t)) return 10;
    if (/playwright|auto waiting|locator|selector|trace viewer|iframe|popup|authentication state reuse|network interception|fixture|component testing/.test(t)) return 2;
    if (/api|rest|graphql|http|json schema|openapi|postman|contract testing|microservices|idempotency|pagination|rate limiting|service virtual/.test(t)) return 3;
    if (/typescript/.test(t)) return 5;
    if (/javascript|async testing/.test(t)) return 4;
    if (/ci\/cd|continuous integration|pipeline|quality gate|secrets management|sharding tests/.test(t)) return 6;
    if (/performance|\bload testing\b|k6|observability/.test(t)) return 7;
    if (/docker|kubernetes|devops|environment|git for/.test(t)) return 8;
    if (/web accessibility|mobile web|single page|dynamic content|keyboard|mouse|drag and drop|forms|cookies|local storage|geolocation|permissions|mobile devices|dark mode|react|vue|web sockets/.test(t)) return 9;
    return 1;
  }

  const categoryAbout = {
    1: 'designing stable automation suites, maintainable test code, dependable assertions, and pragmatic quality workflows',
    2: 'building reliable Playwright browser tests with locators, fixtures, isolation, debugging, and cross-browser execution',
    3: 'testing HTTP and API contracts, schemas, authentication, resilience, data boundaries, and service integrations',
    4: 'using modern JavaScript patterns to write clear asynchronous tests and diagnose application behavior',
    5: 'applying TypeScript types, tooling, and reusable abstractions to safer test automation code',
    6: 'running automated quality gates in continuous integration pipelines with repeatable reporting and secure configuration',
    7: 'measuring load, latency, throughput, and system behavior under realistic performance conditions',
    8: 'creating reproducible test environments with source control, containers, orchestration, and operational tooling',
    9: 'testing modern web application behavior, accessibility, browser capabilities, responsive layouts, and user input',
    10: 'applying programming fundamentals such as reusable abstractions, modular design, maintainable code, assertions, data-driven patterns, and resilient error handling',
  };

  const books = bookTitles.map((title, i) => {
    const id = i + 1;
    const authorId = (i % authors.length) + 1;
    const categoryId = categoryIdFor(title);
    const publisherId = (i % publishers.length) + 1;
    const priceInr = 299 + (i % 25) * 90; // realistic rupee price: 299 .. 2459
    return {
      id,
      uuid: uuidFrom('book-' + id),
      title,
      isbn: '978' + String(1000000000 + id * 37).slice(0, 10),
      authorId,
      categoryId,
      publisherId,
      price: Number(priceInr.toFixed(2)),
      currency: 'INR',
      pages: 180 + ((i * 13) % 420),
      rating: id === 6 ? 3 : ([14, 22].includes(id) ? 3.5 : (id % 4 === 0 ? 5 : 4.5)),
      inStock: i % 7 !== 0, // roughly 1 in 7 out of stock
      stockCount: i % 7 === 0 ? 0 : 5 + (i % 40),
      publishedYear: 2018 + (i % 8),
      language: 'English',
      format: ['paperback', 'ebook', 'hardcover'][i % 3],
      tags: [categoryNames[categoryId - 1], 'automation'],
      description: `${title} is about ${categoryAbout[categoryId]}. It uses practical examples for software testers, developers, and quality engineers.`,
      version: 1, // used for optimistic concurrency (ETag / If-Match)
      deleted: false, // soft-delete flag
      createdAt: NOW,
      updatedAt: NOW,
    };
  });

  // ----- Users -----
  // Passwords are hashed at seed time so plaintext never lives in the store.
  const rawUsers = [
    { id: 1, name: 'Admin', email: 'admin@bookstore.test', password: 'admin123', role: 'admin' },
    { id: 2, name: 'Anvi', email: 'user@bookstore.test', password: 'password123', role: 'user' },
    { id: 3, name: 'Yash', email: 'yash@bookstore.test', password: 'password123', role: 'user' },
    { id: 4, name: 'Riya', email: 'riya@bookstore.test', password: 'password123', role: 'user' },
    { id: 5, name: 'Sam', email: 'sam@bookstore.test', password: 'password123', role: 'user' },
    { id: 6, name: 'John', email: 'john@bookstore.test', password: 'password123', role: 'user' },
    { id: 7, name: 'Arav', email: 'arav@bookstore.test', password: 'password123', role: 'user' },
  ];
  const users = rawUsers.map((u) => ({
    id: u.id,
    uuid: uuidFrom('user-' + u.id),
    name: u.name,
    email: u.email,
    passwordHash: hashPassword(u.password),
    role: u.role,
    createdAt: NOW,
    updatedAt: NOW,
  }));

  // ----- Reviews -----
  const reviews = [];
  let reviewId = 1;
  const reviewedBookIds = [
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    21, 22, 23, 26, 27, 28,
  ];
  const reviewTitles = ['Highly useful', 'Strong practical guide', 'Clear and focused', 'Worth keeping nearby'];
  const reviewBodies = [
    'The examples are concrete, well paced, and useful in day-to-day automation work.',
    'A practical reference that connects the core ideas to realistic engineering decisions.',
    'The explanations are concise and the exercises make the techniques easy to apply.',
    'Useful coverage for both learning the topic and revisiting it during a real project.',
  ];
  reviewedBookIds.forEach((bookId, bookIndex) => {
    const ratings = bookId === 6 ? [3, 3] : ([14, 22].includes(bookId) ? [3, 4] : (bookIndex % 4 === 0 ? [5, 5] : [4, 5]));
    ratings.forEach((rating, reviewIndex) => {
      const userId = 2 + ((bookIndex * 2 + reviewIndex) % 6); // users 2..7, unique per book
      reviews.push({
        id: reviewId,
        uuid: uuidFrom('review-' + reviewId),
        bookId,
        userId,
        rating,
        title: reviewTitles[(bookIndex + reviewIndex) % reviewTitles.length],
        body: reviewBodies[(bookIndex + reviewIndex) % reviewBodies.length],
        createdAt: NOW,
        updatedAt: NOW,
      });
      reviewId += 1;
    });
  });

  return {
    authors,
    categories,
    publishers,
    books,
    users,
    reviews,
    carts: {}, // keyed by userId -> { items: [{ bookId, quantity }] }
    orders: [], // list of orders
    wishlists: {}, // keyed by userId -> [bookId, ...]
    // Counters so newly created records continue the id sequence.
    counters: {
      authors: authors.length,
      categories: categories.length,
      publishers: publishers.length,
      books: books.length,
      users: users.length,
      reviews: reviews.length,
      orders: 0,
    },
  };
}

module.exports = { buildSeed, NOW };
