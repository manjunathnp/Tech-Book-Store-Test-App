'use strict';

const store = require('../store');

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9+#./]+/g, ' ')
    .trim();
}

function editDistance(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function derivedRating(book, reviews) {
  const matches = reviews.filter((review) => review.bookId === book.id);
  if (!matches.length) return { averageRating: null, reviewCount: 0 };
  const averageRating = Number((matches.reduce((sum, review) => sum + review.rating, 0) / matches.length).toFixed(1));
  return { averageRating, reviewCount: matches.length };
}

function customerBook(book, state) {
  const author = state.authors.find((item) => item.id === book.authorId);
  const category = state.categories.find((item) => item.id === book.categoryId);
  const publisher = state.publishers.find((item) => item.id === book.publisherId);
  return Object.assign({
    id: book.id,
    title: book.title,
    author: author ? author.name : null,
    category: category ? category.name : null,
    publisher: publisher ? publisher.name : null,
    isbn: book.isbn,
    description: book.description,
    price: book.price,
    currency: book.currency,
    availability: book.inStock && book.stockCount > 0 ? 'In stock' : 'Out of stock',
    inStock: Boolean(book.inStock && book.stockCount > 0),
    format: book.format,
    language: book.language,
    pages: book.pages,
    publishedYear: book.publishedYear,
    tags: Array.isArray(book.tags) ? book.tags.slice() : [],
  }, derivedRating(book, state.reviews));
}

function fuzzyTokenMatch(queryTokens, haystackTokens) {
  if (!queryTokens.length) return { score: 0, matched: 0 };
  let score = 0;
  let matched = 0;
  for (const queryToken of queryTokens) {
    if (haystackTokens.includes(queryToken)) {
      score += 12;
      matched += 1;
      continue;
    }
    if (queryToken.length >= 4 && haystackTokens.some((token) => {
      const longest = Math.max(queryToken.length, token.length);
      const allowance = longest >= 8 ? 3 : longest >= 5 ? 2 : 1;
      return editDistance(queryToken, token) <= allowance;
    })) {
      score += 6;
      matched += 1;
    }
  }
  return { score, matched };
}

function relevance(book, query) {
  if (!query) return 0;
  const q = normalize(query);
  const title = normalize(book.title);
  const author = normalize(book.author);
  const category = normalize(book.category);
  const body = normalize([book.description, ...(book.tags || [])].join(' '));
  if (title === q) return 1000;
  let score = 0;
  if (title.startsWith(q)) score += 250;
  else if (title.includes(q)) score += 180;
  if (author === q) score += 220;
  else if (author.includes(q)) score += 100;
  if (category === q) score += 160;
  else if (category.includes(q)) score += 80;
  if (body.includes(q)) score += 50;
  const stopwords = new Set(['a', 'an', 'the', 'book', 'books', 'show', 'find', 'edition', 'about', 'for', 'me']);
  const qTokens = q.split(' ').filter((token) => token && !stopwords.has(token));
  const fuzzy = fuzzyTokenMatch(qTokens, `${title} ${author} ${category} ${body}`.split(' ').filter(Boolean));
  // A long query matching only one generic word is not a useful result. This
  // prevents nonexistent titles from degenerating into unrelated catalog hits.
  const requiredMatches = Math.max(1, Math.ceil(qTokens.length / 2));
  if (score === 0 && fuzzy.matched < requiredMatches) return 0;
  score += fuzzy.score;
  return score;
}

function contains(value, wanted) {
  if (!wanted) return true;
  return normalize(value).includes(normalize(wanted));
}

function searchBooks(args, options = {}) {
  const input = args || {};
  const state = store.getState();
  let books = state.books
    .filter((book) => !book.deleted)
    .map((book) => customerBook(book, state));

  if (input.title) books = books.filter((book) => contains(book.title, input.title));
  if (input.author) books = books.filter((book) => contains(book.author, input.author));
  if (input.category) books = books.filter((book) => contains(book.category, input.category));
  if (input.format) books = books.filter((book) => normalize(book.format) === normalize(input.format));
  if (typeof input.inStock === 'boolean') books = books.filter((book) => book.inStock === input.inStock);
  if (Number.isFinite(Number(input.minPrice))) books = books.filter((book) => book.price >= Number(input.minPrice));
  if (Number.isFinite(Number(input.maxPrice))) books = books.filter((book) => book.price <= Number(input.maxPrice));

  const query = normalize(input.query);
  if (query) {
    books = books
      .map((book) => ({ book, score: relevance(book, query) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || a.book.title.localeCompare(b.book.title))
      .map((item) => item.book);
  } else {
    const sort = ['price', 'publishedYear', 'averageRating', 'title'].includes(input.sort) ? input.sort : 'title';
    const direction = input.order === 'desc' ? -1 : 1;
    books.sort((a, b) => {
      const av = a[sort];
      const bv = b[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av < bv ? -1 : av > bv ? 1 : 0) * direction;
    });
  }

  const maximum = Math.max(1, Number.parseInt(options.maxLimit, 10) || 10);
  const fallback = Math.max(1, Math.min(maximum, Number.parseInt(options.defaultLimit, 10) || 5));
  const limit = Math.max(1, Math.min(maximum, Number.parseInt(input.limit, 10) || fallback));
  return { totalMatches: books.length, books: books.slice(0, limit) };
}

function searchAllBooks(args) {
  return searchBooks(Object.assign({}, args, { limit: 200 }), { maxLimit: 200, defaultLimit: 200 });
}

function getBookDetails(ids) {
  const state = store.getState();
  const wanted = Array.isArray(ids) ? ids.map(Number).filter(Number.isInteger).slice(0, 10) : [];
  const books = wanted.map((id) => state.books.find((book) => book.id === id && !book.deleted))
    .filter(Boolean)
    .map((book) => customerBook(book, state));
  return { requestedIds: wanted, books, missingIds: wanted.filter((id) => !books.some((book) => book.id === id)) };
}

function listCategories() {
  const state = store.getState();
  return {
    categories: state.categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      bookCount: state.books.filter((book) => !book.deleted && book.categoryId === category.id).length,
    })),
  };
}

module.exports = { customerBook, getBookDetails, listCategories, normalize, searchAllBooks, searchBooks };
