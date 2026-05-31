const express = require('express');
const router = express.Router();
const chatService = require('../services/chatService');

router.post('/', async (req, res) => {
  const { message, currentLocation, forceRoute } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'Message is required' });
  }

  const response = await chatService.processChat(message, currentLocation, forceRoute);
  res.json(response);
});

module.exports = router;
