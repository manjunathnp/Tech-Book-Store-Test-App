'use strict';

const fs = require('fs');
const path = require('path');
const { buildSeed } = require('../src/seed');

const seed = buildSeed();
const authors = new Map(seed.authors.map((author) => [author.id, author.name]));
const categories = new Map(seed.categories.map((category) => [category.id, category.name]));
const formatLabels = { paperback: 'Paperback', ebook: 'e-Book', hardcover: 'Hardcover' };

const catalog = seed.books.map((book) => ({
  bookName: book.title,
  author: authors.get(book.authorId) || 'Unknown author',
  whatThisBookIsAbout: book.description,
  category: categories.get(book.categoryId) || 'Uncategorized',
  format: formatLabels[book.format] || book.format,
}));

const outputPath = path.resolve(__dirname, '..', '..', 'web', 'techbookstore-books-catalog.json');
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Exported ${catalog.length} books to ${outputPath}`);
