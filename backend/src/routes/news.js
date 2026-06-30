const express = require('express');
const { getCategories, getNews, getVideoNews } = require('../services/newsService');

const router = express.Router();

router.get('/categories', (_req, res) => {
  res.json({
    categories: [
      { id: 'all', label: 'All' },
      ...getCategories(),
    ],
  });
});

router.get('/', async (req, res, next) => {
  try {
    const payload = await getNews({
      category: req.query.category,
      limit: req.query.limit,
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/videos', async (req, res, next) => {
  try {
    const payload = await getVideoNews({
      refresh: req.query.refresh === '1' || req.query.refresh === 'true',
    });
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
